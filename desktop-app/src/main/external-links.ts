/**
 * Links the app hands to the system: `https:` and `mailto:` only.
 *
 * A plain `http:` address (dealer websites from OpenStreetMap often are)
 * is opened as `https:` on the same host and path; everything else
 * (`http:` to a local or private host, `file:`, `tel:`, custom schemes) is
 * refused.
 */
export function externalUrl(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol === "mailto:") return url.href;
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  if (url.protocol === "http:") {
    url.protocol = "https:";
    // An explicit port 80 belonged to plain HTTP.
    if (url.port === "80") url.port = "";
  }
  return url.href;
}
