/**
 * Validation of the user-defined satellite tile template (settings →
 * satellite source → custom). The main process fetches tiles from it for
 * vehicle detection and the renderer draws it as the basemap, so only a
 * fixed HTTPS host with the placeholders the app actually fills is
 * accepted. Anything else falls back to Esri (buildTileUrl).
 */

export const TILE_TEMPLATE_MAX_LENGTH = 2048;

/** Placeholders filled by fillTileTemplate/buildTileUrl and Leaflet alike. */
const PLACEHOLDERS = ["{z}", "{x}", "{y}", "{bbox-epsg-3857}", "{time}"];
const SAMPLE_VALUES: Record<string, string> = {
  "{z}": "0",
  "{x}": "0",
  "{y}": "0",
  "{bbox-epsg-3857}": "0,0,1,1",
  "{time}": "2020-01-01",
};

export type TileTemplateProblem =
  | "empty"
  | "too-long"
  | "invalid-url"
  | "not-https"
  | "credentials"
  | "placeholder-in-host"
  | "unknown-placeholder"
  | "missing-placeholders";

export type TileTemplateValidation =
  | { ok: true; template: string }
  | { ok: false; problem: TileTemplateProblem };

export function validateTileTemplate(value: string): TileTemplateValidation {
  const template = value.trim();
  if (template === "") return { ok: false, problem: "empty" };
  if (template.length > TILE_TEMPLATE_MAX_LENGTH) {
    return { ok: false, problem: "too-long" };
  }

  // Only known placeholders; a stray brace or e.g. Leaflet's {s} would
  // reach the provider literally from the main process.
  const placeholders: string[] = template.match(/\{[^{}]*\}/g) ?? [];
  const rest = template.replace(/\{[^{}]*\}/g, "");
  if (
    rest.includes("{") ||
    rest.includes("}") ||
    placeholders.some((p) => !PLACEHOLDERS.includes(p))
  ) {
    return { ok: false, problem: "unknown-placeholder" };
  }
  const hasXyz = ["{z}", "{x}", "{y}"].every((p) => placeholders.includes(p));
  if (!hasXyz && !placeholders.includes("{bbox-epsg-3857}")) {
    return { ok: false, problem: "missing-placeholders" };
  }

  // The host must be fixed: placeholders may only vary path and query.
  const authority = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(template)?.[1];
  if (authority?.includes("{")) {
    return { ok: false, problem: "placeholder-in-host" };
  }

  let url: URL;
  try {
    url = new URL(
      placeholders.reduce(
        (filled, p) => filled.replaceAll(p, SAMPLE_VALUES[p]),
        template,
      ),
    );
  } catch {
    return { ok: false, problem: "invalid-url" };
  }
  if (url.protocol !== "https:") return { ok: false, problem: "not-https" };
  if (url.username || url.password) {
    return { ok: false, problem: "credentials" };
  }
  return { ok: true, template };
}

/** True when the template may be fetched/drawn (see validateTileTemplate). */
export function isUsableTileTemplate(value: unknown): value is string {
  return typeof value === "string" && validateTileTemplate(value).ok;
}
