/**
 * Bounded HTTP access for external providers.
 *
 * All requests made by the main process get a timeout. Idempotent requests
 * are retried for transient network/server failures; mutations and streaming
 * requests opt out by default so they are never duplicated accidentally.
 */

export interface HttpRequestOptions {
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
  retryStatuses?: readonly number[];
}

export class HttpRequestError extends Error {
  readonly status?: number;
  readonly timedOut: boolean;

  constructor(
    message: string,
    options: { status?: number; timedOut?: boolean } = {},
  ) {
    super(message);
    this.name = "HttpRequestError";
    this.status = options.status;
    this.timedOut = options.timedOut ?? false;
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_BACKOFF_MS = 250;
const DEFAULT_RETRY_STATUSES = [408, 425, 429, 500, 502, 503, 504];

interface HostPolicy {
  /** Minimum gap between request starts. */
  minIntervalMs?: number;
  /** Maximum requests in flight at once. */
  maxConcurrent?: number;
}

/**
 * Fair-use limits of shared public services. A portfolio import analyses
 * several locations in parallel; without a shared gate those requests would
 * add up past the providers' usage policies and get the app rate-limited.
 */
const HOST_POLICIES: Record<string, HostPolicy> = {
  // Nominatim usage policy: an absolute maximum of 1 request per second.
  "nominatim.openstreetmap.org": { minIntervalMs: 1_100, maxConcurrent: 1 },
  // Public Overpass instances grant about two concurrent slots per client.
  "overpass-api.de": { maxConcurrent: 2 },
  "lz4.overpass-api.de": { maxConcurrent: 2 },
  "overpass.kumi.systems": { maxConcurrent: 2 },
  "overpass.private.coffee": { maxConcurrent: 2 },
  // Photon's public instance asks for moderate use; search sends two queries
  // per keystroke pause (all places + dealerships only).
  "photon.komoot.io": { maxConcurrent: 2 },
};

class HostGate {
  private active = 0;
  private nextStartAt = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly policy: HostPolicy) {}

  /** Resolves with a release function once a slot is free and paced. */
  async acquire(): Promise<() => void> {
    const max = this.policy.maxConcurrent ?? Number.POSITIVE_INFINITY;
    if (this.active < max) this.active++;
    // A released slot is handed over directly, so `active` stays counted.
    else await new Promise<void>((resolve) => this.waiting.push(resolve));

    const interval = this.policy.minIntervalMs ?? 0;
    if (interval > 0) {
      const now = Date.now();
      const startAt = Math.max(now, this.nextStartAt);
      this.nextStartAt = startAt + interval;
      if (startAt > now) await delay(startAt - now);
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    };
  }
}

const hostGates = new Map<string, HostGate>();

function hostGateFor(input: RequestInfo | URL): HostGate | null {
  let host: string;
  try {
    host = new URL(input instanceof Request ? input.url : String(input))
      .hostname;
  } catch {
    return null;
  }
  const policy = HOST_POLICIES[host];
  if (!policy) return null;
  let gate = hostGates.get(host);
  if (!gate) {
    gate = new HostGate(policy);
    hostGates.set(host, gate);
  }
  return gate;
}

export async function fetchWithResilience(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: HttpRequestOptions = {},
): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const isIdempotent = ["GET", "HEAD", "OPTIONS"].includes(method);
  const retries = options.retries ?? (isIdempotent ? DEFAULT_RETRIES : 0);
  const retryStatuses = new Set(
    options.retryStatuses ?? DEFAULT_RETRY_STATUSES,
  );
  let lastError: unknown;

  const gate = hostGateFor(input);

  for (let attempt = 0; attempt <= retries; attempt++) {
    const release = gate ? await gate.acquire() : null;
    try {
      const response = await fetchOnce(input, init, options.timeoutMs);
      release?.();
      if (!retryStatuses.has(response.status) || attempt === retries) {
        return response;
      }
      lastError = new HttpRequestError(
        `HTTP request failed (${response.status})`,
        { status: response.status },
      );
    } catch (error) {
      release?.();
      if (isAbortFromCaller(error, init.signal ?? undefined)) throw error;
      lastError = error;
      if (attempt === retries) throw error;
    }
    await delay((options.backoffMs ?? DEFAULT_BACKOFF_MS) * 2 ** attempt);
  }

  throw lastError instanceof Error
    ? lastError
    : new HttpRequestError("HTTP request failed");
}

async function fetchOnce(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onCallerAbort = (): void => controller.abort(init.signal?.reason);

  if (init.signal?.aborted) onCallerAbort();
  else init.signal?.addEventListener("abort", onCallerAbort, { once: true });

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      throw new HttpRequestError("HTTP request timed out", { timedOut: true });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener("abort", onCallerAbort);
  }
}

function isAbortFromCaller(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(
    signal?.aborted &&
      error instanceof DOMException &&
      error.name === "AbortError",
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
