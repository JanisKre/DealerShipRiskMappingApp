/**
 * In-memory circuit breaker for external geodata endpoints.
 *
 * Boundary detection fans out across a dozen public services, several of which
 * are permanently unreachable in some regions. Without a breaker, every single
 * analysis pays the full timeout for each dead endpoint.
 *
 * Extracted from `alkis.service.ts`, where it guarded the state cadastre WFS
 * endpoints, so Overpass and the newer WFS sources can reuse the same policy.
 *
 * The important distinction it encodes: a service that answers "I have nothing
 * at this location" is *healthy*. Only network and HTTP failures trip it.
 */

export interface CircuitBreakerOptions {
  /** Consecutive failures before the circuit opens. */
  failThreshold?: number;
  /** How long the circuit stays open before the next attempt is allowed. */
  openMs?: number;
}

export interface CircuitBreaker {
  /** True while the key should be skipped entirely. */
  isOpen(key: string): boolean;
  /**
   * `openForMs` opens the circuit immediately for that long, regardless of the
   * failure count. For a server that has explicitly told us to back off — an
   * HTTP 429 with `Retry-After` — retrying twice more just to reach a threshold
   * is exactly the wrong response.
   */
  recordFailure(key: string, openForMs?: number): void;
  recordSuccess(key: string): void;
  /** Test seam: drops all recorded state. */
  reset(): void;
}

interface CircuitState {
  failCount: number;
  openUntil: number;
}

export const DEFAULT_FAIL_THRESHOLD = 3;
export const DEFAULT_OPEN_MS = 30_000;

export function createCircuitBreaker(
  options: CircuitBreakerOptions = {},
): CircuitBreaker {
  const failThreshold = options.failThreshold ?? DEFAULT_FAIL_THRESHOLD;
  const openMs = options.openMs ?? DEFAULT_OPEN_MS;
  const circuits = new Map<string, CircuitState>();

  return {
    isOpen(key) {
      const circuit = circuits.get(key);
      if (!circuit) return false;
      // Only an *opened* circuit expires. Checking `Date.now() >= openUntil`
      // unconditionally would treat a still-accumulating circuit (openUntil 0)
      // as expired and drop its failure count — and since callers ask isOpen()
      // before every attempt, the count could then never reach the threshold.
      if (circuit.openUntil > 0 && Date.now() >= circuit.openUntil) {
        circuits.delete(key);
        return false;
      }
      return circuit.failCount >= failThreshold;
    },
    recordFailure(key, openForMs) {
      const circuit = circuits.get(key) ?? { failCount: 0, openUntil: 0 };
      circuit.failCount += 1;
      if (openForMs != null && openForMs > 0) {
        circuit.failCount = Math.max(circuit.failCount, failThreshold);
        circuit.openUntil = Date.now() + openForMs;
      } else if (circuit.failCount >= failThreshold) {
        circuit.openUntil = Date.now() + openMs;
      }
      circuits.set(key, circuit);
    },
    recordSuccess(key) {
      circuits.delete(key);
    },
    reset() {
      circuits.clear();
    },
  };
}
