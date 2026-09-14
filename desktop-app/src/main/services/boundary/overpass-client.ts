import { fetchWithResilience } from "../http.service";
import { createCircuitBreaker } from "./circuit-breaker";

/**
 * Shared Overpass client.
 *
 * Two things here were learned the hard way, by probing the live service after
 * a long run of apparent "outages" that turned out to be self-inflicted:
 *
 * 1. **Requests without a `User-Agent` are rejected with HTTP 406.** The client
 *    previously sent none, so a share of every failure was ours.
 * 2. **GET succeeds where POST returns 504.** Probed back to back against the
 *    main instance, `POST` with the query as the body answered 504 while the
 *    documented `GET ?data=` answered 200 with full geometry. GET is therefore
 *    the primary transport; POST is kept only for queries too long for a URL.
 *
 * The public instances are genuinely flaky — three identical requests during
 * testing gave a connection error, a 504, and then a 200 with 1,145 elements.
 * The **mirrors are the retry strategy**: re-asking one overloaded server is
 * worth less than asking a different one, and retrying in place is what made a
 * two-site benchmark take ten minutes. So each mirror gets a single bounded
 * attempt, and the list is walked twice.
 *
 * Mirrors must serve the **whole planet**. A region-limited mirror answers 200
 * with zero elements outside its extract, which callers would cache as "no
 * features at this site" — indistinguishable from a real empty result and far
 * worse than an error. `overpass.osm.ch` was rejected for exactly this reason.
 */
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const USER_AGENT = "DealershipRiskMapping-Desktop/0.1 (contact: internal)";

/**
 * Longest query we will put in a URL. Overpass accepts far more, but beyond
 * this the request falls back to POST rather than risking a proxy truncating
 * it silently.
 */
const MAX_GET_QUERY_CHARS = 6_000;

/**
 * Per-attempt budget. Generous enough for a real Overpass query over a 300 m
 * radius (~20 s observed) without letting one stalled mirror dominate the run.
 */
const ATTEMPT_TIMEOUT_MS = 30_000;
/** Walk the mirror list twice: a mirror that 504s may serve the next request. */
const MIRROR_PASSES = 2;

const breaker = createCircuitBreaker({ failThreshold: 3, openMs: 60_000 });

/** Fallback pause when a mirror rate-limits us without saying for how long. */
export const DEFAULT_RATE_LIMIT_PAUSE_MS = 10 * 60_000;
/** Never trust an absurd Retry-After into silencing a mirror for hours. */
const MAX_RATE_LIMIT_PAUSE_MS = 30 * 60_000;

/**
 * How long to stand down after a 429, honouring `Retry-After` when the server
 * sends one (either as seconds or as an HTTP date).
 */
export function rateLimitPauseMs(
  retryAfter: string | null,
  now: number = Date.now(),
): number {
  if (retryAfter) {
    const seconds = Number.parseInt(retryAfter, 10);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(seconds * 1_000, MAX_RATE_LIMIT_PAUSE_MS);
    }
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date) && date > now) {
      return Math.min(date - now, MAX_RATE_LIMIT_PAUSE_MS);
    }
  }
  return DEFAULT_RATE_LIMIT_PAUSE_MS;
}

/** Test seam. */
export function resetOverpassCircuits(): void {
  breaker.reset();
}

export async function fetchOverpass<T>(
  query: string,
): Promise<{ elements: T[] } | null> {
  const useGet = query.length <= MAX_GET_QUERY_CHARS;

  for (let pass = 0; pass < MIRROR_PASSES; pass += 1) {
    for (const url of OVERPASS_ENDPOINTS) {
      if (breaker.isOpen(url)) continue;
      try {
        const res = await fetchWithResilience(
          useGet ? `${url}?${new URLSearchParams({ data: query })}` : url,
          useGet
            ? { method: "GET", headers: { "User-Agent": USER_AGENT } }
            : {
                method: "POST",
                headers: {
                  "Content-Type": "text/plain",
                  "User-Agent": USER_AGENT,
                },
                body: query,
              },
          // One attempt per mirror; the mirror list provides the redundancy.
          { retries: 0, timeoutMs: ATTEMPT_TIMEOUT_MS },
        );
        if (res.status === 429) {
          // The public instances rate-limit by IP. Retrying in 250 ms — which
          // is what a generic retry policy does — burns the remaining quota and
          // makes the block last longer. Stand this mirror down and move on.
          breaker.recordFailure(
            url,
            rateLimitPauseMs(res.headers.get("retry-after")),
          );
          continue;
        }
        if (!res.ok) {
          breaker.recordFailure(url);
          continue;
        }
        breaker.recordSuccess(url);
        return (await res.json()) as { elements: T[] };
      } catch {
        breaker.recordFailure(url);
      }
    }
  }

  // Either every mirror failed, or every mirror is standing down. Both are
  // "could not ask", which callers must distinguish from "nothing found" and
  // must not cache. Clearing the breaker to try again here would hammer a
  // service that has explicitly told us to stop.
  return null;
}
