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

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetchOnce(input, init, options.timeoutMs);
      if (!retryStatuses.has(response.status) || attempt === retries) {
        return response;
      }
      lastError = new HttpRequestError(
        `HTTP request failed (${response.status})`,
        { status: response.status },
      );
    } catch (error) {
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
