import type { DetectionResult } from "@shared/types";
import { osmEvidenceBy } from "../boundary/osm-evidence.service";
import { excludeRoofDetections, roofRings } from "./roof-mask";

/**
 * Applies the roof mask with the site's OSM buildings. Joins the one evidence
 * request the boundary step also uses, so it costs no extra Overpass query;
 * when OSM is unreachable, or has not answered by `osmDeadline` (epoch ms),
 * the detection passes through unchanged.
 */
export async function maskRoofDetections(
  detection: DetectionResult,
  lat: number,
  lon: number,
  osmDeadline?: number,
): Promise<DetectionResult> {
  const { evidence } = await osmEvidenceBy(lat, lon, osmDeadline);
  return excludeRoofDetections(detection, roofRings(evidence));
}
