import {
  distanceToRingM,
  projectPoint,
  type LonLat,
} from "../boundary-geometry";
import type { BoundaryGeometry } from "@shared/types";
import type { ParcelFeature } from "../alkis.service";
import { CASCADE_LIMITS, type CascadeInput } from "./cascade-config";
import { contains, metres, withWholeBuildings } from "./cascade-geometry";

// --- Vehicle lot ----------------------------------------------------------

/**
 * The vehicles that form the lot at the point: single-linkage clusters with
 * gaps of at most `vehicleLinkM` (a parking row across an aisle links, a lot
 * across a road does not), restricted to `maxReachM` from the point, and kept
 * when they hold at least `minLotVehicles` and come within `anchorReachM` of
 * the point or stand on the anchor parcel.
 */
export function vehicleLot(
  vehicles: LonLat[],
  anchor: LonLat,
  anchorParcel?: LonLat[],
  anchorBuilding?: LonLat[],
): LonLat[] {
  const points = vehicles.filter(
    (v) => metres(anchor, v) <= CASCADE_LIMITS.maxReachM,
  );
  const xy = points.map((p) => projectPoint(p, anchor));
  const lot: LonLat[] = [];
  for (const members of clusterIndices(xy)) {
    if (members.length < CASCADE_LIMITS.minLotVehicles) continue;
    const touches = members.some(
      (i) =>
        Math.hypot(xy[i][0], xy[i][1]) <= CASCADE_LIMITS.anchorReachM ||
        (anchorBuilding != null &&
          distanceToRingM(points[i], anchorBuilding) <=
            CASCADE_LIMITS.anchorBuildingReachM) ||
        (anchorParcel != null && contains(anchorParcel, points[i])),
    );
    if (touches) lot.push(...members.map((i) => points[i]));
  }
  return lot;
}

/** Single-linkage clusters (gaps of at most `vehicleLinkM`), as index lists. */
export function clusterIndices(xy: Array<[number, number]>): number[][] {
  const parent = xy.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let i = 0; i < xy.length; i += 1) {
    for (let j = i + 1; j < xy.length; j += 1) {
      const d = Math.hypot(xy[i][0] - xy[j][0], xy[i][1] - xy[j][1]);
      if (d <= CASCADE_LIMITS.vehicleLinkM) parent[find(i)] = find(j);
    }
  }
  const clusters = new Map<number, number[]>();
  xy.forEach((_, i) => {
    const root = find(i);
    clusters.set(root, [...(clusters.get(root) ?? []), i]);
  });
  return [...clusters.values()];
}

/** The building footprint that contains the point, if any. */
export function anchorBuildingOf(input: CascadeInput): LonLat[] | undefined {
  return (input.buildings ?? []).find((ring) => contains(ring, input.anchor));
}

export function anchorParcelOf(input: CascadeInput): ParcelFeature | undefined {
  return input.parcels.find((parcel) => contains(parcel.ring, input.anchor));
}

/**
 * A parcel result with its buildings whole (v14): every footprint that lies
 * mostly on the parcels, and the building at the point, is added along its
 * own outline. `added` counts the footprints the parcel lines had cut.
 */
export function completeBuildings(
  geometry: BoundaryGeometry,
  input: CascadeInput,
): { geometry: BoundaryGeometry; added: number } {
  const buildings = input.buildings ?? [];
  if (buildings.length === 0) return { geometry, added: 0 };
  const atPoint = anchorBuildingOf(input);
  return withWholeBuildings(geometry, buildings, {
    minShare: CASCADE_LIMITS.wholeBuildingShare,
    minBuildingSqm: CASCADE_LIMITS.wholeBuildingMinSqm,
    maxBuildingSqm: CASCADE_LIMITS.hullBuildingMaxSqm,
    maxAreaSqm: input.parameters.boundaryMaxAreaSqm,
    ...(atPoint ? { always: atPoint } : {}),
  });
}
