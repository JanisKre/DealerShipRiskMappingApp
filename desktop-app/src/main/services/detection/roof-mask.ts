import type { DetectionBox, DetectionResult } from "@shared/types";
import {
  distanceToRingM,
  ringAreaSqm,
  type LonLat,
} from "../boundary-geometry";
import type { OsmEvidence } from "../boundary/osm-overpass";
import type { OfficialBuilding } from "../alkis-buildings.service";

/**
 * Roof masking for vehicle detections.
 *
 * Cars do not stand on roofs. On aerial imagery, though, the detector reads
 * solar panel rows, roof vents and parked-car-sized roof fixtures as vehicles,
 * and those false positives inflate exposure directly. Detections whose
 * centre lies on a mapped building footprint are therefore dropped.
 * Footprints come from OSM and, where a state publishes them, from the
 * official cadastre (ALKIS), which also records buildings OSM lacks.
 *
 * Kept deliberately conservative:
 * - A detection is only removed when it sits at least `ROOF_INSET_M` inside
 *   the footprint. Footprints and imagery are never perfectly registered, and
 *   cars parked along a wall must survive a metre or two of offset.
 * - Multi-storey and rooftop car parks are not masked; there, vehicles on the
 *   roof are real.
 *   The cadastre names them by function (Parkhaus, Parkdeck, Tiefgarage);
 *   INSPIRE-only states do not, so there an official footprint that overlaps
 *   an OSM car park is not masked either.
 * - Without footprints (Overpass unreachable, building not mapped) nothing is
 *   removed; the mask only ever narrows a count, it never invents one.
 */

/** Minimum distance inside a footprint before a detection counts as on the roof. */
export const ROOF_INSET_M = 2;

/**
 * A roof carrying at least this many detections, at no more than
 * `DECK_MAX_SQM_PER_VEHICLE` of roof per detection, is a parking deck the
 * cadastre does not record as one (a dealer's rotunda deck is often filed as
 * a commercial building). Roof fixtures and solar rows read as a handful of
 * scattered detections; a deck is packed. The November audit found decks
 * with one detection per 19–53 m² that the mask had removed whole.
 */
export const DECK_MIN_VEHICLES = 15;
export const DECK_MAX_SQM_PER_VEHICLE = 60;

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

function isOsmParkingArea(tags: Record<string, string>): boolean {
  if (tags.building && PARKING_ROOF_BUILDINGS.has(tags.building)) return true;
  return tags.parking != null && PARKING_ROOF_TYPES.has(tags.parking);
}

function centroid(ring: LonLat[]): LonLat {
  let lon = 0;
  let lat = 0;
  const n = ring.length - 1 || 1;
  for (let i = 0; i < n; i++) {
    lon += ring[i][0];
    lat += ring[i][1];
  }
  return [lon / n, lat / n];
}

/**
 * Official (ALKIS) footprints that cannot carry parked vehicles: car parks
 * by cadastral function are left out, and so are footprints of unknown
 * function that overlap an OSM car park (centre of either inside the other).
 */
export function officialRoofRings(
  buildings: OfficialBuilding[],
  evidence: OsmEvidence | null,
): LonLat[][] {
  const osmParking = (evidence?.areas ?? [])
    .filter((area) => area.ring.length >= 4 && isOsmParkingArea(area.tags))
    .map((area) => area.ring);
  return buildings
    .filter((b) => {
      if (b.parkingRoof) return false;
      if (b.functionKnown) return true;
      const c = centroid(b.ring);
      return !osmParking.some(
        (p) => ringContains(p, c) || ringContains(b.ring, centroid(p)),
      );
    })
    .map((b) => b.ring);
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

/** The footprint `point` lies at least `insetM` inside, if any. */
function roofOf(
  point: LonLat,
  rings: IndexedRing[],
  insetM: number,
): IndexedRing | undefined {
  const [lon, lat] = point;
  return rings.find(
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
  /** Where the footprints came from, for the provenance line. */
  source = "OSM buildings",
): DetectionResult {
  if (!detection.boxes || roofs.length === 0) return detection;
  const indexed = index(roofs);
  const roofByBox = detection.boxes.map((box) =>
    box.lon != null && box.lat != null
      ? roofOf([box.lon, box.lat], indexed, insetM)
      : undefined,
  );
  const perRoof = new Map<IndexedRing, number>();
  for (const roof of roofByBox) {
    if (roof) perRoof.set(roof, (perRoof.get(roof) ?? 0) + 1);
  }
  const decks = new Set(
    [...perRoof]
      .filter(
        ([roof, count]) =>
          count >= DECK_MIN_VEHICLES &&
          ringAreaSqm(roof.ring) / count <= DECK_MAX_SQM_PER_VEHICLE,
      )
      .map(([roof]) => roof),
  );
  const kept: DetectionBox[] = [];
  let removed = 0;
  let onDecks = 0;
  detection.boxes.forEach((box, i) => {
    const roof = roofByBox[i];
    if (roof && !decks.has(roof)) {
      removed += 1;
      return;
    }
    if (roof) onDecks += 1;
    kept.push(box);
  });
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
          method: `${detection.evidence.method}, roof mask (${source})`,
          limitations: [
            ...detection.evidence.limitations,
            `${removed} detection(s) on mapped building roofs removed`,
            ...(onDecks > 0
              ? [
                  `${onDecks} detection(s) kept on ${decks.size} densely packed roof(s), read as parking decks`,
                ]
              : []),
          ],
        }
      : undefined,
  };
}
