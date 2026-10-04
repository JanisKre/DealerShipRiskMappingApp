import sharp from "sharp";
import type { BoundaryResult } from "@shared/types";
import { geometryBbox } from "@shared/boundary-geometry-utils";
import { DETECTION_ZOOM, TILE_SIZE } from "@shared/constants";
import type { ImagerySelection } from "@shared/imagery-sources";
import { cacheGet, cacheSet } from "./cache.service";
import { fetchWithResilience } from "./http.service";
import {
  ESRI_TILE_SOURCE,
  selectImageryForDetection,
  tileSourceForCandidate,
  type TileSource,
} from "./imagery-source.service";
import type { AerialImage } from "./detection.service";

/**
 * Aerial imagery acquisition in the main process: picks the imagery source
 * for the location (Esri or a state orthophoto, imagery-source.service),
 * loads its tiles over the bbox, decodes them with `sharp`, and stitches them
 * into a single RGBA buffer. Georeference metadata (origin + spans) allow
 * the detector to convert pixel boxes back to lon/lat.
 *
 * Ported from `src/lib/satelliteCapture.ts` (browser canvas → sharp/Node).
 */

// --- Tile math (Web Mercator) ---------------------------------------

function lon2tile(lon: number, zoom: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** zoom);
}
function lat2tile(lat: number, zoom: number): number {
  return Math.floor(
    ((1 -
      Math.log(
        Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180),
      ) /
        Math.PI) /
      2) *
      2 ** zoom,
  );
}
function tile2lon(x: number, zoom: number): number {
  return (x / 2 ** zoom) * 360 - 180;
}
function tile2lat(y: number, zoom: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** zoom;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

const TILE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days — orthophotos rarely change
/**
 * Bumped when cached tile bytes become invalid. v2: Esri placeholder tiles
 * ("Map data not yet available") were cached as imagery before
 * `blankTile=false`.
 */
const TILE_CACHE_VERSION = 2;

/** Loads a single tile as a raw RGB buffer (persistent cache as base64). */
async function loadTileRgb(
  z: number,
  y: number,
  x: number,
  source: TileSource,
  time?: string,
): Promise<{ data: Buffer; ok: boolean }> {
  // `cacheId` encodes the actual endpoint (state service, custom template);
  // without it, switching sources would keep serving tiles cached from the
  // previous one.
  const cacheKey = `tile:v${TILE_CACHE_VERSION}:${source.cacheId}:${time ?? "live"}:${z}/${y}/${x}`;
  const cachedB64 = cacheGet<string>(cacheKey);
  let bytes: Buffer | null = cachedB64
    ? Buffer.from(cachedB64, "base64")
    : null;

  if (!bytes) {
    try {
      const res = await fetchWithResilience(
        source.url(z, y, x, time),
        {
          headers: { "User-Agent": "DealershipRiskMapping/1.0 (desktop)" },
        },
      );
      if (res.ok) {
        bytes = Buffer.from(await res.arrayBuffer());
        cacheSet(cacheKey, bytes.toString("base64"), TILE_TTL);
      }
    } catch {
      bytes = null;
    }
  }

  if (!bytes) {
    // Gray blank tile as fallback (prevents holes in the mosaic)
    const blank = Buffer.alloc(TILE_SIZE * TILE_SIZE * 3, 128);
    return { data: blank, ok: false };
  }

  const data = await sharp(bytes)
    .resize(TILE_SIZE, TILE_SIZE, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer();
  return { data, ok: true };
}

export interface AerialCapture extends AerialImage {
  /** Longitude of the mosaic's left edge */
  originLon: number;
  /** Latitude of the mosaic's top edge */
  originLat: number;
  /** Total longitude span of the mosaic (degrees) */
  lonSpan: number;
  /** Total latitude span of the mosaic (degrees) */
  latSpan: number;
  zoom: number;
  /** Number of tiles with valid imagery versus requested tiles. */
  validTileCount: number;
  tileCount: number;
  /** Which source was used and why — provenance for the detection result. */
  imagery?: ImagerySelection;
}

function boundingBox(b: BoundaryResult): [number, number, number, number] {
  return geometryBbox(b.polygon);
}

/**
 * Loads & mosaics the tiles over the boundary bbox (with 1 tile of overlap
 * at the edge) into an RGBA buffer. Result is memoized via `cached`.
 */
export async function aerialImageForBoundary(
  lat: number,
  lon: number,
  boundary?: BoundaryResult,
  zoom = DETECTION_ZOOM,
  time?: string,
): Promise<AerialCapture> {
  const bbox: [number, number, number, number] = boundary
    ? boundingBox(boundary)
    : [lon - 0.001, lat - 0.001, lon + 0.001, lat + 0.001];

  // No mosaic-level cache: the large RGBA buffer isn't JSON-friendly and
  // the individual tiles are already cached persistently (loadTileRgb).
  return captureWithSelectedSource(bbox, zoom, time);
}

/** Public bbox capture used by boundary surface segmentation and diagnostics. */
export async function aerialImageForBbox(
  bbox: [number, number, number, number],
  zoom = DETECTION_ZOOM,
  time?: string,
): Promise<AerialCapture> {
  return captureWithSelectedSource(bbox, zoom, time);
}

/**
 * Resolves the imagery source at the bbox centre, then captures from it. An
 * Esri candidate carries the zoom its image lives at (z19 and z20 are often
 * different scenes), so the capture never exceeds it.
 */
async function captureWithSelectedSource(
  bbox: [number, number, number, number],
  zoom: number,
  time?: string,
): Promise<AerialCapture> {
  const [west, south, east, north] = bbox;
  let imagery: ImagerySelection | undefined;
  try {
    imagery = await selectImageryForDetection(
      (south + north) / 2,
      (west + east) / 2,
    );
  } catch {
    imagery = undefined;
  }
  const source = imagery
    ? tileSourceForCandidate(imagery.chosen)
    : ESRI_TILE_SOURCE;
  const captureZoom = imagery ? Math.min(zoom, imagery.chosen.zoom) : zoom;
  const capture = await captureMosaic(bbox, captureZoom, source, time);
  return imagery ? { ...capture, imagery } : capture;
}

/**
 * Radius, independent of any boundary result. Real detected lots are
 * typically well under 150 m across, so this only needs to be modestly
 * wider than that to catch a vehicle just outside an underestimated
 * boundary — not `parameters.boundaryGridExtentM`-sized: at zoom
 * `DETECTION_ZOOM` a 400+ m capture is several hundred tiles, and doing
 * that unconditionally on every analysis (this used to be an occasional
 * refinement step, not a per-analysis one) made a normal run visibly stall.
 */
const CONTEXT_CAPTURE_RADIUS_M = 100;

/**
 * Captures around the geocoded point with a fixed, boundary-independent
 * radius — deliberately not sized from a detected boundary
 * (docs/boundary-improvement-plan.de.md P5). Vehicle detection run on this
 * image sees the full context; a too-tight boundary can then be caught by
 * vehicles it would otherwise have hidden from the model entirely.
 */
export async function aerialImageForContext(
  lat: number,
  lon: number,
  time?: string,
): Promise<AerialCapture> {
  const radiusM = CONTEXT_CAPTURE_RADIUS_M;
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  return aerialImageForBbox(
    [lon - dLon, lat - dLat, lon + dLon, lat + dLat],
    DETECTION_ZOOM,
    time,
  );
}

// Below this fraction of valid tiles, retry one zoom level down. Some
// orthophoto providers don't publish their sharpest imagery everywhere, and
// that failure mode (a region capped at a lower max zoom) is indistinguishable
// from a plain network outage by ratio alone — but it's the more important
// case to recover from here, since it's the direct risk of raising
// DETECTION_ZOOM. A genuine outage just costs a few extra fast-failing
// requests down to the floor below.
const MIN_VALID_TILE_RATIO = 0.5;
const MIN_FALLBACK_ZOOM = 15;

/**
 * Tile requests used to be fired all at once. That was harmless while capture
 * boxes were ~200 m wide, but the boundary evidence raster covers 400 m, and an
 * unbounded fan-out there means hundreds of simultaneous requests to a public
 * imagery service — which gets rate-limited, not served faster.
 */
const TILE_FETCH_CONCURRENCY = 8;

/** Runs `worker` over `items` with at most `limit` in flight, preserving no order. */
async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const index = next++;
        await worker(items[index]);
      }
    },
  );
  await Promise.all(runners);
}

async function captureMosaic(
  bbox: [number, number, number, number],
  zoom: number,
  source: TileSource,
  time?: string,
): Promise<AerialCapture> {
  const capture = await captureMosaicOnce(bbox, zoom, source, time);
  const ratio =
    capture.tileCount === 0 ? 1 : capture.validTileCount / capture.tileCount;
  if (ratio < MIN_VALID_TILE_RATIO && zoom > MIN_FALLBACK_ZOOM) {
    return captureMosaic(bbox, zoom - 1, source, time);
  }
  return capture;
}

async function captureMosaicOnce(
  bbox: [number, number, number, number],
  zoom: number,
  source: TileSource,
  time?: string,
): Promise<AerialCapture> {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const overlap = 1;

  const xMin = lon2tile(minLon, zoom) - overlap;
  const xMax = lon2tile(maxLon, zoom) + overlap;
  const yMin = lat2tile(maxLat, zoom) - overlap; // y is inverted in Web Mercator
  const yMax = lat2tile(minLat, zoom) + overlap;

  const cols = xMax - xMin + 1;
  const rows = yMax - yMin + 1;
  const width = cols * TILE_SIZE;
  const height = rows * TILE_SIZE;

  // RGBA destination buffer
  const rgba = new Uint8Array(width * height * 4);
  // Pre-fill alpha with 255
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;

  const tiles: Array<{ tx: number; ty: number }> = [];
  for (let ty = yMin; ty <= yMax; ty++) {
    for (let tx = xMin; tx <= xMax; tx++) tiles.push({ tx, ty });
  }

  let validTileCount = 0;
  await mapWithConcurrency(
    tiles,
    TILE_FETCH_CONCURRENCY,
    async ({ tx, ty }) => {
      const { data, ok } = await loadTileRgb(zoom, ty, tx, source, time);
      if (ok) validTileCount += 1;
      const px0 = (tx - xMin) * TILE_SIZE;
      const py0 = (ty - yMin) * TILE_SIZE;
      for (let row = 0; row < TILE_SIZE; row++) {
        for (let col = 0; col < TILE_SIZE; col++) {
          const src = (row * TILE_SIZE + col) * 3;
          const dst = ((py0 + row) * width + (px0 + col)) * 4;
          rgba[dst] = data[src];
          rgba[dst + 1] = data[src + 1];
          rgba[dst + 2] = data[src + 2];
          rgba[dst + 3] = 255;
        }
      }
    },
  );

  const originLon = tile2lon(xMin, zoom);
  const originLat = tile2lat(yMin, zoom);
  const lonSpan = tile2lon(xMax + 1, zoom) - originLon;
  const latSpan = originLat - tile2lat(yMax + 1, zoom);

  return {
    rgba,
    width,
    height,
    bbox,
    originLon,
    originLat,
    lonSpan,
    latSpan,
    zoom,
    validTileCount,
    tileCount: tiles.length,
  };
}
