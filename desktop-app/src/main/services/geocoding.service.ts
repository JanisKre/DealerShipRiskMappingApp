import { cached, TTL } from "./cache.service";
import { fetchWithResilience } from "./http.service";
import { matchesSite } from "./boundary/site-membership";
import { haversineMeters } from "@shared/dedupe";
import { houseNumberOf, isPoBox, postcodeOf } from "@shared/address-parts";

/**
 * Geocoding via Nominatim — im Main-Process direkt aufrufbar (kein CORS).
 * Ergebnisse werden persistent gecacht. Nominatim verlangt einen User-Agent.
 */
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
// The app-wide User-Agent (name, version, project URL) is set by http.service.

export interface GeocodeResult {
  label: string;
  lat: number;
  lon: number;
}

/** A Nominatim hit with the details needed to tell candidates apart. */
export interface GeocodeCandidate extends GeocodeResult {
  name?: string;
  /** Nominatim `category`/`type`, e.g. "shop"/"car". */
  category?: string;
  type?: string;
  postcode?: string;
  houseNumber?: string;
  /**
   * Nominatim `place_rank`: 30 is a building or POI, 26–27 a street, lower
   * a district or town. Tells a rooftop hit from a street centroid.
   */
  placeRank?: number;
  /** Nominatim `addresstype`, e.g. "building", "road", "suburb". */
  addressType?: string;
}

/** A hit on a building, house number or POI, not a street or area centroid. */
export function isHouseLevel(hit: GeocodeCandidate): boolean {
  return (hit.placeRank ?? 0) >= 30 || hit.houseNumber != null;
}

/** An empty answer is cached for a day only: the address may be fixed in OSM. */
const EMPTY_GEOCODE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Geocoder hits for a query. With the dealership's name the hit an analysis
 * would pick comes first (`pickGeocodeHit`), so a preview and the analysis
 * agree; the name only ranks the hits and is not sent anywhere.
 */
export async function geocode(
  query: string,
  name?: string,
): Promise<GeocodeResult[]> {
  if (isPoBox(query)) return [];
  const hits = await geocodeCandidates(query);
  const pick =
    name != null ? pickGeocodeHit(hits, { name, address: query }) : null;
  const ordered = pick
    ? [pick.hit, ...hits.filter((hit) => hit !== pick.hit)]
    : hits;
  return ordered.map(({ label, lat, lon }) => ({ label, lat, lon }));
}

export async function geocodeCandidates(
  query: string,
): Promise<GeocodeCandidate[]> {
  const key = `geocode:v3:${query.toLowerCase().trim()}`;
  return cached(
    key,
    TTL.geocode,
    async () => {
      const url = `${NOMINATIM}?format=jsonv2&addressdetails=1&limit=5&q=${encodeURIComponent(query)}`;
      const res = await fetchWithResilience(url);
      if (!res.ok) throw new Error(`Nominatim ${res.status}`);
      const data = (await res.json()) as Array<{
        display_name: string;
        lat: string;
        lon: string;
        name?: string;
        category?: string;
        type?: string;
        place_rank?: number;
        addresstype?: string;
        address?: { postcode?: string; house_number?: string };
      }>;
      return data.map((d) => ({
        label: d.display_name,
        lat: Number(d.lat),
        lon: Number(d.lon),
        ...(d.name ? { name: d.name } : {}),
        ...(d.category ? { category: d.category } : {}),
        ...(d.type ? { type: d.type } : {}),
        ...(d.address?.postcode ? { postcode: d.address.postcode } : {}),
        ...(d.address?.house_number
          ? { houseNumber: d.address.house_number }
          : {}),
        ...(typeof d.place_rank === "number"
          ? { placeRank: d.place_rank }
          : {}),
        ...(d.addresstype ? { addressType: d.addresstype } : {}),
      }));
    },
    (hits) => (hits.length === 0 ? EMPTY_GEOCODE_TTL_MS : TTL.geocode),
  );
}

/** Vehicle-trade POI types: a hit of this kind is likely the dealership itself. */
const VEHICLE_TRADE_TYPES = new Set([
  "shop:car",
  "shop:car_repair",
  "shop:motorcycle",
  "shop:truck",
  "amenity:car_rental",
]);

/** A vehicle-trade POI carrying the dealership's name: the site itself. */
export function isSitePoi(hit: GeocodeCandidate, name?: string): boolean {
  return (
    VEHICLE_TRADE_TYPES.has(`${hit.category}:${hit.type}`) &&
    hit.name != null &&
    matchesSite({ name: hit.name }, name)
  );
}

/** Below this score gap, two hits further apart than `AMBIGUOUS_DISTANCE_M` are ambiguous. */
const AMBIGUOUS_SCORE_GAP = 1;
const AMBIGUOUS_DISTANCE_M = 100;

export interface GeocodePick {
  hit: GeocodeCandidate;
  /** Set when a different, distant hit scored almost as well. */
  ambiguity?: string;
}

/**
 * Picks the hit most likely to be *this* dealership rather than taking the
 * first one Nominatim returns, which is often the street or a neighbour.
 *
 * Deterministic: points for a matching postcode (+2) and house number (+1),
 * for the dealership's name (+2) and for a vehicle-trade POI type (+1); a
 * contradicting postcode costs 3, so a same-named branch in another town
 * never wins. Ties keep Nominatim's order.
 */
export function pickGeocodeHit(
  hits: GeocodeCandidate[],
  context: { name?: string; address?: string },
): GeocodePick | null {
  if (hits.length === 0) return null;
  const postcode = postcodeOf(context.address);
  const houseNumber = houseNumberOf(context.address);

  const scored = hits.map((hit, index) => {
    let score = 0;
    if (postcode && hit.postcode) score += hit.postcode === postcode ? 2 : -3;
    if (
      houseNumber &&
      hit.houseNumber?.replace(/\s+/g, "").toLowerCase() === houseNumber
    ) {
      score += 1;
    }
    if (hit.name && matchesSite({ name: hit.name }, context.name)) score += 2;
    if (VEHICLE_TRADE_TYPES.has(`${hit.category}:${hit.type}`)) score += 1;
    return { hit, index, score };
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);

  const [best, second] = scored;
  if (
    second &&
    best.score - second.score < AMBIGUOUS_SCORE_GAP &&
    distanceM(best.hit, second.hit) > AMBIGUOUS_DISTANCE_M
  ) {
    return {
      hit: best.hit,
      ambiguity: `geocoding ambiguous: '${second.hit.label}' matched about as well, ${Math.round(distanceM(best.hit, second.hit))} m away`,
    };
  }
  return { hit: best.hit };
}

function distanceM(a: GeocodeResult, b: GeocodeResult): number {
  return haversineMeters(a.lat, a.lon, b.lat, b.lon);
}
