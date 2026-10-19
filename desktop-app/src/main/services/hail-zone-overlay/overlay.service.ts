import { app } from "electron";
import { mkdir, readFile, rename, unlink, writeFile } from "fs/promises";
import { join } from "path";
import { brotliDecompress } from "zlib";
import { promisify } from "util";
import { z } from "zod";
import { HAIL_ZONES } from "@shared/hail-zones";
import { HailZoneOverlaySchema, type HailZoneOverlay } from "@shared/types";
import { fetchWithResilience } from "../http.service";
import { topologyToOverlayAreas, type PostcodeTopology } from "./topology";

/**
 * Postcode outlines for the hail zone map overlay.
 *
 * The outlines come from the OpenStreetMap-derived `yetzt/postleitzahlen`
 * release (ODbL). They are downloaded once, simplified, joined with the
 * postcode → hail zone table and cached under `userData`, so the overlay works
 * offline afterwards and the application bundle stays small.
 */
export const POSTCODE_OUTLINES_URL =
  "https://github.com/yetzt/postleitzahlen/releases/latest/download/postleitzahlen.topojson.br";

/** Bump when the simplification or the cached format changes. */
const CACHE_FILE = "overlay-v1.json";
const DOWNLOAD_TIMEOUT_MS = 180_000;
/** The release is ~14 MB compressed; anything far beyond is not that file. */
const MAX_DOWNLOAD_BYTES = 60 * 1024 * 1024;
const MAX_DECOMPRESSED_BYTES = 400 * 1024 * 1024;

const decompress = promisify(brotliDecompress);

const TopologyEnvelopeSchema = z.object({
  copyright: z.string().optional(),
  license: z.string().optional(),
  timestamp: z.string().optional(),
  arcs: z.array(z.array(z.tuple([z.number(), z.number()]))),
  objects: z.record(
    z.object({
      geometries: z.array(
        z.object({
          type: z.string(),
          arcs: z.unknown().optional(),
          properties: z
            .object({ postcode: z.unknown().optional() })
            .passthrough()
            .optional(),
        }),
      ),
    }),
  ),
});

function cacheDir(): string {
  return join(app.getPath("userData"), "hail-zones");
}

async function readCache(path: string): Promise<HailZoneOverlay | null> {
  try {
    return HailZoneOverlaySchema.parse(
      JSON.parse(await readFile(path, "utf8")),
    );
  } catch {
    // Missing or damaged cache: download again.
    return null;
  }
}

async function downloadOverlay(): Promise<HailZoneOverlay> {
  const res = await fetchWithResilience(
    POSTCODE_OUTLINES_URL,
    {},
    { retries: 1, timeoutMs: DOWNLOAD_TIMEOUT_MS },
  );
  if (!res.ok) throw new Error(`Postcode outlines: HTTP ${res.status}`);
  const declared = Number(res.headers.get("content-length"));
  if (declared > MAX_DOWNLOAD_BYTES)
    throw new Error("Postcode outlines download is unexpectedly large");
  const compressed = Buffer.from(await res.arrayBuffer());
  if (compressed.length > MAX_DOWNLOAD_BYTES)
    throw new Error("Postcode outlines download is unexpectedly large");

  const json = await decompress(compressed, {
    maxOutputLength: MAX_DECOMPRESSED_BYTES,
  });
  const topology = TopologyEnvelopeSchema.parse(
    JSON.parse(json.toString("utf8")),
  );
  const areas = topologyToOverlayAreas(
    topology as PostcodeTopology,
    (postcode) =>
      Object.hasOwn(HAIL_ZONES, postcode) ? HAIL_ZONES[postcode] : null,
  );
  if (areas.length === 0)
    throw new Error("Postcode outlines contain no known postcode");
  return {
    areas,
    attribution: topology.copyright ?? "© OpenStreetMap contributors",
    dataDate: topology.timestamp ?? null,
  };
}

let inFlight: Promise<HailZoneOverlay> | null = null;

/**
 * Overlay data from the cache, downloading and preparing it on first use.
 * Concurrent callers share one download.
 */
export function getHailZoneOverlay(): Promise<HailZoneOverlay> {
  inFlight ??= loadOverlay().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function loadOverlay(): Promise<HailZoneOverlay> {
  const path = join(cacheDir(), CACHE_FILE);
  const cached = await readCache(path);
  if (cached) return cached;

  const overlay = await downloadOverlay();
  const tmpPath = `${path}.tmp`;
  try {
    await mkdir(cacheDir(), { recursive: true });
    await writeFile(tmpPath, JSON.stringify(overlay));
    await rename(tmpPath, path);
  } catch (err) {
    // The overlay still works this session; it is fetched again next time.
    console.warn("Could not cache the hail zone overlay", err);
    await unlink(tmpPath).catch(() => undefined);
  }
  return overlay;
}
