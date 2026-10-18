import type { DetectionResult } from "@shared/types";
import { fetchOsmEvidence } from "../boundary/osm-evidence.service";
import { excludeRoofDetections, roofRings } from "./roof-mask";

/**
 * Applies the roof mask with the site's OSM buildings. Reuses the cached
 * evidence the boundary step already fetched for the same point, so it costs
 * no extra Overpass query in the normal case; when OSM is unreachable the
 * detection passes through unchanged.
 */
export async function maskRoofDetections(
  detection: DetectionResult,
  lat: number,
  lon: number,
): Promise<DetectionResult> {
  const evidence = await fetchOsmEvidence(lat, lon).catch(() => null);
  return excludeRoofDetections(detection, roofRings(evidence));
}
