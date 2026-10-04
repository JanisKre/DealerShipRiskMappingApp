import { cacheGet, cacheSet, TTL } from "../cache.service";
import { fetchOverpass } from "./overpass-client";
import {
  buildOsmEvidenceQuery,
  parseOsmEvidence,
  OSM_EVIDENCE_RADIUS_M,
  type OsmEvidence,
  type OverpassElement,
} from "./osm-overpass";

/**
 * Cached OSM evidence for one site.
 *
 * One round trip replaces the two the pipeline used to make (a 250 m semantic
 * lookup plus a separate 60 m building lookup), and the result serves every
 * consumer: candidate geometry, barriers, roads and address nodes.
 *
 * Cached for a week rather than the hour the generic `overpass` TTL allowed.
 * Fences, roads, buildings and land use barely move; re-fetching them hourly
 * was pure latency on every re-analysis.
 */
// `fromOsm` and `fromOsmBuildings` both call this for the same point and run
// concurrently in the candidate chain (`Promise.allSettled`). Without this,
// the first call's `cacheGet` miss is still unresolved when the second
// checks the cache, so both fire the same Overpass query — doubling load on
// a public service and leaving whichever one "loses" the race to finish
// noticeably slower for no reason. Tracking the in-flight promise by key
// makes the second caller await the first's result instead.
const inFlight = new Map<string, Promise<OsmEvidence | null>>();

export async function fetchOsmEvidence(
  lat: number,
  lon: number,
  radiusM: number = OSM_EVIDENCE_RADIUS_M,
): Promise<OsmEvidence | null> {
  const key = `osm-evidence:v1:${radiusM}:${lat.toFixed(5)},${lon.toFixed(5)}`;
  const hit = cacheGet<OsmEvidence>(key);
  if (hit) return hit;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = (async () => {
    try {
      const data = await fetchOverpass<OverpassElement>(
        buildOsmEvidenceQuery(lat, lon, radiusM),
      );

      // Deliberately not written through `cached()`. That helper stores
      // whatever the fetcher returns, so a null would be persisted as "this
      // site has no OSM features" for the full week — one rate-limited
      // moment would blind the engine to a site long after the service
      // recovered. "Could not ask" is not an answer and must not be cached.
      if (!data) return null;

      const evidence = parseOsmEvidence({ elements: data.elements });
      cacheSet(key, evidence, TTL.osmVector);
      return evidence;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, request);
  return request;
}
