/**
 * Address and dealership autocomplete. Runs in the main process (no CORS, no
 * renderer load) and combines three things:
 *
 * - Photon (https://photon.komoot.io), the keyless OSM geocoder from Komoot
 *   built for type-ahead: one query for car dealerships (`shop=car`), one for
 *   everything. Label and coordinates come in one response.
 * - The local Overture Maps dealer directory (dealer-directory.service.ts),
 *   which fills the many gaps OSM has for small businesses.
 * - The saved portfolios, so a hit that already is a portfolio location says
 *   so and ranks higher.
 *
 * The query is first understood offline (place-query.ts): legal forms
 * dropped, umlauts folded, category words ("Motorradhändler") and a city or
 * postcode at the end recognised. All hits are then merged and ranked by one
 * score (place-ranking.ts). Reverse geocoding stays with Nominatim
 * (geocoding.service.ts).
 */
import type { QueryLocality } from "./dealer-directory/directory-index";
import {
  resolveQueryLocality,
  searchDealerDirectory,
} from "./dealer-directory.service";
import { fetchWithResilience } from "./http.service";
import {
  normalisePlaceQuery,
  parsePlaceQuery,
  similarBusinessNames,
} from "./place-query";
import {
  rankPlaces,
  type PlaceCandidate,
  type PlaceSource,
} from "./place-ranking";
import {
  matchPortfolio,
  portfolioEntries,
  type PortfolioMatch,
  type PortfolioEntry,
} from "./portfolio-index.service";

export { normalisePlaceQuery, similarBusinessNames };

const PHOTON_URL = "https://photon.komoot.io/api";
const USER_AGENT = "DealershipRiskMapping-Desktop/0.1 (contact: internal)";

/** Bias used without a map position: Germany as a whole. */
const DEFAULT_BIAS = { lat: 51.16, lon: 10.45, zoom: 6 };
const PHOTON_LIMIT = 8;
const PHOTON_DEALER_LIMIT = 5;
const DIRECTORY_LIMIT = 6;

export interface PlaceSuggestion {
  label: string;
  lat: number;
  lon: number;
  source?: PlaceSource;
  /** Every source that knows the place (both = confirmed). */
  sources?: PlaceSource[];
  /** Saved portfolio locations this place already is. */
  portfolio?: PortfolioMatch[];
}

export interface SearchBias {
  lat: number;
  lon: number;
  zoom?: number;
}

/** Photon feature properties (only the fields we need). */
interface PhotonProps {
  osm_id?: number;
  osm_type?: string;
  osm_key?: string;
  osm_value?: string;
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
): Promise<PlaceCandidate[]> {
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
    .map((f, index) => {
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
        dealer:
          osmTag != null ||
          (props.osm_key === "shop" && props.osm_value === "car"),
        hasHouseNumber: Boolean(props.housenumber),
        sourceRank: index,
      };
    });
}

/**
 * Where Photon should look: the place the query names, else the map view
 * (city level at most — closer zooms would hide the right dealership one
 * town over), else Germany.
 */
export function photonBias(
  locality: QueryLocality | null,
  near: SearchBias | undefined,
): Required<SearchBias> {
  if (locality) {
    return {
      lat: locality.lat,
      lon: locality.lon,
      zoom: locality.kind === "postcode" ? 12 : 11,
    };
  }
  if (near) {
    return {
      lat: near.lat,
      lon: near.lon,
      zoom: Math.min(12, Math.max(5, Math.round(near.zoom ?? 10))),
    };
  }
  return DEFAULT_BIAS;
}

function safePortfolioEntries(): PortfolioEntry[] {
  try {
    return portfolioEntries();
  } catch (err) {
    // The badge is a nicety; the search itself must still answer.
    console.error("Portfolio lookup for search failed:", err);
    return [];
  }
}

export async function placesAutocomplete(
  query: string,
  near?: SearchBias,
): Promise<PlaceSuggestion[]> {
  const parsed = parsePlaceQuery(query);
  const { locality, nameTokens } = resolveQueryLocality(parsed);
  const bias = photonBias(locality, near);

  const [dealerships, general] = await Promise.allSettled([
    photonSearch(parsed.text, bias, PHOTON_DEALER_LIMIT, "shop:car"),
    photonSearch(parsed.text, bias, PHOTON_LIMIT),
  ]);
  if (dealerships.status === "rejected" && general.status === "rejected") {
    throw general.reason;
  }
  const directoryHits: PlaceCandidate[] = searchDealerDirectory({
    nameTokens,
    categories: parsed.categories,
    locality,
    near,
    limit: DIRECTORY_LIMIT,
  }).map((hit, index) => ({
    label: hit.label,
    lat: hit.lat,
    lon: hit.lon,
    osmKey: null,
    name: hit.name,
    source: "overture",
    dealer: true,
    hasHouseNumber: /\d/u.test(hit.street ?? ""),
    sourceRank: index,
  }));

  // First-seen order only breaks ties; OSM comes first because it carries
  // the richer address when both sources know a place.
  const candidates = [
    ...(dealerships.status === "fulfilled" ? dealerships.value : []),
    ...(general.status === "fulfilled" ? general.value : []),
    ...directoryHits,
  ];
  const entries = safePortfolioEntries();
  return rankPlaces(candidates, {
    tokens: nameTokens,
    addressIntent: parsed.addressIntent,
    focus: locality ?? near,
    locality,
    portfolio: (place) => matchPortfolio(place, entries),
  }).map(({ label, lat, lon, source, sources, portfolio }) => ({
    label,
    lat,
    lon,
    source,
    sources,
    ...(portfolio.length > 0 ? { portfolio } : {}),
  }));
}
