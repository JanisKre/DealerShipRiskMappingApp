import type {
  DetectionResult,
  HailEalDetail,
  HailStockRange,
  VehicleTimeline,
  VehicleTimelineCount,
} from "./types";

/**
 * Vehicle stock across several dated images of a lot. Dealership stock
 * turns over within weeks, so one image is a snapshot; the median and range
 * over the archived images show how representative that snapshot is.
 * Methodology and limitations: docs/imagery-sources.md.
 */

/** Images counted per request; each count is a full detector run. */
export const VEHICLE_TIMELINE_MAX_DATES = 4;

/** Fewest archived counts that make a stock range. */
export const STOCK_RANGE_MIN_IMAGES = 2;

/**
 * Relative distance from the archived median beyond which the analysed
 * image counts as an unusually full or empty day.
 */
export const STOCK_SNAPSHOT_DEVIATION = 0.3;

const LIMITATION_PREFIX = "Vehicle stock across ";

/** Median, minimum and maximum over the counts. Null without counts. */
export function summarizeVehicleTimeline(
  counts: VehicleTimelineCount[],
  computedAt: string = new Date().toISOString(),
): VehicleTimeline | null {
  if (counts.length === 0) return null;
  const sorted = counts.map((c) => c.vehicleCount).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return {
    counts,
    median,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    computedAt,
  };
}

/** Machine count on the analysed image, as the hail EAL reads it. */
function machineCount(detection: DetectionResult): number {
  const c = detection.classCounts;
  const classTotal = c ? c.car + c.van + c.truck + c.bus : 0;
  return classTotal > 0 ? classTotal : detection.vehicleCount;
}

/**
 * Vehicles (N) on a low, a median and a high day over the archived images,
 * on the scale of the N the EAL uses. A manually reviewed N is not on the
 * detector's scale, so the archived counts are scaled by manual ÷ machine
 * count on the analysed image; without a machine count there is no range.
 * Null without at least two counts, or for a source other than a count.
 */
export function stockRangeVehicles(
  detection: DetectionResult | undefined,
  vehicles: number,
  source: HailEalDetail["vehicleSource"],
): Pick<
  HailStockRange,
  | "images"
  | "from"
  | "to"
  | "vehiclesLow"
  | "vehiclesMedian"
  | "vehiclesHigh"
  | "scaledToManual"
  | "snapshot"
> | null {
  const timeline = detection?.timeline;
  if (!detection || !timeline) return null;
  if (timeline.counts.length < STOCK_RANGE_MIN_IMAGES) return null;
  if (source !== "manual" && source !== "detected") return null;
  let factor = 1;
  if (source === "manual") {
    const machine = machineCount(detection);
    if (machine <= 0) return null;
    factor = vehicles / machine;
  }
  const scale = (n: number): number => Math.round(n * factor * 10) / 10;
  const vehiclesMedian = scale(timeline.median);
  const dates = timeline.counts
    .map((c) => c.capturedAt)
    .filter((d): d is string => d != null)
    .sort();
  const deviation =
    vehiclesMedian > 0 ? (vehicles - vehiclesMedian) / vehiclesMedian : 0;
  return {
    images: timeline.counts.length,
    from: dates[0] ?? null,
    to: dates[dates.length - 1] ?? null,
    vehiclesLow: scale(timeline.min),
    vehiclesMedian,
    vehiclesHigh: scale(timeline.max),
    scaledToManual: source === "manual",
    snapshot:
      vehiclesMedian === 0
        ? vehicles > 0
          ? "high"
          : "typical"
        : deviation > STOCK_SNAPSHOT_DEVIATION
          ? "high"
          : deviation < -STOCK_SNAPSHOT_DEVIATION
            ? "low"
            : "typical",
  };
}

/** Short English line for evidence limitations, reports and memos. */
export function describeVehicleTimeline(timeline: VehicleTimeline): string {
  const dates = timeline.counts
    .map((c) => c.capturedAt)
    .filter((d): d is string => d != null)
    .sort();
  const span =
    dates.length === 0
      ? "undated images"
      : dates[0] === dates[dates.length - 1]
        ? dates[0]
        : `${dates[0]} to ${dates[dates.length - 1]}`;
  const n = timeline.counts.length;
  return `${LIMITATION_PREFIX}${n} archived image${n === 1 ? "" : "s"} (${span}): median ${timeline.median}, range ${timeline.min}–${timeline.max}. The exposure and the point EAL use the current count; the hail EAL detail shows the range.`;
}

/** Stores the timeline on a detection and replaces an earlier summary line. */
export function attachVehicleTimeline(
  detection: DetectionResult,
  timeline: VehicleTimeline,
): DetectionResult {
  return {
    ...detection,
    timeline,
    evidence: detection.evidence
      ? {
          ...detection.evidence,
          limitations: [
            ...detection.evidence.limitations.filter(
              (l) => !l.startsWith(LIMITATION_PREFIX),
            ),
            describeVehicleTimeline(timeline),
          ],
        }
      : undefined,
  };
}
