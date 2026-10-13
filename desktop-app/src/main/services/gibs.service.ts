import {
  buildCmrGranuleSearchUrl,
  GibsProductSchema,
  mergeRecentScenes,
  parseCmrGranules,
  RECENT_SCENE_DAYS,
  RECENT_SCENE_MAX_CLOUD,
  type GibsProduct,
  type RecentScene,
  type RecentScenes,
} from "@shared/imagery-gibs";
import { cached, TTL } from "./cache.service";
import { fetchWithResilience } from "./http.service";

/**
 * Recent 30 m HLS scenes over a location from NASA's CMR catalogue, for the
 * map's context overlay (shared/imagery-gibs.ts). Keyless.
 */

const HEADERS = { "User-Agent": "DealershipRiskMapping/1.0 (desktop)" };
/** Half-width of the search box; small enough to stay on one HLS tile. */
const SEARCH_RADIUS_DEG = 0.005;
const DAY_MS = 24 * 60 * 60 * 1000;

async function scenesFor(
  product: GibsProduct,
  bbox: [number, number, number, number],
  startIso: string,
  endIso: string,
): Promise<RecentScene[]> {
  const res = await fetchWithResilience(
    buildCmrGranuleSearchUrl(product, bbox, startIso, endIso),
    { headers: HEADERS },
  );
  if (!res.ok) throw new Error(`CMR ${product} ${res.status}`);
  return parseCmrGranules(await res.json(), product);
}

export async function recentScenes(
  lat: number,
  lon: number,
  now: Date = new Date(),
): Promise<RecentScenes> {
  const today = now.toISOString().slice(0, 10);
  const startDay = new Date(now.getTime() - (RECENT_SCENE_DAYS - 1) * DAY_MS)
    .toISOString()
    .slice(0, 10);
  // ~1 km buckets: one HLS tile is 110 km, and the scene list only
  // changes with new acquisitions (a few per week).
  const key = `gibs-scenes:v1:${today}:${lat.toFixed(2)},${lon.toFixed(2)}`;
  return cached(key, TTL.recentScenes, async () => {
    const bbox: [number, number, number, number] = [
      lon - SEARCH_RADIUS_DEG,
      lat - SEARCH_RADIUS_DEG,
      lon + SEARCH_RADIUS_DEG,
      lat + SEARCH_RADIUS_DEG,
    ];
    const lists = await Promise.all(
      GibsProductSchema.options.map((product) =>
        scenesFor(product, bbox, `${startDay}T00:00:00Z`, now.toISOString()),
      ),
    );
    return {
      scenes: mergeRecentScenes(lists),
      days: RECENT_SCENE_DAYS,
      maxCloud: RECENT_SCENE_MAX_CLOUD,
    };
  });
}
