import { cached, TTL } from "./cache.service";
import { fetchWithResilience } from "./http.service";
import { matchesSite } from "./boundary/site-membership";
import { haversineMeters } from "@shared/dedupe";

/**
 * Geocoding via Nominatim — im Main-Process direkt aufrufbar (kein CORS).
 * Ergebnisse werden persistent gecacht. Nominatim verlangt einen User-Agent.
 */
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "DealershipRiskMapping-Desktop/0.1 (contact: internal)";

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
}

export async function geocode(query: string): Promise<GeocodeResult[]> {
  return (await geocodeCandidates(query)).map(({ label, lat, lon }) => ({
    label,
    lat,
    lon,
  }));
}

export async function geocodeCandidates(
  query: string,
): Promise<GeocodeCandidate[]> {
  const key = `geocode:v2:${query.toLowerCase().trim()}`;
  return cached(key, TTL.geocode, async () => {
    const url = `${NOMINATIM}?format=jsonv2&addressdetails=1&limit=5&q=${encodeURIComponent(query)}`;
    const res = await fetchWithResilience(url, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) throw new Error(`Nominatim ${res.status}`);
    const data = (await res.json()) as Array<{
      display_name: string;
      lat: string;
      lon: string;
      name?: string;
      category?: string;
      type?: string;
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
    }));
  });
}

/** Vehicle-trade POI types: a hit of this kind is likely the dealership itself. */
const VEHICLE_TRADE_TYPES = new Set([
  "shop:car",
  "shop:car_repair",
  "shop:motorcycle",
  "shop:truck",
  "amenity:car_rental",
]);

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
  const postcode = context.address?.match(/\b\d{5}\b/)?.[0];
  const houseNumber = context.address
    ?.replace(/\b\d{5}\b/g, " ")
    .match(/\b\d+\s*[a-z]?\b/i)?.[0]
    ?.replace(/\s+/g, "")
    .toLowerCase();

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
