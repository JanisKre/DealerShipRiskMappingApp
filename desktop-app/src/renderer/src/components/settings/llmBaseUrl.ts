import type { LlmProvider } from "@shared/types";

export type LlmBaseUrlProblem =
  "invalid-url" | "not-http" | "credentials" | "not-local";

export type LlmBaseUrlValidation =
  { ok: true; url: string } | { ok: false; problem: LlmBaseUrlProblem };

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Checks a custom AI base URL before it is saved, with the same rules the
 * main process applies before it sends a request (`normalizeBaseUrl` in
 * llm.service.ts): an absolute HTTP(S) URL without embedded credentials, and
 * for a local model an address on this computer. An empty field is valid:
 * it means the provider's default endpoint.
 */
export function validateLlmBaseUrl(
  value: string,
  provider: LlmProvider,
): LlmBaseUrlValidation {
  const trimmed = value.trim();
  if (trimmed === "") return { ok: true, url: "" };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, problem: "invalid-url" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return { ok: false, problem: "not-http" };
  if (url.username || url.password)
    return { ok: false, problem: "credentials" };
  if (provider === "local" && !LOOPBACK_HOSTS.has(url.hostname))
    return { ok: false, problem: "not-local" };
  return { ok: true, url: trimmed };
}
