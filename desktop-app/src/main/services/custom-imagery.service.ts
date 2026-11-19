import sharp from "sharp";
import { buildTileUrl } from "@shared/constants";
import { lat2tile, lon2tile, type OwnSourceGap } from "@shared/imagery-sources";
import type { ImagerySourceTest } from "@shared/ipc-schema";
import { isUsableTileTemplate } from "@shared/tile-template";
import { cached, cacheKeyFragment } from "./cache.service";
import { fetchWithResilience } from "./http.service";
import { getSettings } from "./settings.service";

/**
 * The user's own tile source: one sample tile tells whether it has an image
 * at a place. "Test connection" in the settings shows that tile; the imagery
 * selection asks the same question before it uses the source, and falls back
 * to the automatic choice where the answer is no. Only the saved template is
 * fetched (it passed `validateTileTemplate` when it was saved), never a URL
 * from a request.
 */

/** Zoom of the sample tile: close enough to see buildings and cars. */
export const TEST_ZOOM = 18;
/** Sample point without a portfolio: Berlin, Pariser Platz. */
export const TEST_POINT = { lat: 52.5163, lon: 13.3777 };
/** A tile is a few hundred kB at most; anything larger is not one. */
const MAX_TILE_BYTES = 5 * 1024 * 1024;
/** Channel spread (0–255) below which a tile counts as one flat colour. */
const BLANK_STDEV = 2;

type ProbeCode = "ok" | OwnSourceGap;

interface TileProbe {
  code: ProbeCode;
  status?: number;
  detail?: string;
  /** The tile, for "ok" and "blank". */
  image?: Buffer;
}

function detailOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

/** Fetches the tile of `template` that contains a point and classifies it. */
async function probeTile(
  template: string,
  lat: number,
  lon: number,
  zoom: number,
  timeoutMs: number,
): Promise<TileProbe> {
  const url = buildTileUrl(
    "wms",
    zoom,
    lat2tile(lat, zoom),
    lon2tile(lon, zoom),
    {
      wmsTemplate: template,
    },
  );
  let bytes: Buffer;
  let contentType: string;
  try {
    // One attempt: a retry hides a flaky source and keeps the user waiting.
    const res = await fetchWithResilience(url, {}, { retries: 0, timeoutMs });
    if (!res.ok) return { code: "http-error", status: res.status };
    contentType = res.headers.get("content-type") ?? "";
    bytes = Buffer.from(await res.arrayBuffer());
  } catch (error) {
    return { code: "unreachable", detail: detailOf(error) };
  }

  // WMS servers report errors as HTTP 200 with an XML document; show its
  // beginning, it names the missing parameter or unknown layer.
  const notAnImage = (): TileProbe => ({
    code: "not-an-image",
    detail: /xml|text|json|html/i.test(contentType)
      ? bytes.subarray(0, 300).toString("utf8").replace(/\s+/g, " ").trim()
      : contentType.slice(0, 100),
  });
  if (bytes.length === 0 || bytes.length > MAX_TILE_BYTES) return notAnImage();
  try {
    const { channels } = await sharp(bytes).stats();
    // One flat colour is what services answer outside their coverage (and
    // below their scale limit): reachable, but no image for this place.
    const flat = channels.slice(0, 3).every((c) => c.stdev < BLANK_STDEV);
    return { code: flat ? "blank" : "ok", image: bytes };
  } catch {
    return notAnImage();
  }
}

export async function testCustomImagery(
  point: { lat: number; lon: number } = TEST_POINT,
): Promise<ImagerySourceTest> {
  const started = Date.now();
  const at = { lat: point.lat, lon: point.lon, zoom: TEST_ZOOM };
  const template = getSettings().wmsTileUrl;
  if (!isUsableTileTemplate(template)) {
    return { ok: false, code: "not-configured", ...at, latencyMs: 0 };
  }
  const probe = await probeTile(
    template,
    point.lat,
    point.lon,
    TEST_ZOOM,
    15_000,
  );
  const latencyMs = Date.now() - started;
  const preview = probe.image
    ? `data:image/png;base64,${(
        await sharp(probe.image)
          .resize(256, 256, { fit: "fill" })
          .removeAlpha()
          .png()
          .toBuffer()
      ).toString("base64")}`
    : undefined;
  return {
    ok: probe.code === "ok",
    code: probe.code,
    ...(probe.status != null ? { status: probe.status } : {}),
    ...(probe.detail ? { detail: probe.detail } : {}),
    ...(preview ? { preview } : {}),
    ...at,
    latencyMs,
  };
}

/** How long a "has an image" / "flat colour" answer for a tile is trusted. */
const COVERAGE_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * Errors (unreachable, HTTP error, not an image) are asked again soon: they
 * are usually a passing outage or a setting the user is about to correct,
 * but a moving map must not ask an unreachable server on every pan.
 */
const COVERAGE_ERROR_TTL_MS = 5 * 60 * 1000;
/** Shorter than the connection test: an analysis waits for this answer. */
const COVERAGE_TIMEOUT_MS = 8_000;

/**
 * Whether the own source has an image at a point: "ok", or why not. Asked
 * for the tile that contains the point at `zoom` (at most `TEST_ZOOM`), so
 * an overview asks for the area in view and a site for its surroundings.
 * Without a usable template the answer is "unreachable".
 */
export async function customImageryCoverage(
  lat: number,
  lon: number,
  zoom: number = TEST_ZOOM,
): Promise<ProbeCode> {
  const template = getSettings().wmsTileUrl;
  if (!isUsableTileTemplate(template)) return "unreachable";
  const z = Math.max(0, Math.min(Math.round(zoom), TEST_ZOOM));
  const key = `custom-coverage:${cacheKeyFragment(template)}:${z}/${lat2tile(lat, z)}/${lon2tile(lon, z)}`;
  return cached<ProbeCode>(
    key,
    COVERAGE_TTL_MS,
    async () =>
      (await probeTile(template, lat, lon, z, COVERAGE_TIMEOUT_MS)).code,
    (code) =>
      code === "ok" || code === "blank"
        ? COVERAGE_TTL_MS
        : COVERAGE_ERROR_TTL_MS,
  );
}
