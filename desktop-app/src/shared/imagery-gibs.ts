import { z } from "zod";

/**
 * Recent 30 m satellite scenes (NASA Harmonized Landsat Sentinel-2, HLS)
 * as a map overlay. Context only: at 30 m a dealership lot is a few pixels,
 * so these scenes show whether a site changed since the sharp image
 * (new buildings, cleared or re-paved areas), never vehicles. Scenes are
 * found via NASA's CMR catalogue and drawn from NASA GIBS, both keyless.
 * Methodology and limitations: docs/imagery-sources.md.
 */

export const GibsProductSchema = z.enum(["S30", "L30"]);
export type GibsProduct = z.infer<typeof GibsProductSchema>;

interface GibsProductSpec {
  /** Satellite family shown in the UI. */
  label: string;
  gibsLayer: string;
  /** Deepest native zoom of the GIBS tile matrix. */
  maxLevel: number;
  format: "png" | "jpg";
  /** CMR concept id of the HLS collection. */
  cmrCollection: string;
  resolutionM: number;
}

export const GIBS_PRODUCTS: Record<GibsProduct, GibsProductSpec> = {
  S30: {
    label: "Sentinel-2",
    gibsLayer: "HLS_S30_Nadir_BRDF_Adjusted_Reflectance",
    maxLevel: 12,
    format: "png",
    cmrCollection: "C2021957295-LPCLOUD",
    resolutionM: 30,
  },
  L30: {
    label: "Landsat 8/9",
    gibsLayer: "HLS_L30_Nadir_BRDF_Adjusted_Reflectance",
    maxLevel: 12,
    format: "png",
    cmrCollection: "C2021957657-LPCLOUD",
    resolutionM: 30,
  },
};

export const GIBS_ATTRIBUTION = "NASA GIBS · HLS (LP DAAC)";
const GIBS_TILE_BASE = "https://gibs-{s}.earthdata.nasa.gov/wmts/epsg3857/best";
const CMR_GRANULES_URL =
  "https://cmr.earthdata.nasa.gov/search/granules.umm_json";

/** Look-back window and cloud filter for the scene list. */
export const RECENT_SCENE_DAYS = 60;
export const RECENT_SCENE_MAX_CLOUD = 40;
/** CMR page size; a 60-day window has a few dozen granules per tile at most. */
const CMR_PAGE_SIZE = 100;

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isSceneDay(value: unknown): value is string {
  return (
    typeof value === "string" &&
    DAY_PATTERN.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  );
}

/** Leaflet template (subdomains a–c) for one product on one day. */
export function gibsTileTemplate(product: GibsProduct, day: string): string {
  if (!isSceneDay(day)) throw new RangeError(`Invalid scene day ${day}`);
  const spec = GIBS_PRODUCTS[product];
  return `${GIBS_TILE_BASE}/${spec.gibsLayer}/default/${day}/GoogleMapsCompatible_Level${spec.maxLevel}/{z}/{y}/{x}.${spec.format}`;
}

/** CMR granule search for scenes covering a bbox, newest first. */
export function buildCmrGranuleSearchUrl(
  product: GibsProduct,
  bbox: [number, number, number, number],
  startIso: string,
  endIso: string,
  maxCloud: number = RECENT_SCENE_MAX_CLOUD,
): string {
  const [west, south, east, north] = bbox;
  const params = new URLSearchParams({
    collection_concept_id: GIBS_PRODUCTS[product].cmrCollection,
    bounding_box: `${west},${south},${east},${north}`,
    temporal: `${startIso},${endIso}`,
    cloud_cover: `0,${Math.max(0, Math.min(100, Math.round(maxCloud)))}`,
    sort_key: "-start_date",
    page_size: String(CMR_PAGE_SIZE),
  });
  return `${CMR_GRANULES_URL}?${params.toString()}`;
}

export const RecentSceneSchema = z.object({
  product: GibsProductSchema,
  /** UTC acquisition day, ISO `YYYY-MM-DD`. */
  day: z.string().regex(DAY_PATTERN),
  /** Cloud cover of the scene in percent (HLS `CLOUD_COVERAGE`), if published. */
  cloudPct: z.number().min(0).max(100).nullable(),
});
export type RecentScene = z.infer<typeof RecentSceneSchema>;

export const RecentScenesSchema = z.object({
  scenes: z.array(RecentSceneSchema),
  days: z.number().int().positive(),
  maxCloud: z.number().min(0).max(100),
});
export type RecentScenes = z.infer<typeof RecentScenesSchema>;

function cloudOf(umm: Record<string, unknown>): number | null {
  const attributes = umm.AdditionalAttributes;
  if (!Array.isArray(attributes)) return null;
  const entry = attributes.find(
    (a): a is { Values: unknown[] } =>
      typeof a === "object" &&
      a !== null &&
      (a as { Name?: unknown }).Name === "CLOUD_COVERAGE" &&
      Array.isArray((a as { Values?: unknown }).Values),
  );
  const value = Number(entry?.Values[0]);
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

/**
 * Scenes of one product from a CMR UMM-JSON response, one per UTC day
 * (a site on a tile edge can be covered by two granules of the same pass;
 * the clearer one is kept). Newest first.
 */
export function parseCmrGranules(
  json: unknown,
  product: GibsProduct,
): RecentScene[] {
  const items = (json as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return [];
  const byDay = new Map<string, RecentScene>();
  for (const item of items) {
    const umm = (item as { umm?: unknown } | null)?.umm;
    if (typeof umm !== "object" || umm === null) continue;
    const begin = (
      umm as {
        TemporalExtent?: { RangeDateTime?: { BeginningDateTime?: unknown } };
      }
    ).TemporalExtent?.RangeDateTime?.BeginningDateTime;
    const day = typeof begin === "string" ? begin.slice(0, 10) : null;
    if (!isSceneDay(day)) continue;
    const cloudPct = cloudOf(umm as Record<string, unknown>);
    const existing = byDay.get(day);
    if (
      !existing ||
      (cloudPct != null &&
        (existing.cloudPct == null || cloudPct < existing.cloudPct))
    ) {
      byDay.set(day, { product, day, cloudPct });
    }
  }
  return [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day));
}

/** Merges product lists: newest day first, clearer scene first on the same day. */
export function mergeRecentScenes(lists: RecentScene[][]): RecentScene[] {
  return lists
    .flat()
    .sort(
      (a, b) =>
        b.day.localeCompare(a.day) ||
        (a.cloudPct ?? 101) - (b.cloudPct ?? 101) ||
        a.product.localeCompare(b.product),
    );
}

/** Stable key of a scene for selects and the store. */
export function recentSceneKey(
  scene: Pick<RecentScene, "product" | "day">,
): string {
  return `${scene.product}:${scene.day}`;
}
