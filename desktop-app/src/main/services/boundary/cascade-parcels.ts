import {
  distanceToRingM,
  projectPoint,
  ringAreaSqm,
  type LonLat,
} from "../boundary-geometry";
import type { ParcelFeature } from "../alkis.service";
import { addressKeys } from "./parcel-address";
import { CASCADE_LIMITS } from "./cascade-config";
import {
  contains,
  boundingLengthM,
  boundingBox,
  ringCentre,
  ringBounds,
} from "./cascade-geometry";

const angleCache = new WeakMap<LonLat[], number>();

/** Direction of a ring's long axis, cached per ring. */
function longAxisAngle(ring: LonLat[]): number {
  const hit = angleCache.get(ring);
  if (hit !== undefined) return hit;
  const angle = boundingBox(ring.map((p) => projectPoint(p, ring[0]))).angle;
  angleCache.set(ring, angle);
  return angle;
}

/**
 * A strip of farmland or a deep plot in a row of equal strips (a "Gewann"):
 * street-like by shape, but with at least `fieldStripMinNeighbours` adjacent
 * street-like parcels running parallel to it. Streets meet other parcels at
 * an angle or run alongside building plots; field strips lie side by side. In
 * the November audit a dealership stood across five such strips, and the
 * result was one 10 m strip running into the field.
 */
export function isFieldStrip(
  parcel: ParcelFeature,
  parcels: ParcelFeature[],
): boolean {
  // With land use published a narrow plot is simply a plot: it joins by its
  // vehicles like any other, which is what the strip rule approximates.
  if (parcel.landUse || !isStreetLike(parcel.ring)) return false;
  const own = longAxisAngle(parcel.ring);
  let parallel = 0;
  for (const other of parcels) {
    if (other === parcel || !isStreetLike(other.ring)) continue;
    if (!isAdjacent(other, parcel) && !isAdjacent(parcel, other)) continue;
    const diff = Math.abs(longAxisAngle(other.ring) - own);
    const deviation = Math.min(diff, Math.PI - diff);
    if (deviation <= (CASCADE_LIMITS.fieldStripMaxAngleDeg * Math.PI) / 180) {
      parallel += 1;
      if (parallel >= CASCADE_LIMITS.fieldStripMinNeighbours) return true;
    }
  }
  return false;
}

const streetCache = new WeakMap<ParcelFeature[], Set<ParcelFeature>>();

/** Street-like parcels that are streets, not field strips; cached per parcel set. */
export function streetParcels(parcels: ParcelFeature[]): Set<ParcelFeature> {
  const hit = streetCache.get(parcels);
  if (hit) return hit;
  const streets = new Set(
    parcels.filter(
      (parcel) => isStreetParcel(parcel) && !isFieldStrip(parcel, parcels),
    ),
  );
  streetCache.set(parcels, streets);
  return streets;
}

/**
 * A street, path or rail parcel between two plots. Width is 2·area/perimeter
 * (close to the width of a strip, of a branched street network too). That
 * estimate is also small for an L- or U-shaped yard, so narrowness alone is
 * not enough: the parcel must also be long (minimum bounding rectangle over
 * `streetMinLengthM`) or very narrow (`streetNarrowM`). The November audit
 * found yards of 39 × 97 m with 64 dealer vehicles rejected by the old
 * elongation test.
 */
const streetLikeCache = new WeakMap<LonLat[], boolean>();

export function isStreetLike(ring: LonLat[]): boolean {
  const hit = streetLikeCache.get(ring);
  if (hit !== undefined) return hit;
  const value = streetLikeShape(ring);
  streetLikeCache.set(ring, value);
  return value;
}

function streetLikeShape(ring: LonLat[]): boolean {
  const origin = ring[0];
  const xy = ring.map((p) => projectPoint(p, origin));
  let perimeter = 0;
  for (let i = 1; i < xy.length; i += 1) {
    perimeter += Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]);
  }
  if (perimeter === 0) return false;
  const width = (2 * ringAreaSqm(ring)) / perimeter;
  if (width >= CASCADE_LIMITS.streetMaxWidthM) return false;
  return (
    width < CASCADE_LIMITS.streetNarrowM ||
    boundingLengthM(xy) > CASCADE_LIMITS.streetMinLengthM
  );
}

/**
 * Street-like only because it is narrow, not because it is long: a footpath,
 * a driveway, or a parking strip or corner of a yard cut as its own plot.
 * Such a parcel joins a lot only when it is full of lot vehicles.
 */
export function isShortStrip(ring: LonLat[]): boolean {
  if (!isStreetLike(ring)) return false;
  const xy = ring.map((p) => projectPoint(p, ring[0]));
  return boundingLengthM(xy) <= CASCADE_LIMITS.streetMinLengthM;
}

/**
 * What the cadastre's land use says about a parcel being a street: true or
 * false where the service publishes land use, null where it does not. A
 * parcel with a house number is a plot, whatever its registered use.
 */
export function streetByUse(
  parcel: Pick<ParcelFeature, "landUse" | "address">,
): boolean | null {
  if (!parcel.landUse) return null;
  return (
    (parcel.landUse.traffic ?? 0) >= CASCADE_LIMITS.streetTrafficShare &&
    addressKeys(parcel.address).length === 0
  );
}

/**
 * A street, path or rail parcel: by the cadastre's land use where it is
 * published, by shape otherwise. The shape test alone calls every plot
 * under about 20 × 20 m street-like, so small yard plots never joined.
 */
export function isStreetParcel(
  parcel: Pick<ParcelFeature, "ring" | "landUse" | "address">,
): boolean {
  return streetByUse(parcel) ?? isStreetLike(parcel.ring);
}

/** Housing or open land by the cadastre's land use; false when unknown. */
export function isForeignUse(parcel: ParcelFeature): boolean {
  const use = parcel.landUse;
  if (!use) return false;
  return (
    Math.max(use.residential ?? 0, use.open ?? 0) >=
    CASCADE_LIMITS.foreignUseShare
  );
}

const greenCache = new WeakMap<
  (point: LonLat) => boolean | null,
  WeakMap<LonLat[], number | null>
>();

/**
 * Share of a ring's area that is vegetation on the aerial image, sampled on
 * a lattice of at least 3 m. Null without an image or when less than 70 %
 * of the ring lies on it.
 */
export function greenShare(
  ring: LonLat[],
  vegetationAt: ((point: LonLat) => boolean | null) | undefined,
  buildings: LonLat[][] = [],
): number | null {
  if (!vegetationAt) return null;
  let perMask = greenCache.get(vegetationAt);
  if (!perMask) {
    perMask = new WeakMap();
    greenCache.set(vegetationAt, perMask);
  }
  const hit = perMask.get(ring);
  if (hit !== undefined) return hit;
  const [west, south, east, north] = ringBounds(ring);
  const stepM = Math.max(3, Math.sqrt(ringAreaSqm(ring) / 1500));
  const dLat = stepM / 111_320;
  const dLon =
    dLat / Math.max(0.1, Math.cos((((south + north) / 2) * Math.PI) / 180));
  // Roofs are not vegetation, whatever their colour (a dark roof in shade
  // can pass the colour test).
  const roofs = buildings.filter((roof) => {
    const [bw, bs, be, bn] = ringBounds(roof);
    return bw <= east && be >= west && bs <= north && bn >= south;
  });
  let inside = 0;
  let known = 0;
  let green = 0;
  for (let lat = south + dLat / 2; lat < north; lat += dLat) {
    for (let lon = west + dLon / 2; lon < east; lon += dLon) {
      const point: LonLat = [lon, lat];
      if (!contains(ring, point)) continue;
      inside += 1;
      const value = vegetationAt(point);
      if (value == null) continue;
      known += 1;
      if (value && !roofs.some((roof) => contains(roof, point))) green += 1;
    }
  }
  const share = inside >= 5 && known >= 0.7 * inside ? green / known : null;
  perMask.set(ring, share);
  return share;
}

/**
 * Share of a parcel's outline that lies within `adjacentParcelM` of the
 * given rings, sampled every 2 m. 1 for a parcel the rings surround.
 */
export function borderShare(parcel: ParcelFeature, rings: LonLat[][]): number {
  const ring = parcel.ring;
  const origin = ring[0];
  const near = rings.filter((other) => isAdjacent(parcel, { ring: other }));
  if (near.length === 0) return 0;
  let total = 0;
  let shared = 0;
  for (let i = 1; i < ring.length; i += 1) {
    const [x0, y0] = projectPoint(ring[i - 1], origin);
    const [x1, y1] = projectPoint(ring[i], origin);
    const length = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(length / 2));
    for (let s = 0; s < steps; s += 1) {
      const t = (s + 0.5) / steps;
      const point: LonLat = [
        ring[i - 1][0] + (ring[i][0] - ring[i - 1][0]) * t,
        ring[i - 1][1] + (ring[i][1] - ring[i - 1][1]) * t,
      ];
      const weight = length / steps;
      total += weight;
      if (
        near.some(
          (other) =>
            distanceToRingM(point, other) <= CASCADE_LIMITS.adjacentParcelM,
        )
      ) {
        shared += weight;
      }
    }
  }
  return total > 0 ? shared / total : 0;
}

/**
 * Parcel area not covered by buildings, never below `minUnbuiltShare` of the
 * parcel. Buildings are assigned to the parcel holding their centre.
 */
export function unbuiltAreaSqm(
  parcel: ParcelFeature,
  buildings: LonLat[][],
): number {
  const built = buildings
    .filter((ring) => contains(parcel.ring, ringCentre(ring)))
    .reduce((sum, ring) => sum + ringAreaSqm(ring), 0);
  return Math.max(
    parcel.areaSqm - built,
    CASCADE_LIMITS.minUnbuiltShare * parcel.areaSqm,
  );
}

export function isAdjacent(
  a: Pick<ParcelFeature, "ring">,
  b: Pick<ParcelFeature, "ring">,
): boolean {
  // Cheap reject first: boxes further apart than the adjacency distance.
  const [aw, as, ae, an] = ringBounds(a.ring);
  const [bw, bs, be, bn] = ringBounds(b.ring);
  const marginLat = CASCADE_LIMITS.adjacentParcelM / 111_320;
  const marginLon =
    marginLat / Math.max(0.1, Math.cos((((as + an) / 2) * Math.PI) / 180));
  if (
    aw > be + marginLon ||
    bw > ae + marginLon ||
    as > bn + marginLat ||
    bs > an + marginLat
  ) {
    return false;
  }
  return a.ring.some(
    (point) => distanceToRingM(point, b.ring) <= CASCADE_LIMITS.adjacentParcelM,
  );
}
