/**
 * Shared domain constants (main + renderer). Ported from the original
 * (`src/lib/constants.ts`), reduced to what this app uses.
 */

import { fillTileTemplate } from "./imagery-sources";

// --- Vehicle exposure -------------------------------------------------------

/**
 * Average vehicle value in EUR (portfolio exposure). The detector reports
 * one underwriting category regardless of the source model's vehicle class
 * (see detection.service.ts's `finalize()`), so exposure is valued
 * uniformly rather than per class.
 */
export const VEHICLE_VALUE_CAR_EUR = 25_000;
export const VEHICLE_VALUE_DEFAULT_EUR = 25_000;

/** Assumed parking area per vehicle (sqm) — for capacity/utilisation. */
export const CAPACITY_SQM_PER_VEHICLE = 25;

/**
 * Version of the risk model that produced a RiskAssessment. The dashboard
 * offers a recalculation for results stored with an older version.
 */
export const RISK_MODEL_VERSION = "screening-0.4.0";

// --- Dealership notes ------------------------------------------------------

/** Upper bound for a dealership's free-text underwriting notes. */
export const DEALERSHIP_NOTES_MAX_LENGTH = 10_000;

// --- Hail EAL: EAL = N × λ_z × (p_S·S_S + p_M·S_M + p_L·S_L) -------------
//
// Uncalibrated screening placeholders, agreed as starting values until the
// underwriting team supplies calibrated figures. All are editable on the
// parameters page; see docs/risk-model.md for the methodology.

/** λ_z: damaging hail events per year at a single site, by hail zone 1–6. */
export const HAIL_FREQUENCY_BY_ZONE: Record<1 | 2 | 3 | 4 | 5 | 6, number> = {
  1: 0.01,
  2: 0.02,
  3: 0.04,
  4: 0.07,
  5: 0.1,
  6: 0.15,
};

/** p_k (share of events) and S_k (EUR loss per exposed vehicle) per class. */
export const HAIL_SEVERITY_CLASSES = {
  small: { share: 0.6, lossEur: 800 },
  medium: { share: 0.3, lossEur: 3_000 },
  large: { share: 0.1, lossEur: 7_000 },
} as const;

/** Heat: number of hot days/year (Tmax >= 30 C) at which the score peaks. */
export const HEAT_HOTDAYS_SCORE_MAX = 40;

// --- PML / cluster / scenario -----------------------------------------------

export const PML_DAMAGE_FRACTION: Record<10 | 50 | 100, number> = {
  10: 0.15,
  50: 0.35,
  100: 0.55,
};
export const PML_CLUSTER_RADIUS_KM = 100;

// --- Accumulation (neighborhood of a single location) ----------------------

/**
 * Distance threshold within which already-insured locations count as
 * accumulation risk for a subject (a local hail event typically affects an
 * area of this order of magnitude). Overridable in settings.
 */
export const ACCUMULATION_RADIUS_KM = 10;

/**
 * Accumulated exposure (EUR) within the radius above which reinsurance is
 * recommended. Below it -> a deductible is acceptable; above it -> the
 * accumulation risk is too high.
 */
export const ACCUMULATION_REINSURE_THRESHOLD_EUR = 50_000_000;

export const SCENARIO_INTENSITY_DAMAGE = {
  LOW: 0.05,
  MEDIUM: 0.15,
  HIGH: 0.3,
  EXTREME: 0.55,
} as const;

// --- Detection / tiles (main process only, but centralized here) ----------

// Sliding windows are the model's input size (from its manifest); 50% overlap
// is standard — every vehicle is fully inside at least one window, and the
// seam duplicates are merged by NMS.
export const DETECTION_WINDOW_OVERLAP = 0.5;
// 20 ≈ 0.09–0.11 m/pixel at German dealership latitudes (was 19, ≈0.19m).
// Densely parked rows in industrial/dealership lots put vehicles only 1-2
// pixels apart at zoom 19, which starves the model of separable edges and
// under-counts; the extra resolution directly targets that. tiles.service
// falls back one zoom level when a region doesn't publish imagery this
// sharp, so coverage in lower-resolution areas is unaffected.
export const DETECTION_ZOOM = 20;
export const DETECTION_CONFIDENCE = 0.22;
export const TILE_SIZE = 256;

// Real-world vehicle size sanity bounds (meters), used to reject
// implausible detection boxes. Deliberately expressed in meters rather than
// model-input pixels so the check stays correct regardless of capture zoom,
// crop size, or letterboxing — a fixed pixel threshold silently miscalibrates
// whenever any of those change (e.g. it used to reject real buses once
// DETECTION_ZOOM increased, since the same real-world length then covers
// more pixels).
export const VEHICLE_MIN_WIDTH_M = 1.2;
export const VEHICLE_MAX_LENGTH_M = 16;
export const VEHICLE_MAX_ASPECT_RATIO = 5;

/**
 * Esri World Imagery — tile order is z/y/x. `blankTile=false` makes Esri
 * answer 404 where a zoom level has no imagery; by default it serves a gray
 * "Map data not yet available" JPEG with status 200, which the mosaic would
 * count as valid imagery and the detector would run on. Large parts of
 * Germany have no z20 (DETECTION_ZOOM) coverage, so this matters.
 */
export function buildEsriTileUrl(z: number, y: number, x: number): string {
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}?blankTile=false`;
}

/** Available satellite/aerial imagery tile sources. */
export type SatelliteProvider = "auto" | "esri" | "wms";

/**
 * Builds the tile URL for a fixed provider. `esri` is keyless; `wms` uses a
 * user-defined template with {z}/{x}/{y} or, for plain WMS GetMap URLs,
 * {bbox-epsg-3857} (JOSM/iD convention). `auto` is resolved per location in
 * the main process (imagery-source.service) and lands here as Esri only when
 * no state source is chosen. An optional {time} placeholder allows a
 * time dimension (e.g. Sentinel-2/aerial imagery history) for temporal change
 * detection. Falls back to Esri if the template is missing/invalid.
 */
export function buildTileUrl(
  provider: SatelliteProvider,
  z: number,
  y: number,
  x: number,
  opts: { wmsTemplate?: string; time?: string } = {},
): string {
  if (
    provider === "wms" &&
    opts.wmsTemplate &&
    opts.wmsTemplate.includes("{")
  ) {
    return fillTileTemplate(opts.wmsTemplate, z, x, y).replaceAll(
      "{time}",
      opts.time ?? "",
    );
  }
  return buildEsriTileUrl(z, y, x);
}
