import type { DetectionBox, DetectionResult } from "@shared/types";
import { distanceToRingM, type LonLat } from "../boundary-geometry";
import type { OsmEvidence } from "../boundary/osm-overpass";

/**
 * Roof masking for vehicle detections.
 *
 * Cars do not stand on roofs. On aerial imagery, though, the detector reads
 * solar panel rows, roof vents and parked-car-sized roof fixtures as vehicles,
 * and those false positives inflate exposure directly. Detections whose
 * centre lies on a mapped building footprint are therefore dropped.
 *
 * Kept deliberately conservative:
 * - A detection is only removed when it sits at least `ROOF_INSET_M` inside
 *   the footprint. Footprints and imagery are never perfectly registered, and
 *   cars parked along a wall must survive a metre or two of offset.
 * - Multi-storey and rooftop car parks are not masked; there, vehicles on the
 *   roof are real.
 * - Without footprints (Overpass unreachable, building not mapped) nothing is
 *   removed; the mask only ever narrows a count, it never invents one.
 */

/** Minimum distance inside a footprint before a detection counts as on the roof. */
export const ROOF_INSET_M = 2;

/** Building values whose roofs legitimately carry parked vehicles. */
const PARKING_ROOF_BUILDINGS = new Set(["parking"]);
const PARKING_ROOF_TYPES = new Set(["multi-storey", "rooftop"]);

/** Building footprints that cannot carry parked vehicles. */
export function roofRings(evidence: OsmEvidence | null): LonLat[][] {
  if (!evidence) return [];
  return evidence.areas
    .filter((area) => {
      const building = area.tags.building;
      if (!building || building === "no") return false;
      if (PARKING_ROOF_BUILDINGS.has(building)) return false;
      if (area.tags.parking && PARKING_ROOF_TYPES.has(area.tags.parking))
        return false;
      return area.ring.length >= 4;
    })
    .map((area) => area.ring);
}

interface IndexedRing {
  ring: LonLat[];
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

function index(rings: LonLat[][]): IndexedRing[] {
  return rings.map((ring) => {
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (const [lon, lat] of ring) {
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
    return { ring, minLon, maxLon, minLat, maxLat };
  });
}

function ringContains(ring: LonLat[], point: LonLat): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = yi > point[1] !== yj > point[1];
    if (crosses && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** True when `point` lies at least `insetM` inside one of the footprints. */
function onRoof(point: LonLat, rings: IndexedRing[], insetM: number): boolean {
  const [lon, lat] = point;
  return rings.some(
    (r) =>
      lon >= r.minLon &&
      lon <= r.maxLon &&
      lat >= r.minLat &&
      lat <= r.maxLat &&
      ringContains(r.ring, point) &&
      distanceToRingM(point, r.ring) >= insetM,
  );
}

/**
 * Drops detections on building roofs and recounts. Returns the input
 * unchanged when there is nothing to mask, so provenance is never rewritten
 * for no reason.
 */
export function excludeRoofDetections(
  detection: DetectionResult,
  roofs: LonLat[][],
  insetM = ROOF_INSET_M,
): DetectionResult {
  if (!detection.boxes || roofs.length === 0) return detection;
  const indexed = index(roofs);
  const kept: DetectionBox[] = [];
  let removed = 0;
  for (const box of detection.boxes) {
    if (
      box.lon != null &&
      box.lat != null &&
      onRoof([box.lon, box.lat], indexed, insetM)
    ) {
      removed += 1;
      continue;
    }
    kept.push(box);
  }
  if (removed === 0) return detection;

  // Manual adjustments describe the reviewed scene and are left alone; only
  // the machine count is corrected.
  const confidence =
    kept.length > 0
      ? kept.reduce((sum, box) => sum + box.score, 0) / kept.length
      : 0;
  return {
    ...detection,
    vehicleCount: kept.length,
    confidence,
    classCounts: { car: kept.length, van: 0, truck: 0, bus: 0 },
    boxes: kept,
    evidence: detection.evidence
      ? {
          ...detection.evidence,
          confidence,
          method: `${detection.evidence.method}, roof mask (OSM buildings)`,
          limitations: [
            ...detection.evidence.limitations,
            `${removed} detection(s) on mapped building roofs removed`,
          ],
        }
      : undefined,
  };
}
