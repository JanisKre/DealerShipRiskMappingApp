import { DETECTION_ZOOM } from "@shared/constants";
import { DETECTION_MAX_RESOLUTION_M } from "@shared/imagery-sources";
import type {
  BoundaryResult,
  RiskParameters,
  VehicleTimeline,
  VehicleTimelineCount,
} from "@shared/types";
import {
  summarizeVehicleTimeline,
  VEHICLE_TIMELINE_MAX_DATES,
} from "@shared/vehicle-timeline";
import {
  detectVehicles,
  detectVehiclesInContext,
  filterDetectionToBoundary,
  isModelAvailable,
} from "./detection.service";
import { maskRoofDetections } from "./detection/roof-mask.service";
import { aerialImageForContextFrom } from "./tiles.service";
import { waybackTimeline } from "./wayback.service";

/**
 * Counts the vehicles on a lot on several archived Esri images (Wayback),
 * newest first. Only images sharp enough for the detector compete
 * (DETECTION_MAX_RESOLUTION_M, like the automatic selection). Each image is
 * captured and clipped exactly like the analysis does it (analyze.service:
 * fixed context capture around the point, then the boundary as a filter),
 * so the counts are comparable with the stored one. Runs are sequential:
 * each is a full CPU inference in the ONNX worker.
 */
export async function countVehiclesOverTime(
  lat: number,
  lon: number,
  boundary?: BoundaryResult,
  parameters?: RiskParameters,
  maxDates = VEHICLE_TIMELINE_MAX_DATES,
): Promise<VehicleTimeline> {
  // The area heuristic used without a model would just repeat one estimate.
  if (!isModelAvailable()) {
    throw new Error(
      "A vehicle detection model is required to compare image dates.",
    );
  }
  const timeline = await waybackTimeline(lat, lon, DETECTION_ZOOM);
  const eligible = timeline.candidates
    .filter(
      (c) =>
        c.capturedAt != null &&
        c.resolutionM != null &&
        c.resolutionM <= DETECTION_MAX_RESOLUTION_M,
    )
    .slice(0, maxDates);
  if (eligible.length === 0) {
    throw new Error(
      `No archived image of this location is sharp enough (≤ ${DETECTION_MAX_RESOLUTION_M} m) to count vehicles.`,
    );
  }

  const counts: VehicleTimelineCount[] = [];
  for (const candidate of eligible) {
    const image = await aerialImageForContextFrom(candidate, lat, lon);
    const raw = await detectVehiclesInContext(image, parameters);
    const detection = await maskRoofDetections(
      boundary
        ? (filterDetectionToBoundary(raw, boundary) ??
            (await detectVehicles(image, boundary, parameters)))
        : raw,
      lat,
      lon,
    );
    counts.push({
      candidateId: candidate.id,
      capturedAt: candidate.capturedAt,
      resolutionM: candidate.resolutionM,
      publishedAt: candidate.wayback?.publishedAt,
      vehicleCount: detection.vehicleCount,
    });
  }
  // `eligible` is non-empty, so a summary always exists.
  return summarizeVehicleTimeline(counts)!;
}
