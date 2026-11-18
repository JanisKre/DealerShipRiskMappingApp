/**
 * Bounded HTTP access for external providers.
 *
 * All requests made by the main process get a timeout. Idempotent requests
 * are retried for transient network/server failures; mutations and streaming
 * requests opt out by default so they are never duplicated accidentally.
 */

export interface HttpRequestOptions {
  /** Time until the response headers arrive. */
  timeoutMs?: number;
  /**
   * Longest pause between two chunks of the response body once the headers
   * are in. A server that sends headers and then stalls used to block an
   * analysis for good, since the header timeout no longer applied. 0 turns
   * it off. Default: the larger of 60 s and `timeoutMs`.
   */
  bodyIdleTimeoutMs?: number;
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

/** The function that actually sends a request (see `setHttpTransport`). */
export type HttpTransport = (
  input: RequestInfo | URL,
  init: RequestInit,
) => Promise<Response>;

// Node's fetch until the process installs Electron's network stack. Looked up
// on every call so tests can spy on `globalThis.fetch`.
const nodeFetchTransport: HttpTransport = (input, init) =>
  globalThis.fetch(input, init);
let transport: HttpTransport = nodeFetchTransport;

/**
 * Routes every request of this process through `next`. The main process and
 * the utility processes install Electron's `net.fetch` at start-up: unlike
 * Node's fetch it uses Chromium's network stack, so the system proxy
 * settings (PAC, WPAD, authenticating proxies) and the operating system's
 * certificate store, including a company's TLS-inspection root, apply.
 */
export function setHttpTransport(next: HttpTransport | null): void {
  transport = next ?? nodeFetchTransport;
}

/**
 * Adapts Electron's `net.fetch` to `HttpTransport`. Requests never carry
 * the session's cookies, as with Node's fetch: map tiles loaded by the
 * renderer must not turn into tracking state on API calls. Unlike Node's
 * fetch, `net.fetch` also reads `file:` URLs, so anything but HTTP(S) is
 * refused here: a configured provider URL must never become a file read.
 */
export function electronNetTransport(
  netFetch: (input: string | Request, init?: RequestInit) => Promise<Response>,
): HttpTransport {
  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const protocol = new URL(url).protocol;
    if (protocol !== "https:" && protocol !== "http:") {
      throw new HttpRequestError(`Unsupported URL scheme: ${protocol}`);
    }
    return netFetch(input instanceof URL ? input.toString() : input, {
      ...init,
      credentials: "omit",
    });
  };
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_BODY_IDLE_MS = 60_000;
/** Longest Retry-After the app waits for before a retry. */
const MAX_RETRY_AFTER_MS = 60_000;

/**
 * User-Agent of every request: public services (Nominatim, Overpass, the
 * state geoportals) ask clients to identify themselves. Set once at start
 * with the app version; requests that set their own keep it.
 */
let userAgent = "DealershipRiskMapping-Desktop";
export function setUserAgent(next: string): void {
  userAgent = next;
}
export function currentUserAgent(): string {
  return userAgent;
}
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
  // Esri World Imagery Wayback: tiles (incl. tilemap) and per-version
  // metadata. A capture already caps itself at TILE_FETCH_CONCURRENCY; this
  // keeps parallel analyses from stacking up on the archive.
  "wayback.maptiles.arcgis.com": { maxConcurrent: 6 },
  "metadata.maptiles.arcgis.com": { maxConcurrent: 4 },
  // DWD open data: station archives for the hail history, a few at a time.
  "opendata.dwd.de": { maxConcurrent: 2 },
  // State geoportals (orthophotos, cadastre WFS/WMS, address points) and
  // the BKG index: each capture already caps its tile requests, this keeps
  // three parallel analyses from stacking up on one state's server.
  ...Object.fromEntries(
    [
      "sgx.geodatenzentrum.de",
      "owsproxy.lgl-bw.de",
      "wmtsod1.bayernwolke.de",
      "geoservices.bayern.de",
      "download1.bayernwolke.de",
      "download2.bayernwolke.de",
      "gdi.berlin.de",
      "isk.geobasis-bb.de",
      "inspire.brandenburg.de",
      "geodienste.bremen.de",
      "geodienste.hamburg.de",
      "www.gds-srv.hessen.de",
      "www.gds.hessen.de",
      "inspire-hessen.de",
      "www.geodaten-mv.de",
      "opendata.lgln.niedersachsen.de",
      "www.inspire.niedersachsen.de",
      "www.wms.nrw.de",
      "www.wfs.nrw.de",
      "geo4.service24.rlp.de",
      "geo5.service24.rlp.de",
      "geoportal.saarland.de",
      "geodienste.sachsen.de",
      "www.geodatenportal.sachsen-anhalt.de",
      "geodatenportal.sachsen-anhalt.de",
      "service.gdi-sh.de",
      "www.geoproxy.geoportal-th.de",
    ].map((host) => [host, { maxConcurrent: 6 }]),
  ),
};

class HostGate {
  private active = 0;
  private nextStartAt = 0;

  constructor(private readonly policy: HostPolicy) {}

  /** A service with a fixed request rate (Nominatim), which bans on abuse. */
  get paced(): boolean {
    return (this.policy.minIntervalMs ?? 0) > 0;
  }

  /**
   * After a 429 or 403 from a rate-limited service: no request starts
   * before `ms` have passed (Nominatim blocks clients that keep going).
   */
  coolDown(ms: number): void {
    this.nextStartAt = Math.max(this.nextStartAt, Date.now() + ms);
  }
  private readonly waiting: Array<() => void> = [];

  /** Resolves with a release function once a slot is free and paced. */
  async acquire(): Promise<() => void> {
    const max = this.policy.maxConcurrent ?? Number.POSITIVE_INFINITY;
    if (this.active < max) this.active++;
    // A released slot is handed over directly, so `active` stays counted.
    else await new Promise<void>((resolve) => this.waiting.push(resolve));

    const interval = this.policy.minIntervalMs ?? 0;
    const now = Date.now();
    const startAt = Math.max(now, this.nextStartAt);
    if (interval > 0) this.nextStartAt = startAt + interval;
    if (startAt > now) await delay(startAt - now);

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
    let retryAfterMs = 0;
    try {
      const response = await fetchOnce(
        input,
        withUserAgent(init),
        options.timeoutMs,
        options.bodyIdleTimeoutMs,
      );
      release?.();
      if (response.status === 429 || response.status === 503) {
        retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
      }
      // A rate-limited shared service: pause every caller, not only this
      // one, and do not hammer it with immediate retries.
      if (gate?.paced && (response.status === 429 || response.status === 403)) {
        gate.coolDown(Math.max(retryAfterMs, RATE_LIMIT_COOLDOWN_MS));
      }
      if (
        !retryStatuses.has(response.status) ||
        attempt === retries ||
        retryAfterMs > MAX_RETRY_AFTER_MS
      ) {
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
    await delay(
      Math.max(
        retryAfterMs,
        (options.backoffMs ?? DEFAULT_BACKOFF_MS) * 2 ** attempt,
      ),
    );
  }

  throw lastError instanceof Error
    ? lastError
    : new HttpRequestError("HTTP request failed");
}

/** Pause for a host that answered 429/403 (when it sends no Retry-After). */
const RATE_LIMIT_COOLDOWN_MS = 30_000;

/** Retry-After in milliseconds (seconds or an HTTP date); 0 when absent. */
export function parseRetryAfter(value: string | null): number {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? 0 : Math.max(0, at - Date.now());
}

/** Adds the app's User-Agent unless the request sets one; keeps the headers' shape. */
function withUserAgent(init: RequestInit): RequestInit {
  const given = init.headers;
  if (given instanceof Headers) {
    if (given.has("user-agent")) return init;
    const headers = new Headers(given);
    headers.set("User-Agent", userAgent);
    return { ...init, headers };
  }
  if (Array.isArray(given)) {
    return given.some(([name]) => name.toLowerCase() === "user-agent")
      ? init
      : { ...init, headers: [...given, ["User-Agent", userAgent]] };
  }
  const record = (given ?? {}) as Record<string, string>;
  return Object.keys(record).some((name) => name.toLowerCase() === "user-agent")
    ? init
    : { ...init, headers: { ...record, "User-Agent": userAgent } };
}

/**
 * The response with a body that aborts the request when the server sends
 * no chunk for `idleMs` while one is awaited, so a stalled server ends in
 * an error instead of a hang.
 */
function withBodyIdleTimeout(
  response: Response,
  controller: AbortController,
  idleMs: number,
): Response {
  if (!response.body || idleMs <= 0) return response;
  const reader = response.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stalled = false;
  const stalledError = (): HttpRequestError =>
    new HttpRequestError("HTTP response stalled", { timedOut: true });
  const arm = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      stalled = true;
      controller.abort();
      // Ends a pending read even where the abort does not reach the body.
      void reader.cancel(stalledError()).catch(() => undefined);
    }, idleMs);
    (timer as { unref?: () => void }).unref?.();
  };
  // The clock runs only while a read waits on the server, so a slow
  // consumer (parsing, writing to disk) never counts as a stalled server.
  const body = new ReadableStream<Uint8Array>({
    async pull(stream) {
      try {
        arm();
        const { done, value } = await reader.read();
        clearTimeout(timer);
        if (stalled) {
          stream.error(stalledError());
          return;
        }
        if (done) {
          stream.close();
          return;
        }
        stream.enqueue(value);
      } catch (error) {
        clearTimeout(timer);
        stream.error(stalled ? stalledError() : error);
      }
    },
    cancel(reason) {
      clearTimeout(timer);
      return reader.cancel(reason);
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function fetchOnce(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  bodyIdleTimeoutMs = Math.max(DEFAULT_BODY_IDLE_MS, timeoutMs),
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
    const response = await transport(input, {
      ...init,
      signal: controller.signal,
    });
    return withBodyIdleTimeout(response, controller, bodyIdleTimeoutMs);
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
