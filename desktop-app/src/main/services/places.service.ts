/**
 * Address autocomplete via Photon (https://photon.komoot.io) — an OSM-based,
 * keyless geocoder from Komoot built specifically for type-ahead search.
 * Runs in the main process (no CORS, no renderer load).
 *
 * Unlike Google Places, Photon returns the label AND coordinates in ONE response —
 * so the former two-step autocomplete/details flow with a
 * session token is no longer needed. Reverse geocoding/geocoding for further processing stays
 * with Nominatim (see geocoding.service.ts).
 *
 * Plain Photon search ranks by global importance, so a small dealership loses
 * against towns, streets and namesakes elsewhere in the world. Three things
 * recover it: a second query restricted to car dealerships (`shop=car`),
 * dropping legal forms that OSM names usually omit ("GmbH & Co. KG"), and a
 * location bias towards the visible map (or Germany).
 *
 * The local Overture Maps dealer directory (dealer-directory.service.ts)
 * fills the gaps OSM has: its hits are merged in, and a business both
 * sources know is listed once.
 */
import { searchDealerDirectory } from "./dealer-directory.service";
import { fetchWithResilience } from "./http.service";
import { normalisePlaceQuery } from "./place-query";

export { normalisePlaceQuery };

const PHOTON_URL = "https://photon.komoot.io/api";
const USER_AGENT = "DealershipRiskMapping-Desktop/0.1 (contact: internal)";

/** Bias used without a map position: Germany as a whole. */
const DEFAULT_BIAS = { lat: 51.16, lon: 10.45, zoom: 6 };
const MAX_SUGGESTIONS = 8;
/** Two hits closer than this with the same label are the same place. */
const DUPLICATE_DISTANCE_M = 75;
/**
 * OSM and Overture place the same business up to a building apart (entrance
 * vs. roof centroid); within this distance a similar name means one place.
 */
const CROSS_SOURCE_DISTANCE_M = 150;

export interface PlaceSuggestion {
  label: string;
  lat: number;
  lon: number;
  source?: "osm" | "overture";
}

export interface SearchBias {
  lat: number;
  lon: number;
  zoom?: number;
}

/** Photon feature properties (only the fields we need for the label). */
interface PhotonProps {
  osm_id?: number;
  osm_type?: string;
  name?: string;
  housenumber?: string;
  street?: string;
  postcode?: string;
  city?: string;
  town?: string;
  village?: string;
  county?: string;
  state?: string;
  country?: string;
}

export interface PlaceHit extends PlaceSuggestion {
  /** OSM object key, for exact de-duplication between Photon queries. */
  osmKey: string | null;
  /** Business name alone, for cross-source matching. */
  name: string | null;
  source: "osm" | "overture";
}

/** Builds a readable, single-line address label from the Photon properties. */
function formatLabel(p: PhotonProps): string {
  const streetLine = [p.street, p.housenumber].filter(Boolean).join(" ");
  const primary = p.name && p.name !== p.street ? p.name : streetLine;
  const locality = p.city ?? p.town ?? p.village ?? p.county;
  const parts = [
    primary || streetLine,
    [p.postcode, locality].filter(Boolean).join(" "),
    p.state,
    p.country,
  ].filter((s): s is string => Boolean(s && s.trim()));
  return parts.join(", ");
}

async function photonSearch(
  query: string,
  bias: Required<SearchBias>,
  limit: number,
  osmTag?: string,
): Promise<PlaceHit[]> {
  const params = new URLSearchParams({
    q: query,
    lang: "de",
    limit: String(limit),
    lat: String(bias.lat),
    lon: String(bias.lon),
    zoom: String(bias.zoom),
  });
  if (osmTag) params.set("osm_tag", osmTag);
  const res = await fetchWithResilience(`${PHOTON_URL}?${params}`, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) throw new Error(`Photon ${res.status}`);
  const data = (await res.json()) as {
    features?: Array<{
      geometry?: { coordinates?: [number, number] };
      properties?: PhotonProps;
    }>;
  };
  return (data.features ?? [])
    .filter((f) => Array.isArray(f.geometry?.coordinates))
    .map((f) => {
      const [lon, lat] = f.geometry!.coordinates!;
      const props = f.properties ?? {};
      const label = formatLabel(props);
      return {
        label: label || `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
        lat,
        lon,
        osmKey:
          props.osm_type && props.osm_id != null
            ? `${props.osm_type}${props.osm_id}`
            : null,
        name: props.name ?? null,
        source: "osm" as const,
      };
    });
}

function distanceM(a: PlaceSuggestion, b: PlaceSuggestion): number {
  const rad = Math.PI / 180;
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}

/** Words every second dealer name contains; they say nothing about identity. */
const GENERIC_NAME_TOKENS = new Set([
  "autohaus",
  "auto",
  "autos",
  "automobile",
  "automobil",
  "autocenter",
  "autozentrum",
  "kfz",
  "car",
  "cars",
  "service",
  "center",
  "zentrum",
  "handel",
  "und",
]);

function nameTokens(name: string): Set<string> {
  const all = normalisePlaceQuery(name)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 3);
  const specific = all.filter((token) => !GENERIC_NAME_TOKENS.has(token));
  return new Set(specific.length > 0 ? specific : all);
}

/** "Opel - Autohaus Dresden GmbH" ≈ "Autohaus Dresden"; "Auto Müller" ≉ "Auto Schmidt". */
export function similarBusinessNames(a: string, b: string): boolean {
  const left = nameTokens(a);
  const right = nameTokens(b);
  if (left.size === 0 || right.size === 0) return false;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared++;
  return shared > 0 && shared >= Math.min(left.size, right.size) / 2;
}

function samePlace(kept: PlaceHit, hit: PlaceHit): boolean {
  if (hit.osmKey != null && kept.osmKey === hit.osmKey) return true;
  const distance = distanceM(kept, hit);
  if (kept.label === hit.label && distance < DUPLICATE_DISTANCE_M) return true;
  return (
    kept.source !== hit.source &&
    kept.name != null &&
    hit.name != null &&
    distance < CROSS_SOURCE_DISTANCE_M &&
    similarBusinessNames(kept.name, hit.name)
  );
}

/** Keeps the first of each place, in list order, across both sources. */
export function mergePlaceHits(...lists: PlaceHit[][]): PlaceSuggestion[] {
  const out: PlaceHit[] = [];
  for (const hit of lists.flat()) {
    if (!out.some((kept) => samePlace(kept, hit))) out.push(hit);
  }
  return out
    .slice(0, MAX_SUGGESTIONS)
    .map(({ label, lat, lon, source }) => ({ label, lat, lon, source }));
}

export async function placesAutocomplete(
  query: string,
  near?: SearchBias,
): Promise<PlaceSuggestion[]> {
  const q = normalisePlaceQuery(query);
  const bias = near
    ? {
        lat: near.lat,
        lon: near.lon,
        // A city-level bias at most: closer zooms would hide the right
        // dealership one town over.
        zoom: Math.min(12, Math.max(5, Math.round(near.zoom ?? 10))),
      }
    : DEFAULT_BIAS;

  const [dealerships, general] = await Promise.allSettled([
    photonSearch(q, bias, 5, "shop:car"),
    photonSearch(q, bias, MAX_SUGGESTIONS),
  ]);
  if (dealerships.status === "rejected" && general.status === "rejected") {
    throw general.reason;
  }
  const dealerHits =
    dealerships.status === "fulfilled" ? dealerships.value : [];
  const generalHits = general.status === "fulfilled" ? general.value : [];
  const directoryHits: PlaceHit[] = searchDealerDirectory(q, near).map(
    (hit) => ({
      label: hit.label,
      lat: hit.lat,
      lon: hit.lon,
      osmKey: null,
      name: hit.name,
      source: "overture",
    }),
  );

  // A house number means the user is typing an address: keep Photon's address
  // ranking first. Otherwise it is a business name, and dealerships lead —
  // OSM first (it carries the richer address), Overture filling the gaps.
  return /\d/u.test(q)
    ? mergePlaceHits(generalHits, dealerHits, directoryHits)
    : mergePlaceHits(dealerHits, directoryHits, generalHits);
}
