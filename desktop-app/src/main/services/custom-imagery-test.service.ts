import sharp from "sharp";
import { buildTileUrl } from "@shared/constants";
import { lat2tile, lon2tile } from "@shared/imagery-sources";
import type { ImagerySourceTest } from "@shared/ipc-schema";
import { isUsableTileTemplate } from "@shared/tile-template";
import { fetchWithResilience } from "./http.service";
import { getSettings } from "./settings.service";

/**
 * "Test connection" for the custom tile source: one tile of the saved
 * template, so a wrong layer, a missing key or a source that does not cover
 * the portfolio shows up in the settings and not as a white map or an empty
 * vehicle count. Only the saved template is fetched (it passed
 * `validateTileTemplate` when it was saved), never a URL from the request.
 */

/** Zoom of the sample tile: close enough to see buildings and cars. */
export const TEST_ZOOM = 18;
/** Sample point without a portfolio: Berlin, Pariser Platz. */
export const TEST_POINT = { lat: 52.5163, lon: 13.3777 };
/** A tile is a few hundred kB at most; anything larger is not one. */
const MAX_TILE_BYTES = 5 * 1024 * 1024;
/** Channel spread (0–255) below which a tile counts as one flat colour. */
const BLANK_STDEV = 2;

function detailOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

export async function testCustomImagery(
  point: { lat: number; lon: number } = TEST_POINT,
): Promise<ImagerySourceTest> {
  const started = Date.now();
  const at = { lat: point.lat, lon: point.lon, zoom: TEST_ZOOM };
  const result = (
    rest: Omit<ImagerySourceTest, "latencyMs" | "lat" | "lon" | "zoom">,
  ): ImagerySourceTest => ({ ...rest, ...at, latencyMs: Date.now() - started });

  const template = getSettings().wmsTileUrl;
  if (!isUsableTileTemplate(template)) {
    return result({ ok: false, code: "not-configured" });
  }
  const url = buildTileUrl(
    "wms",
    TEST_ZOOM,
    lat2tile(point.lat, TEST_ZOOM),
    lon2tile(point.lon, TEST_ZOOM),
    { wmsTemplate: template },
  );

  let bytes: Buffer;
  let contentType: string;
  try {
    // One attempt: the user is waiting, and a retry hides a flaky source.
    const res = await fetchWithResilience(
      url,
      {},
      { retries: 0, timeoutMs: 15_000 },
    );
    if (!res.ok) {
      return result({ ok: false, code: "http-error", status: res.status });
    }
    contentType = res.headers.get("content-type") ?? "";
    bytes = Buffer.from(await res.arrayBuffer());
  } catch (error) {
    return result({ ok: false, code: "unreachable", detail: detailOf(error) });
  }

  // WMS servers report errors as HTTP 200 with an XML document; show its
  // beginning, it names the missing parameter or unknown layer.
  const notAnImage = (): ImagerySourceTest =>
    result({
      ok: false,
      code: "not-an-image",
      detail: /xml|text|json|html/i.test(contentType)
        ? bytes.subarray(0, 300).toString("utf8").replace(/\s+/g, " ").trim()
        : contentType.slice(0, 100),
    });
  if (bytes.length === 0 || bytes.length > MAX_TILE_BYTES) return notAnImage();

  try {
    const image = sharp(bytes);
    const { channels } = await image.stats();
    const preview = `data:image/png;base64,${(
      await image
        .resize(256, 256, { fit: "fill" })
        .removeAlpha()
        .png()
        .toBuffer()
    ).toString("base64")}`;
    // One flat colour is what services answer outside their coverage (and
    // below their scale limit): reachable, but no image for this place.
    const flat = channels.slice(0, 3).every((c) => c.stdev < BLANK_STDEV);
    return flat
      ? result({ ok: false, code: "blank", preview })
      : result({ ok: true, code: "ok", preview });
  } catch {
    return notAnImage();
  }
}
