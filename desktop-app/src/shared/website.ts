/**
 * Dealership website URLs: shared by the OSM lookup (main), the manual
 * editor (renderer) and the session schema, so every stored link is an
 * absolute http(s) URL that the main process will open externally.
 */

export const WEBSITE_URL_MAX_LENGTH = 2048;

/** True for an absolute http(s) URL with a dotted host name. */
export function isHttpWebsiteUrl(value: string): boolean {
  if (value.length > WEBSITE_URL_MAX_LENGTH) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname.includes(".") &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

/**
 * Normalizes user or OSM input (`autohaus.de`, `www.autohaus.de/kontakt`,
 * `https://…`) to an absolute URL; `undefined` when it isn't a usable
 * http(s) website.
 */
export function normalizeWebsiteUrl(raw?: string): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  // `mailto:`, `javascript:` … — but not `host.de:8080`.
  if (!hasScheme && /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(trimmed))
    return undefined;
  const withScheme = hasScheme ? trimmed : `https://${trimmed}`;
  if (!isHttpWebsiteUrl(withScheme)) return undefined;
  return new URL(withScheme).href;
}

/** Short display form: host name without `www.`. */
export function websiteLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
