import { z } from "zod";
import {
  ImageryCandidateSchema,
  type ImageryCandidate,
} from "./imagery-sources";

/**
 * Esri World Imagery Wayback: every published version of the World Imagery
 * basemap since 2014, keyless and at the same resolution as the live
 * basemap. Each version ("release") has its own metadata service, so the
 * capture date of the image a version shows can be resolved per point and
 * zoom exactly like for the live basemap. Methodology and limitations:
 * docs/imagery-sources.md.
 *
 * URLs are built here from constants and validated integers only; nothing
 * from the downloaded configuration is fetched without a host check.
 */

export const WAYBACK_CONFIG_URL =
  "https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json";
const WAYBACK_HOST = "wayback.maptiles.arcgis.com";
const WAYBACK_TILE_BASE = `https://${WAYBACK_HOST}/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile`;
const WAYBACK_TILEMAP_BASE = `https://${WAYBACK_HOST}/arcgis/rest/services/World_Imagery/MapServer/tilemap`;
const WAYBACK_METADATA_HOST = "metadata.maptiles.arcgis.com";

export const WAYBACK_ATTRIBUTION = "© Esri World Imagery Wayback";

export interface WaybackRelease {
  /** Release number used in tile and tilemap URLs. */
  release: number;
  /** ISO date Esri published this version. */
  publishedAt: string;
  /** Metadata MapServer of this version; null for early releases without one. */
  metadataLayerUrl: string | null;
}

export function isWaybackRelease(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value < 1e7
  );
}

function assertTile(z: number, y: number, x: number): void {
  const max = 2 ** z;
  if (
    !Number.isInteger(z) ||
    z < 0 ||
    z > 23 ||
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    y < 0 ||
    x >= max ||
    y >= max
  ) {
    throw new RangeError(`Invalid tile ${z}/${y}/${x}`);
  }
}

function assertRelease(release: number): void {
  if (!isWaybackRelease(release)) {
    throw new RangeError(`Invalid Wayback release ${String(release)}`);
  }
}

/**
 * Tile of a Wayback version (z/y/x order). Where a version reused an older
 * image, Esri redirects (same host) to the release that holds it; where
 * there is no imagery at that zoom, it answers 404.
 */
export function buildWaybackTileUrl(
  release: number,
  z: number,
  y: number,
  x: number,
): string {
  assertRelease(release);
  assertTile(z, y, x);
  return `${WAYBACK_TILE_BASE}/${release}/${z}/${y}/${x}`;
}

/** Leaflet template for a Wayback version. */
export function waybackTileTemplate(release: number): string {
  assertRelease(release);
  return `${WAYBACK_TILE_BASE}/${release}/{z}/{y}/{x}`;
}

/**
 * Tilemap lookup: which release actually holds the tile a version shows.
 * Walking it backwards lists only versions with a local change.
 */
export function buildWaybackTilemapUrl(
  release: number,
  z: number,
  y: number,
  x: number,
): string {
  assertRelease(release);
  assertTile(z, y, x);
  return `${WAYBACK_TILEMAP_BASE}/${release}/${z}/${y}/${x}`;
}

/** `{ data: [1], select: [10321] }` → imagery exists, held by release 10321. */
export function parseWaybackTilemap(
  json: unknown,
): { hasTile: boolean; release: number | null } {
  const record = json as { data?: unknown; select?: unknown } | null;
  const data = Array.isArray(record?.data) ? record.data[0] : undefined;
  const select = Array.isArray(record?.select) ? record.select[0] : undefined;
  return {
    hasTile: data === 1,
    release: isWaybackRelease(select) ? select : null,
  };
}

/**
 * Wayback metadata services publish 14 layers, 0 = 1.9 cm (z23) to
 * 13 = 150 m (z≤10) — the live service numbers the same levels 5–18.
 */
export function waybackMetadataLayerForZoom(zoom: number): number {
  return Math.min(13, Math.max(0, 23 - Math.round(zoom)));
}

/**
 * Accepts only https metadata MapServers on Esri's Wayback metadata host;
 * returns the normalized URL without query/trailing slash, otherwise null.
 */
export function safeWaybackMetadataUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== WAYBACK_METADATA_HOST) {
    return null;
  }
  if (url.username || url.password || url.port) return null;
  const path = url.pathname.replace(/\/+$/, "");
  if (!/^\/arcgis\/rest\/services\/[A-Za-z0-9_]+\/MapServer$/.test(path)) {
    return null;
  }
  return `https://${WAYBACK_METADATA_HOST}${path}`;
}

const WaybackConfigEntrySchema = z.object({
  itemTitle: z.string(),
  metadataLayerUrl: z.string().optional(),
});

/**
 * Releases from waybackconfig.json, newest first. Entries without a
 * parseable release number or publication date are skipped.
 */
export function parseWaybackConfig(json: unknown): WaybackRelease[] {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return [];
  }
  const releases: WaybackRelease[] = [];
  for (const [key, value] of Object.entries(json)) {
    const release = Number(key);
    if (!/^\d+$/.test(key) || !isWaybackRelease(release)) continue;
    const entry = WaybackConfigEntrySchema.safeParse(value);
    if (!entry.success) continue;
    const date = /Wayback (\d{4}-\d{2}-\d{2})/.exec(entry.data.itemTitle)?.[1];
    if (!date || Number.isNaN(Date.parse(date))) continue;
    releases.push({
      release,
      publishedAt: date,
      metadataLayerUrl: safeWaybackMetadataUrl(entry.data.metadataLayerUrl),
    });
  }
  return releases.sort(
    (a, b) =>
      b.publishedAt.localeCompare(a.publishedAt) || b.release - a.release,
  );
}

/** Dated Wayback versions at a point, newest first. */
export const ImageryTimelineSchema = z.object({
  candidates: z.array(ImageryCandidateSchema),
  /** Zoom the versions were resolved at (may be one below the request). */
  zoom: z.number().int(),
  /** True when older versions exist beyond the returned ones. */
  truncated: z.boolean(),
});
export type ImageryTimeline = z.infer<typeof ImageryTimelineSchema>;

/** A Wayback version pinned for display: the basemap as Esri published it then. */
export const PinnedWaybackSchema = z.object({
  release: z.number().int().positive(),
  publishedAt: z.string(),
});
export type PinnedWayback = z.infer<typeof PinnedWaybackSchema>;

/**
 * The image a pinned version shows at the point a timeline was resolved
 * for: the newest listed version published no later than the pinned one.
 * Null when the timeline does not reach back that far.
 */
export function waybackCandidateForVersion(
  candidates: ImageryCandidate[],
  pinned: PinnedWayback,
): ImageryCandidate | null {
  return (
    candidates.find(
      (c) => c.wayback != null && c.wayback.publishedAt <= pinned.publishedAt,
    ) ?? null
  );
}
