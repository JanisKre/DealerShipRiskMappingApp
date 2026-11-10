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

/**
 * Overall budget for one evidence fetch across all mirrors. A healthy 300 m
 * query takes 20–30 s, so this leaves room for one mirror switch, but stops
 * an overloaded Overpass from holding a request for the 4 min the unbounded
 * mirror walk can take. The analysis itself waits far less (`osmEvidenceBy`);
 * this only bounds the request that keeps running in the background.
 */
export const OSM_EVIDENCE_BUDGET_MS = 60_000;

export async function fetchOsmEvidence(
  lat: number,
  lon: number,
  radiusM: number = OSM_EVIDENCE_RADIUS_M,
): Promise<OsmEvidence | null> {
  // v2: adds named business points; v1 entries lack them.
  const key = `osm-evidence:v2:${radiusM}:${lat.toFixed(5)},${lon.toFixed(5)}`;
  const hit = cacheGet<OsmEvidence>(key);
  if (hit) return hit;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = (async () => {
    try {
      const data = await fetchOverpass<OverpassElement>(
        buildOsmEvidenceQuery(lat, lon, radiusM),
        { budgetMs: OSM_EVIDENCE_BUDGET_MS },
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

/**
 * Result of waiting for the evidence until a deadline.
 *  - `answered`    Overpass answered (possibly with nothing mapped).
 *  - `unreachable` every mirror failed or stood down.
 *  - `pending`     still running at the deadline; the request carries on in
 *                  the background and caches its answer for the next run.
 */
export interface OsmEvidenceLookup {
  evidence: OsmEvidence | null;
  status: "answered" | "unreachable" | "pending";
}

/**
 * The site's evidence, or `pending` at `deadline` (epoch ms). Every consumer
 * of one analysis passes the same deadline and joins the same in-flight
 * request, so a slow Overpass costs the analysis that wait once, not once per
 * consumer. Without a finite deadline it waits for the request to finish.
 */
export async function osmEvidenceBy(
  lat: number,
  lon: number,
  deadline: number = Infinity,
): Promise<OsmEvidenceLookup> {
  const request = fetchOsmEvidence(lat, lon).then(
    (evidence): OsmEvidenceLookup => ({
      evidence,
      status: evidence ? "answered" : "unreachable",
    }),
    (): OsmEvidenceLookup => ({ evidence: null, status: "unreachable" }),
  );
  // `setTimeout(…, Infinity)` fires at once, so an open deadline needs no timer.
  if (!Number.isFinite(deadline)) return request;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<OsmEvidenceLookup>((resolve) => {
    timer = setTimeout(
      () => resolve({ evidence: null, status: "pending" }),
      Math.max(0, deadline - Date.now()),
    );
  });
  try {
    // A cached answer settles in a microtask and wins even a past deadline.
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
