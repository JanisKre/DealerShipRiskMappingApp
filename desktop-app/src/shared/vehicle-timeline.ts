import type {
  DetectionResult,
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
  return `${LIMITATION_PREFIX}${n} archived image${n === 1 ? "" : "s"} (${span}): median ${timeline.median}, range ${timeline.min}–${timeline.max}. Evidence only; the exposure uses the current count.`;
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
