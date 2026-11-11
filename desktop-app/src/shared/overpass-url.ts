/**
 * Validation of a user-configured Overpass server (settings → OpenStreetMap
 * data). The main process sends queries to it, so only a plain interpreter
 * endpoint is accepted: HTTPS anywhere, or plain HTTP on this machine for a
 * local server, never with credentials, a query string or a fragment.
 */

export const OVERPASS_URL_MAX_LENGTH = 500;

export type OverpassUrlProblem =
  | "empty"
  | "too-long"
  | "invalid-url"
  | "not-https"
  | "credentials"
  | "query-or-fragment";

export type OverpassUrlValidation =
  | { ok: true; url: string }
  | { ok: false; problem: OverpassUrlProblem };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function validateOverpassUrl(value: string): OverpassUrlValidation {
  const trimmed = value.trim();
  if (trimmed === "") return { ok: false, problem: "empty" };
  if (trimmed.length > OVERPASS_URL_MAX_LENGTH) {
    return { ok: false, problem: "too-long" };
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, problem: "invalid-url" };
  }
  const local = LOCAL_HOSTS.has(url.hostname);
  if (!(url.protocol === "https:" || (url.protocol === "http:" && local))) {
    return { ok: false, problem: "not-https" };
  }
  if (url.username || url.password) {
    return { ok: false, problem: "credentials" };
  }
  if (
    url.search ||
    url.hash ||
    trimmed.includes("?") ||
    trimmed.includes("#")
  ) {
    return { ok: false, problem: "query-or-fragment" };
  }
  return { ok: true, url: url.toString() };
}
