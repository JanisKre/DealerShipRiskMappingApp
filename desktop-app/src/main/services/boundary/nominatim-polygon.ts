import type { BoundaryResult, Polygon } from "@shared/types";
import { cached, TTL } from "../cache.service";
import { fetchWithResilience } from "../http.service";
import { polygonAreaSqm } from "../geo-math";
import { checkRing, distanceToRingM, type LonLat } from "../boundary-geometry";
import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";

/**
 * Address-matched geometry from Nominatim.
 *
 * `polygon_geojson=1` makes Nominatim return the *shape* of the object it
 * matched, not just its centroid. When a dealership's lot is mapped in OSM,
 * this resolves it directly from the name and address — the strongest vector
 * prior available, because it is the one source that was matched on identity
 * rather than on proximity to a geocoded point.
 *
 * Deliberately **not** used to move the anchor. Nominatim regularly answers
 * with a street-interpolation point or a neighbouring roof, and shifting the
 * anchor would silently change every downstream cache key.
 */

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "DealershipRiskMapping-Desktop/0.1 (contact: internal)";

/**
 * How far a returned polygon may sit from the geocoded point before it is
 * treated as a different place. Nominatim will happily match a same-named
 * branch in another city.
 */
export const MAX_MATCH_DISTANCE_M = 150;

export interface NominatimGeoJson {
  type: string;
  coordinates: unknown;
}

export interface NominatimItem {
  osm_type?: string;
  osm_id?: number;
  display_name?: string;
  category?: string;
  type?: string;
  geojson?: NominatimGeoJson;
}

function ringOf(coordinates: unknown): LonLat[] | null {
  if (!Array.isArray(coordinates) || coordinates.length === 0) return null;
  const ring = coordinates[0];
  if (!Array.isArray(ring) || ring.length < 4) return null;
  const out: LonLat[] = [];
  for (const point of ring) {
    if (
      !Array.isArray(point) ||
      typeof point[0] !== "number" ||
      typeof point[1] !== "number"
    ) {
      return null;
    }
    out.push([point[0], point[1]]);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) out.push([...first]);
  return out;
}

/**
 * Outer ring of a matched object. A MultiPolygon yields its largest part — a
 * dealership split across a road is mapped that way, and the main lot is the
 * part worth proposing.
 */
export function extractNominatimRing(item: NominatimItem): LonLat[] | null {
  const geojson = item.geojson;
  if (!geojson) return null;
  if (geojson.type === "Polygon") return ringOf(geojson.coordinates);
  if (geojson.type === "MultiPolygon") {
    if (!Array.isArray(geojson.coordinates)) return null;
    let best: LonLat[] | null = null;
    let bestArea = 0;
    for (const part of geojson.coordinates) {
      const ring = ringOf(part);
      if (!ring) continue;
      const area = polygonAreaSqm(ring);
      if (area > bestArea) {
        bestArea = area;
        best = ring;
      }
    }
    return best;
  }
  // Point / LineString carry no usable area.
  return null;
}

/**
 * Picks the best-matching polygon near the anchor, or null.
 *
 * Proximity is a hard gate, not a tiebreak: a polygon that neither contains
 * the anchor nor comes within `MAX_MATCH_DISTANCE_M` of it is a different
 * place, however well its name matched.
 */
export function pickNominatimRing(
  items: NominatimItem[],
  lat: number,
  lon: number,
  maxDistanceM = MAX_MATCH_DISTANCE_M,
): { ring: LonLat[]; item: NominatimItem; contains: boolean } | null {
  let best: { ring: LonLat[]; item: NominatimItem; contains: boolean } | null =
    null;
  let bestDistance = Infinity;

  for (const item of items) {
    const ring = extractNominatimRing(item);
    if (!ring) continue;
    if (!checkRing(ring, { minAreaSqm: 100, maxAreaSqm: 500_000 }).valid) {
      continue;
    }
    let contains = false;
    try {
      contains = booleanPointInPolygon([lon, lat], {
        type: "Polygon",
        coordinates: [ring],
      });
    } catch {
      contains = false;
    }
    const distance = contains ? 0 : distanceToRingM([lon, lat], ring);
    if (distance > maxDistanceM) continue;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { ring, item, contains };
    }
  }
  return best;
}

function buildQuery(name?: string, address?: string): string | null {
  const parts = [name, address].filter(
    (part): part is string => typeof part === "string" && part.trim() !== "",
  );
  // Without at least an address there is nothing to match on that the
  // coordinate-based providers do not already cover.
  if (parts.length === 0 || !address) return null;
  return parts.join(", ").slice(0, 250);
}

/** Boundary provider adapter. Returns null when there is nothing to match on. */
export async function fromNominatimPolygon(
  lat: number,
  lon: number,
  context?: { name?: string; address?: string },
): Promise<BoundaryResult | null> {
  const query = buildQuery(context?.name, context?.address);
  if (!query) return null;

  const key = `nominatim-poly:v1:${query.toLowerCase()}`;
  const items = await cached<NominatimItem[] | null>(
    key,
    TTL.geocode,
    async () => {
      const url =
        `${NOMINATIM_URL}?format=jsonv2&polygon_geojson=1&extratags=1&limit=5` +
        `&q=${encodeURIComponent(query)}`;
      const res = await fetchWithResilience(url, {
        headers: { "User-Agent": USER_AGENT },
      });
      if (!res.ok) return null;
      return (await res.json()) as NominatimItem[];
    },
  );
  if (!items || items.length === 0) return null;

  const match = pickNominatimRing(items, lat, lon);
  if (!match) return null;

  const polygon: Polygon = { type: "Polygon", coordinates: [match.ring] };
  // Identity-matched geometry that also contains the point is about as good as
  // a vector prior gets; one that merely sits nearby is a weaker claim.
  const confidence = match.contains ? 0.82 : 0.62;
  return {
    source: "osm",
    role: "parkingSurface",
    provider: "nominatim-polygon",
    polygon,
    areaSqm: polygonAreaSqm(match.ring),
    confidence,
    ...(match.item.display_name
      ? { label: match.item.display_name.split(",")[0] }
      : {}),
    evidence: {
      source: "Nominatim / OpenStreetMap",
      retrievedAt: new Date().toISOString(),
      method: "address-matched OSM object geometry (polygon_geojson)",
      confidence,
      fallbackUsed: false,
      limitations: [
        "Matched on name and address text, not on ownership",
        "Nominatim may match a differently-sized OSM object at the same address",
      ],
    },
  } satisfies BoundaryResult;
}
