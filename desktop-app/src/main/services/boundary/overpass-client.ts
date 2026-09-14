import { fetchWithResilience } from "../http.service";
import { createCircuitBreaker } from "./circuit-breaker";

/**
 * Shared Overpass client.
 *
 * The public main instance is regularly overloaded (504), so a load-balanced
 * mirror is tried before a query is treated as "nothing found" — the
 * difference between "this site has no mapped features" and "we could not ask"
 * matters, because the first is a result and the second is an outage.
 */
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

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
  for (const url of OVERPASS_ENDPOINTS) {
    if (breaker.isOpen(url)) continue;
    try {
      const res = await fetchWithResilience(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: query,
        },
        // fetchWithResilience defaults POST to zero retries because POST is not
        // generally idempotent. An Overpass query is a read, and every mirror
        // failing at once would otherwise discard all vector evidence.
        { retries: 1, timeoutMs: 30_000 },
      );
      if (res.status === 429) {
        // The public instances rate-limit by IP. Retrying in 250 ms — which is
        // what the generic retry policy does — burns the remaining quota and
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
  // Either every mirror failed, or every mirror is standing down. Both are
  // "could not ask", which callers must distinguish from "nothing found" and
  // must not cache. Clearing the breaker to try again here would hammer a
  // service that has explicitly told us to stop.
  return null;
}
