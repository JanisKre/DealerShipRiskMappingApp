import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import { featureCollection, polygon as turfPolygon } from "@turf/helpers";
import { union } from "@turf/union";
import type { Feature, MultiPolygon, Polygon as GeoPolygon } from "geojson";
import type {
  BoundaryGeometry,
  BoundaryResult,
  BoundaryReviewFlag,
  RiskParameters,
} from "@shared/types";
import { geometryAreaSqm, outerRings } from "@shared/boundary-geometry-utils";
import {
  approximatePolygonIoU,
  checkRing,
  distanceToRingM,
  projectPoint,
  ringAreaSqm,
  type LonLat,
} from "../boundary-geometry";
import type { ParcelFeature } from "../alkis.service";
import type { OsmEvidence } from "./osm-overpass";
import {
  cellCount,
  cellIndex,
  cellToLonLat,
  createGridSpec,
  lonLatToCell,
  type GridSpec,
} from "./grid";
import {
  dilate,
  erode,
  rasterizeDisk,
  rasterizeMaskPolygon,
} from "./rasterize";
import { masksToGeometry } from "./vectorize";
import { matchesSite } from "./site-membership";
import { addressKeys, sharesAddress } from "./parcel-address";

/**
 * Source cascade: the boundary engine. Version 2 lets the detected vehicles
 * decide how far the site reaches and the cadastre decide its shape
 * (docs/boundary-model.md, "Source cascade").
 *
 * Each stage has one acceptance rule, and the first stage that accepts wins:
 *
 *   1. vehicle parcels  — the parcel at the point plus every adjacent parcel
 *                         holding part of the vehicle lot at the point
 *   2. vehicle hull     — the outline of the vehicle lot, where there is no
 *                         usable cadastre
 *   3. OSM dealer area  — only when OSM is already cached; never waited for
 *   4. parcel           — the parcel at the point when no vehicles were seen
 *   5. synthetic circle — always succeeds, always reviewed (caller)
 *
 * Why vehicles: what a dealership insures against hail is the stock standing
 * outside, and the stock is what the aerial image shows. No map source knows
 * which plots a dealer actually uses; a parcel is a legal unit, OSM is drawn
 * by volunteers and the public Overpass servers are mostly at capacity.
 *
 * Every stage is pure over already-fetched evidence. Stages that also produced
 * a geometry are returned as alternatives for review.
 *
 * Confidence values are fixed priors per stage, not calibrated probabilities.
 * Only stage 1 with good vehicle coverage clears the default review threshold
 * (0.7).
 */

/**
 * Bumped whenever a stage rule changes, so cached results can be retired.
 * 3: complete cadastre, street test by length, empty-parcel test, anchor
 * reach from the building edge, bounded lot extension, outline with
 * buildings (docs/boundary-model.md, "Cascade v3").
 * 4: field strips (a point on one declines stage 1; they are not streets),
 * `anchorOffLot` flag with the lot's parcels as an alternative, stricter
 * empty-parcel test for large areas, minimum area in stage 1
 * (docs/boundary-model.md, "Cascade v4").
 * 5: the building complex at the point joins the vehicle outline; Bayern
 * footprints from the LoD2 model.
 * 6: traffic areas cut the outline where there are no street parcels
 * (Bayern land-use map).
 * 7: full confidence from 70 % lot coverage (was 80 %).
 * 8: small dense parcels, short parking strips (as leaves) and enclosed
 * parcels join; holes in the parcel union are filled
 * (docs/boundary-model.md, "Cascade v8").
 * 9: the cadastre's land use decides what a street is, where published;
 * parcels with the address of the parcel at the point join; a point whose
 * parcel does not carry the dealership's address moves to the parcel that
 * does; housing and open land join only when dense with vehicles
 * (docs/boundary-model.md, "Cascade v9").
 * 10: parcels in all states; a dense lot across a street joins.
 * 11: a point in woodland or open land, with no building and no vehicles
 * near it, is off the site (`pointOffSite`): its parcel is not returned,
 * the nearest vehicle lot within reach is, else a small marker
 * (docs/boundary-model.md, "Cascade v11").
 */
export const CASCADE_VERSION = 11;

export type CascadeStage = 1 | 2 | 3 | 4 | 5;

/** Limits in metres and m². See docs/boundary-model.md, "Source cascade". */
export const CASCADE_LIMITS = {
  /** Below this nothing is a dealership lot — a kiosk, a garage, a sliver. */
  minLotSqm: 300,
  /** Smallest vehicle hull worth returning. */
  minHullSqm: 200,
  /** A parcel larger than this is an estate or a field, not a lot. */
  maxParcelSqm: 30_000,
  /** Vehicles further apart than this belong to different lots. */
  vehicleLinkM: 12,
  /**
   * A vehicle cluster belongs to the site if it comes this close to the point.
   * Was 25 m; a showroom is 40–80 m across, and a point on its roof then
   * reached only the cars on one side.
   */
  anchorReachM: 40,
  /** … or this close to the edge of the building the point lies in. */
  anchorBuildingReachM: 25,
  /**
   * Vehicles further from the point are ignored, so lots cannot chain on
   * through a business park. 150 m doubled the area bias on the benchmark.
   */
  maxReachM: 80,
  /**
   * Second pass: a cluster up to this far from the point joins when it
   * continues the lot (shares a vehicle with it) or stands on a parcel the
   * lot already holds. Bounded, unlike a plain larger `maxReachM`.
   */
  extendedReachM: 160,
  /**
   * The second pass may add at most this share of the first pass's area.
   * A larger jump is offered as an alternative instead: in the audit, small
   * additions completed a lot (Dresden, Kassel) and large ones reached into
   * neighbouring blocks whose ownership the image cannot tell.
   */
  maxExtensionShare: 0.25,
  /** Fewer vehicles than this are a few parked cars, not a lot. */
  minLotVehicles: 3,
  /**
   * An adjacent parcel joins when at least this many lot vehicles stand on it:
   * a yard, not a neighbour's staff parking.
   */
  parcelMinVehicles: 10,
  /**
   * … or, for a small lot, this share of it (at least `minLotVehicles`): the
   * yard of a small dealer never holds ten cars, and its result was the
   * building parcel alone.
   */
  parcelMinLotShare: 0.3,
  /**
   * … and at least this many per 1,000 m² of its unbuilt area (parcel minus
   * buildings). Keeps a meadow with a row of cars at its edge out; a showroom
   * parcel, mostly roof, still joins.
   */
  parcelMinVehiclesPer1000Sqm: 3,
  /**
   * … or this many when the unbuilt area exceeds `largeUnbuiltSqm`. In the
   * 50-site run a 13,900 m² sand lot with 49 scattered detections (3.5)
   * joined a Berlin site at confidence 0.75; real yards stand at 20–70. A
   * global 5 cut a dealer's own yard where the lot reached only part of its
   * rows, and counting every vehicle on the parcel let dense street parking
   * of inner-city neighbours join (Hannover 0.90 → 0.34).
   */
  parcelMinVehiclesPer1000SqmLarge: 5,
  largeUnbuiltSqm: 10_000,
  /** Unbuilt area is never taken as less than this share of the parcel. */
  minUnbuiltShare: 0.2,
  /**
   * A small adjacent parcel also joins with fewer than `parcelMinVehicles`,
   * but at least `parcelDenseMinVehicles`, when its lot vehicles stand at
   * least `parcelDenseVehiclesPer1000Sqm` per 1,000 m² of unbuilt area: a
   * 970 m² corner of the yard holds five cars, not ten, and was cut out of
   * the lot as a notch (docs/boundary-model.md, "Cascade v8"). Three cars in
   * the courtyard of a town-centre block were not enough.
   */
  parcelDenseMinVehicles: 5,
  parcelDenseVehiclesPer1000Sqm: 8,
  /**
   * A short narrow parcel (street-like by width only, not longer than
   * `streetMinLengthM`) joins as a leaf — nothing grows from it — when at
   * least this many lot vehicles stand per 1,000 m² of the strip: a parking
   * strip or corner of the forecourt cut as its own plot, not a driveway
   * with a few cars at its edge.
   */
  stripMinVehiclesPer1000Sqm: 15,
  /**
   * A parcel of which at least this share of the outline borders the parcels
   * already chosen is enclosed by the lot and joins whatever stands on it: an
   * annex plot, a transformer, a driveway between two yards.
   */
  enclosedMinShare: 0.75,
  /** … unless it is larger than this share of the lot chosen so far. */
  enclosedMaxShareOfLot: 0.5,
  /**
   * Where the cadastre publishes land use, a parcel is a street when at
   * least this share of it is traffic area and it carries no house number
   * (a dealer's yard was found registered as "Weg" under its own address).
   */
  streetTrafficShare: 0.5,
  /**
   * A parcel of which at least this share is housing or open land (farmland,
   * woodland, parks) joins only by the dense rule, and joins as an enclosed
   * plot only below `enclosedForeignMaxSqm`: a neighbour's house or a meadow
   * inside the block is not the dealer's.
   */
  foreignUseShare: 0.5,
  enclosedForeignMaxSqm: 200,
  /**
   * A parcel of which at least this share is vegetation on the aerial image
   * is treated like open land: it joins only by the dense rule.
   */
  greenParcelShare: 0.5,
  /**
   * Vegetation is trimmed off a parcel union where it forms a patch of at
   * least `trimMinSqm` at the edge of the result that survives an opening
   * of `trimOpenM` (so tree rows, islands and the lawn in front of the
   * display rows stay) and has no detected vehicle within
   * `trimVehicleClearM`. With 400 m² and 4 m the lawn along a
   * forecourt was cut off and the outline followed the car rows.
   */
  trimMinSqm: 600,
  trimOpenM: 5,
  trimVehicleClearM: 8,
  /**
   * A parcel with the address of the parcel at the point joins without
   * vehicles up to this size, and beyond it only while it is no larger than
   * the parcels chosen so far.
   */
  addressJoinFreeSqm: 5000,
  /**
   * A parcel carrying the dealership's address counts as the parcel at the
   * point when it lies within this distance of a point whose own parcel has
   * another address or none.
   */
  addressAnchorReachM: 150,
  /** Vertex distance at which two parcels count as neighbours. */
  adjacentParcelM: 3,
  /**
   * Street test. Width is 2·area/perimeter, which is right for a strip but
   * also small for an L- or U-shaped yard; so a parcel is a street only when
   * it is narrower than `streetMaxWidthM` and either longer than
   * `streetMinLengthM` (its minimum bounding rectangle) or narrower than
   * `streetNarrowM`.
   */
  streetMaxWidthM: 20,
  streetMinLengthM: 150,
  streetNarrowM: 10,
  /** A street-like parcel with this many parallel street-like neighbours … */
  fieldStripMinNeighbours: 2,
  /** … within this angle is a field strip, not a street. */
  fieldStripMaxAngleDeg: 15,
  /**
   * The point is "off the lot" when the parcel at the point holds less than
   * this share of the lot vehicles off the street …
   */
  anchorOffLotShare: 0.25,
  /** … and the chosen parcels less than this share. */
  anchorOffLotResultShare: 0.5,
  /**
   * Margin around the outermost vehicle centres in the outline: half a car,
   * a driving lane and the forecourt edge.
   */
  hullMarginM: 10,
  /**
   * An outline needs at least this many vehicles. With fewer, the dealer's
   * stock was not seen, and the outline of a few cars is far too small.
   */
  hullMinVehicles: 20,
  /**
   * Gaps narrower than twice this between vehicles of the same lot (aisles,
   * empty bays, a showroom between rows) are filled in the outline.
   */
  hullCloseM: 20,
  /**
   * A building joins the outline when at least this share of it, or of its
   * outline, lies within `hullCloseM` of the lot vehicles: the showroom
   * between or among the rows.
   */
  hullBuildingShare: 0.5,
  /** Larger buildings (a neighbouring hall) never join the outline. */
  hullBuildingMaxSqm: 20_000,
  /** Vehicles outside the result but this close to it count as unexplained. */
  outsideNearbyM: 15,
  /**
   * Share of lot vehicles a parcel result must cover for full confidence.
   * Was 0.8; on 76 visually judged sites, correct results covered 0.70–0.78
   * of their lot (kerbside cars and a neighbour's yard in the lot) and were
   * flagged for that alone (docs/boundary-model.md, "Review calibration").
   */
  goodCoverage: 0.7,
  /**
   * A parcel across a street from the lot (adjacent to a street parcel the
   * lot borders, not to the lot) joins as a second part when at least this
   * many lot vehicles stand on it…
   */
  acrossMinVehicles: 10,
  /** … at this density (a parked-up car lot, not a customer car park)… */
  acrossMinVehiclesPer1000Sqm: 15,
  /** … or when it has the dealership's address and `minLotVehicles`. */
} as const;

export const CASCADE_CONFIDENCE = {
  vehicleParcels: 0.75,
  vehicleParcelsPartial: 0.6,
  /** Was 0.55; the outline scored a mean IoU of 0.23 in the November audit. */
  vehicleHull: 0.45,
  dealerMatchedInside: 0.65,
  dealerInside: 0.55,
  dealerMatchedNear: 0.5,
  /** Contains the point but carries another business's name. */
  dealerNamedOtherwise: 0.45,
  parcel: 0.4,
} as const;

export interface CascadeInput {
  anchor: LonLat;
  name?: string;
  address?: string;
  /**
   * Georeferenced vehicle centres from the context image, roofs masked.
   * Null when no detector or no image was available.
   */
  vehicles: LonLat[] | null;
  /** Null when OSM is not cached yet; the cascade never waits for it. */
  osm: OsmEvidence | null;
  parcels: ParcelFeature[];
  /**
   * True when the cadastre answer was capped even after paging, so parcels
   * may be missing (alkis.service.ts `truncated`).
   */
  parcelsTruncated?: boolean;
  /**
   * Building footprints (official ALKIS, OSM when cached). Used for the
   * unbuilt area of a parcel, the building the point lies in and the
   * buildings inside a vehicle outline. Empty where none are published.
   */
  buildings?: LonLat[][];
  /**
   * Traffic areas where there are no street parcels (Bayern: the ALKIS
   * land-use map). The outline is cut back there like at street parcels.
   */
  isStreetAt?: (point: LonLat) => boolean;
  /**
   * Vegetation on the aerial image (grass, trees in leaf); null outside the
   * image. A parcel that is mostly vegetation joins only when dense with
   * vehicles, and planted fringes without vehicles are trimmed off the
   * parcel union (boundary/vegetation.ts).
   */
  vegetationAt?: (point: LonLat) => boolean | null;
  parameters: RiskParameters;
}

export interface StageOutcome {
  result: BoundaryResult | null;
  /** One line explaining why the stage accepted or declined. */
  reason: string;
  /** Geometries worth offering as alternatives even though not chosen. */
  alternatives: BoundaryResult[];
  /** Vehicles the stage counted as the lot, when it formed one. */
  lotVehicles?: number;
  /** Review conditions the stage found, kept only for the chosen stage. */
  flags?: BoundaryReviewFlag[];
}

export interface CascadeOutcome {
  /** Null when stages 1–4 all declined; the caller adds the circle. */
  result: BoundaryResult | null;
  stage: CascadeStage | null;
  trace: string[];
  alternatives: BoundaryResult[];
  /** Size of the vehicle lot at the point (stage 1 or 2), when one formed. */
  lotVehicles?: number;
  /** Conditions that send the result to review on their own. */
  flags: BoundaryReviewFlag[];
  /**
   * The point lies in woodland or open land with nothing of a dealership
   * near it; the caller then draws a small marker, not the full circle.
   */
  pointOffSite?: boolean;
  /**
   * The point the stages started from, when it is not the given one: a
   * point inside the parcel that carries the dealership's address.
   */
  anchor?: LonLat;
}

const now = (): string => new Date().toISOString();

function contains(ring: LonLat[], point: LonLat): boolean {
  try {
    return booleanPointInPolygon(point, {
      type: "Polygon",
      coordinates: [ring],
    });
  } catch {
    return false;
  }
}

function geometryContains(geometry: BoundaryGeometry, point: LonLat): boolean {
  try {
    return booleanPointInPolygon(point, geometry);
  } catch {
    return false;
  }
}

function distanceM(ring: LonLat[], point: LonLat): number {
  return contains(ring, point) ? 0 : distanceToRingM(point, ring);
}

function metres(a: LonLat, b: LonLat): number {
  const [x, y] = projectPoint(b, a);
  return Math.hypot(x, y);
}

function validRing(ring: LonLat[], maxAreaSqm: number): boolean {
  return (
    ring.length >= 4 && checkRing(ring, { minAreaSqm: 10, maxAreaSqm }).valid
  );
}

/** Union of rings, keeping every component and hole. */
export function unionRings(rings: LonLat[][]): BoundaryGeometry | null {
  if (rings.length === 0) return null;
  if (rings.length === 1) return { type: "Polygon", coordinates: [rings[0]] };
  let merged: Feature<GeoPolygon | MultiPolygon> = turfPolygon([rings[0]]);
  for (const ring of rings.slice(1)) {
    try {
      const next = union(featureCollection([merged, turfPolygon([ring])]));
      if (next) merged = next;
    } catch {
      // A malformed ring is skipped rather than losing the whole union.
    }
  }
  const geometry = merged.geometry;
  return geometry.type === "Polygon"
    ? { type: "Polygon", coordinates: geometry.coordinates as LonLat[][] }
    : {
        type: "MultiPolygon",
        coordinates: geometry.coordinates as LonLat[][][],
      };
}

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
function clusterIndices(xy: Array<[number, number]>): number[][] {
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

/**
 * The lot continued beyond `maxReachM`, up to `extendedReachM`: clusters of
 * at least `minLotVehicles` that share a vehicle with the lot (the same rows,
 * cut off at 80 m) or stand with at least `minLotVehicles` vehicles on parcels
 * the lot already holds. Bounded on purpose — counting every vehicle on a
 * neighbouring parcel chained into neighbouring businesses in the audit.
 */
export function extendLot(
  vehicles: LonLat[],
  anchor: LonLat,
  lot: LonLat[],
  members: LonLat[][],
): LonLat[] {
  const points = vehicles.filter(
    (v) => metres(anchor, v) <= CASCADE_LIMITS.extendedReachM,
  );
  const inLot = new Set(lot.map((v) => v.join()));
  const extended: LonLat[] = [];
  for (const cluster of clusterIndices(
    points.map((p) => projectPoint(p, anchor)),
  )) {
    if (cluster.length < CASCADE_LIMITS.minLotVehicles) continue;
    const vs = cluster.map((i) => points[i]);
    const continues = vs.some((v) => inLot.has(v.join()));
    const onMembers =
      vs.filter((v) => members.some((ring) => contains(ring, v))).length >=
      CASCADE_LIMITS.minLotVehicles;
    if (continues || onMembers) extended.push(...vs);
  }
  // Lot vehicles outside the extended reach cannot exist; keep the lot whole.
  const seen = new Set(extended.map((v) => v.join()));
  return [...extended, ...lot.filter((v) => !seen.has(v.join()))];
}

/** Length of the minimum-area bounding rectangle, in metres. */
function boundingLengthM(xy: Array<[number, number]>): number {
  return boundingBox(xy).length;
}

/**
 * Minimum-area bounding rectangle: its long side and the direction of that
 * side in radians, folded into [0, π).
 */
function boundingBox(xy: Array<[number, number]>): {
  length: number;
  angle: number;
} {
  let bestArea = Infinity;
  let length = 0;
  let longAngle = 0;
  for (let i = 1; i < xy.length; i += 1) {
    const angle = Math.atan2(xy[i][1] - xy[i - 1][1], xy[i][0] - xy[i - 1][0]);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const [x, y] of xy) {
      const u = x * c + y * s;
      const v = -x * s + y * c;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const a = maxU - minU;
    const b = maxV - minV;
    if (a * b < bestArea) {
      bestArea = a * b;
      length = Math.max(a, b);
      const axis = a >= b ? angle : angle + Math.PI / 2;
      longAngle = ((axis % Math.PI) + Math.PI) % Math.PI;
    }
  }
  return { length, angle: longAngle };
}

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
function isForeignUse(parcel: ParcelFeature): boolean {
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

/** The same geometry without interior rings. */
export function withoutHoles(geometry: BoundaryGeometry): BoundaryGeometry {
  return geometry.type === "Polygon"
    ? { type: "Polygon", coordinates: [geometry.coordinates[0]] }
    : {
        type: "MultiPolygon",
        coordinates: geometry.coordinates.map((polygon) => [polygon[0]]),
      };
}

/** Mean of a ring's vertices; inside for the compact rings of buildings. */
function ringCentre(ring: LonLat[]): LonLat {
  const n = ring.length > 1 ? ring.length - 1 : ring.length;
  let lon = 0;
  let lat = 0;
  for (let i = 0; i < n; i += 1) {
    lon += ring[i][0];
    lat += ring[i][1];
  }
  return [lon / n, lat / n];
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

/** The building footprint that contains the point, if any. */
function anchorBuildingOf(input: CascadeInput): LonLat[] | undefined {
  return (input.buildings ?? []).find((ring) => contains(ring, input.anchor));
}

const boundsCache = new WeakMap<LonLat[], [number, number, number, number]>();

/** [minLon, minLat, maxLon, maxLat] of a ring, cached per ring. */
function ringBounds(ring: LonLat[]): [number, number, number, number] {
  const hit = boundsCache.get(ring);
  if (hit) return hit;
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of ring) {
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  }
  const bounds: [number, number, number, number] = [
    minLon,
    minLat,
    maxLon,
    maxLat,
  ];
  boundsCache.set(ring, bounds);
  return bounds;
}

function isAdjacent(
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

function anchorParcelOf(input: CascadeInput): ParcelFeature | undefined {
  return input.parcels.find((parcel) => contains(parcel.ring, input.anchor));
}

/** A point inside the ring: its centre, or the centre of an inner corner. */
function interiorPoint(ring: LonLat[]): LonLat {
  const centre = ringCentre(ring);
  if (contains(ring, centre)) return centre;
  for (let i = 0; i + 2 < ring.length; i += 1) {
    const corner: LonLat = [
      (ring[i][0] + ring[i + 1][0] + ring[i + 2][0]) / 3,
      (ring[i][1] + ring[i + 1][1] + ring[i + 2][1]) / 3,
    ];
    if (contains(ring, corner)) return corner;
  }
  return centre;
}

/**
 * The parcel that carries the dealership's address, when the parcel at the
 * point does not: a geocoded point often lands on the road, on a
 * neighbour's plot or at the wrong end of a long site. The point moves only
 * when it lies on no parcel, on a street, or on a parcel with another house
 * number and fewer than `minLotVehicles` vehicles. Null otherwise, and when
 * the address is unknown, the cadastre publishes none or no parcel within
 * `addressAnchorReachM` carries it.
 */
export function addressAnchor(
  input: CascadeInput,
): { anchor: LonLat; distanceM: number } | null {
  const keys = new Set(addressKeys(input.address));
  if (keys.size === 0) return null;
  const atPoint = anchorParcelOf(input);
  if (atPoint && streetByUse(atPoint) !== true) {
    // A parcel without a house number is left alone: the showroom often
    // stands on one, and the numbered plot is the owner's house behind it.
    // So is a parcel with another number that holds vehicles: a yard is
    // often registered under the neighbouring number. In both cases the
    // parcels with the address join as neighbours (stage 1).
    const numbered = addressKeys(atPoint.address).length > 0;
    const vehiclesHere = (input.vehicles ?? []).filter((v) =>
      contains(atPoint.ring, v),
    ).length;
    if (
      !numbered ||
      sharesAddress(keys, atPoint.address) ||
      vehiclesHere >= CASCADE_LIMITS.minLotVehicles
    ) {
      return null;
    }
  }
  const nearest = input.parcels
    .filter(
      (parcel) =>
        parcel.areaSqm <= CASCADE_LIMITS.maxParcelSqm &&
        streetByUse(parcel) !== true &&
        sharesAddress(keys, parcel.address),
    )
    .map((parcel) => ({
      parcel,
      distanceM: distanceToRingM(input.anchor, parcel.ring),
    }))
    .filter((c) => c.distanceM <= CASCADE_LIMITS.addressAnchorReachM)
    .sort((a, b) => a.distanceM - b.distanceM)[0];
  if (!nearest) return null;
  return {
    anchor: interiorPoint(nearest.parcel.ring),
    distanceM: nearest.distanceM,
  };
}

/**
 * `state` of parcels read from a rendered parcel map instead of a vector
 * service (bavaria-parcels.service.ts).
 */
const MAP_PARCEL_STATE = "Bayern";

function parcelResult(
  geometry: BoundaryGeometry,
  areaSqm: number,
  state: string,
  confidence: number,
  stage: CascadeStage,
  label: string,
  role: "operationalLot" | "parcel",
): BoundaryResult {
  return {
    source: "alkis",
    role,
    provider: stage === 1 ? "alkis-vehicle-parcels" : "alkis-parcel",
    polygon: geometry,
    areaSqm,
    confidence,
    label,
    evidence: {
      source:
        state === MAP_PARCEL_STATE
          ? "ALKIS-Parzellarkarte Bayern © Bayerische Vermessungsverwaltung (CC BY 4.0)"
          : `ALKIS (${state})`,
      retrievedAt: now(),
      method:
        stage === 1
          ? "cascade stage 1: cadastral parcels holding the vehicle lot"
          : "cascade stage 4: cadastral parcel containing the point",
      confidence,
      fallbackUsed: false,
      limitations:
        stage === 1
          ? [
              "Parcels follow legal lines; part of a parcel may belong to another use",
              "Vehicles hidden by trees or shadow are not seen",
              ...(state === MAP_PARCEL_STATE
                ? [
                    "Parcels read from the Bayern parcel map, good to about half a metre; a building can split or shift a plot",
                  ]
                : []),
            ]
          : [
              "No vehicles seen; a parcel is a legal unit, not the operational lot",
            ],
    },
  };
}

// --- Stage 1: parcels holding the vehicle lot -----------------------------

/**
 * The parcel at the point, grown over shared edges onto every adjacent parcel
 * on which at least `parcelMinVehicles` lot vehicles stand. Street-like
 * parcels never join, so a lot never jumps a road. Growth stops at
 * `boundaryMaxAreaSqm`.
 */
export function vehicleParcelStage(input: CascadeInput): StageOutcome {
  if (!input.vehicles) {
    return { result: null, reason: "no vehicle detection", alternatives: [] };
  }
  const anchor = anchorParcelOf(input);
  if (!anchor) {
    return {
      result: null,
      reason:
        input.parcels.length === 0
          ? "no cadastral parcels here"
          : "no cadastral parcel contains the point",
      alternatives: [],
    };
  }
  if (anchor.areaSqm > CASCADE_LIMITS.maxParcelSqm) {
    return {
      result: null,
      reason: `parcel at the point is ${Math.round(anchor.areaSqm)} m², too large for one lot`,
      alternatives: [],
    };
  }
  if (isFieldStrip(anchor, input.parcels)) {
    return {
      result: null,
      reason:
        "parcel at the point is a field strip; the cadastre does not outline the site here",
      alternatives: [],
    };
  }
  const buildings = input.buildings ?? [];
  const firstLot = vehicleLot(
    input.vehicles,
    input.anchor,
    anchor.ring,
    anchorBuildingOf(input),
  );
  if (firstLot.length === 0) {
    return {
      result: null,
      reason: "no vehicle lot at the point",
      alternatives: [],
    };
  }

  // Parcels that joined by the strip or enclosure rule: named in the trace,
  // and not counted towards the minimum lot area.
  // Mostly vegetation on the image: a meadow or a wood, whatever the
  // cadastre registers it as.
  const isGreen = (parcel: ParcelFeature): boolean =>
    (greenShare(parcel.ring, input.vegetationAt, buildings) ?? 0) >=
    CASCADE_LIMITS.greenParcelShare;
  const isForeign = (parcel: ParcelFeature): boolean =>
    isForeignUse(parcel) || isGreen(parcel);
  const joinedAs = new Map<
    ParcelFeature,
    "strip" | "enclosed" | "address" | "across"
  >();
  // Parcels across the street are chosen on the first lot (within
  // `maxReachM`) only; later passes reuse that choice, so the lot beyond
  // 80 m is judged on the same parts as before.
  let acrossChosen: Set<ParcelFeature> | null = null;
  const siteKeys = new Set([
    ...addressKeys(anchor.address),
    ...addressKeys(input.address),
  ]);
  const grow = (
    lot: LonLat[],
    seed: ParcelFeature = anchor,
  ): ParcelFeature[] => {
    const vehiclesOn = (parcel: ParcelFeature): number =>
      lot.filter((v) => contains(parcel.ring, v)).length;
    const minVehicles = Math.max(
      CASCADE_LIMITS.minLotVehicles,
      Math.min(
        CASCADE_LIMITS.parcelMinVehicles,
        Math.ceil(CASCADE_LIMITS.parcelMinLotShare * lot.length),
      ),
    );
    // "grow": the parcel joins and the lot may grow on from it; "leaf": it
    // joins, but nothing grows from it (a strip could lead along a road).
    const joins = (parcel: ParcelFeature): "grow" | "leaf" | null => {
      if (parcel.areaSqm > CASCADE_LIMITS.maxParcelSqm) return null;
      const count = vehiclesOn(parcel);
      if (count < CASCADE_LIMITS.minLotVehicles) return null;
      const unbuilt = unbuiltAreaSqm(parcel, buildings);
      const density = (count / unbuilt) * 1000;
      const byUse = streetByUse(parcel);
      // A road by land use never joins, however many cars park on it.
      if (byUse === true) return null;
      if (byUse === null && isStreetLike(parcel.ring)) {
        // Field strips too: a strip full of cars is part of the yard. Its
        // density counts the whole strip; a building on it is no parking.
        return isShortStrip(parcel.ring) &&
          (count / parcel.areaSqm) * 1000 >=
            CASCADE_LIMITS.stripMinVehiclesPer1000Sqm
          ? "leaf"
          : null;
      }
      const minDensity =
        unbuilt > CASCADE_LIMITS.largeUnbuiltSqm
          ? CASCADE_LIMITS.parcelMinVehiclesPer1000SqmLarge
          : CASCADE_LIMITS.parcelMinVehiclesPer1000Sqm;
      return (count >= minVehicles &&
        density >= minDensity &&
        !isForeign(parcel)) ||
        (count >= CASCADE_LIMITS.parcelDenseMinVehicles &&
          density >= CASCADE_LIMITS.parcelDenseVehiclesPer1000Sqm)
        ? "grow"
        : null;
    };
    const members: ParcelFeature[] = [seed];
    let areaSqm = seed.areaSqm;
    const fits = (parcel: ParcelFeature): boolean =>
      areaSqm + parcel.areaSqm <= input.parameters.boundaryMaxAreaSqm;
    const queue = [seed];
    const touching = (a: ParcelFeature, b: ParcelFeature): boolean =>
      isAdjacent(a, b) || isAdjacent(b, a);
    // A second part of the lot across the street: a dense car lot, or a plot
    // with the dealership's address, directly across a street parcel the lot
    // borders. Only for the lot at the point, once.
    const acrossTheStreet = (): ParcelFeature[] => {
      const streets = input.parcels.filter(
        (parcel) =>
          !members.includes(parcel) &&
          isStreetParcel(parcel) &&
          members.some((member) => touching(parcel, member)),
      );
      if (streets.length === 0) return [];
      const found: ParcelFeature[] = [];
      for (const parcel of input.parcels) {
        if (members.includes(parcel) || streets.includes(parcel)) continue;
        if (parcel.areaSqm > CASCADE_LIMITS.maxParcelSqm) continue;
        if (
          streetByUse(parcel) === true ||
          (streetByUse(parcel) === null && isStreetLike(parcel.ring)) ||
          isForeign(parcel) ||
          !fits(parcel)
        )
          continue;
        if (!streets.some((street) => touching(parcel, street))) continue;
        if (members.some((member) => touching(parcel, member))) continue;
        const count = vehiclesOn(parcel);
        const density = (count / unbuiltAreaSqm(parcel, buildings)) * 1000;
        const dense =
          count >= CASCADE_LIMITS.acrossMinVehicles &&
          density >= CASCADE_LIMITS.acrossMinVehiclesPer1000Sqm;
        const ours =
          count >= CASCADE_LIMITS.minLotVehicles &&
          sharesAddress(siteKeys, parcel.address);
        if (dense || ours) found.push(parcel);
      }
      return found;
    };
    const across = (): ParcelFeature[] => {
      if (acrossChosen)
        return [...acrossChosen].filter(
          (parcel) => !members.includes(parcel) && fits(parcel),
        );
      acrossChosen = new Set(acrossTheStreet());
      return [...acrossChosen];
    };
    let crossed = seed !== anchor;
    for (;;) {
      while (queue.length > 0) {
        const current = queue.shift()!;
        for (const parcel of input.parcels) {
          if (members.includes(parcel) || !isAdjacent(parcel, current))
            continue;
          // A neighbouring parcel with the address of the parcel at the point
          // (or of the dealership) is the same property, cars on it or not.
          const sameAddress =
            parcel.areaSqm <= CASCADE_LIMITS.maxParcelSqm &&
            // Not a large plot that exceeds everything chosen so far: an
            // estate or a retail park registered under one address.
            parcel.areaSqm <=
              Math.max(areaSqm, CASCADE_LIMITS.addressJoinFreeSqm) &&
            // Not the owner's house or a field behind the yard.
            !isForeignUse(parcel) &&
            streetByUse(parcel) !== true &&
            !isGreen(parcel) &&
            sharesAddress(siteKeys, parcel.address);
          const kind = sameAddress ? "grow" : joins(parcel);
          if (!kind || !fits(parcel)) continue;
          members.push(parcel);
          areaSqm += parcel.areaSqm;
          if (kind === "grow") queue.push(parcel);
          else joinedAs.set(parcel, "strip");
          if (sameAddress && !joins(parcel)) joinedAs.set(parcel, "address");
        }
      }
      if (crossed) break;
      crossed = true;
      for (const parcel of across()) {
        if (!fits(parcel)) continue;
        members.push(parcel);
        areaSqm += parcel.areaSqm;
        joinedAs.set(parcel, "across");
        // The lot may continue from there by the usual rules.
        queue.push(parcel);
      }
      if (queue.length === 0) break;
    }
    // Parcels the lot encloses join whatever stands on them, so the result
    // has no notches or holes where the cadastre cuts out a small plot.
    for (let added = true; added;) {
      added = false;
      for (const parcel of input.parcels) {
        if (members.includes(parcel)) continue;
        if (
          parcel.areaSqm > CASCADE_LIMITS.enclosedMaxShareOfLot * areaSqm ||
          !fits(parcel) ||
          streetByUse(parcel) === true ||
          (streetByUse(parcel) === null &&
            isStreetLike(parcel.ring) &&
            !isShortStrip(parcel.ring)) ||
          (parcel.areaSqm > CASCADE_LIMITS.enclosedForeignMaxSqm &&
            (isGreen(parcel) ||
              (isForeignUse(parcel) &&
                !sharesAddress(siteKeys, parcel.address)))) ||
          !members.some((member) => isAdjacent(parcel, member))
        ) {
          continue;
        }
        if (
          borderShare(
            parcel,
            members.map((member) => member.ring),
          ) < CASCADE_LIMITS.enclosedMinShare
        ) {
          continue;
        }
        members.push(parcel);
        areaSqm += parcel.areaSqm;
        added = true;
        joinedAs.set(parcel, "enclosed");
      }
    }
    return members;
  };

  const build = (
    lot: LonLat[],
    members: ParcelFeature[],
  ): { areaSqm: number; result: BoundaryResult; reason: string } | null => {
    const union = unionRings(members.map((parcel) => parcel.ring));
    if (!union) return null;
    // Gaps between parcels the lot surrounds (slivers, a plot left out for
    // its size) are part of the site.
    const whole = withoutHoles(union);
    const trimmed = trimVegetation(whole, input, lot);
    const geometry = trimmed?.geometry ?? whole;
    const areaSqm = geometryAreaSqm(geometry);
    const covered = lot.filter((v) => geometryContains(geometry, v)).length;
    const coverage = covered / lot.length;
    const acrossJoined = members.some((m) => joinedAs.get(m) === "across");
    // A part across the street is the rule's guess, not the cadastre's: the
    // result keeps the partial confidence, so it is offered for review.
    const confidence =
      coverage >= CASCADE_LIMITS.goodCoverage && !acrossJoined
        ? CASCADE_CONFIDENCE.vehicleParcels
        : CASCADE_CONFIDENCE.vehicleParcelsPartial;
    const joined = members.length - 1;
    const strips = members.filter((m) => joinedAs.get(m) === "strip").length;
    const enclosed = members.filter(
      (m) => joinedAs.get(m) === "enclosed",
    ).length;
    const byAddress = members.filter(
      (m) => joinedAs.get(m) === "address",
    ).length;
    const across = members.filter((m) => joinedAs.get(m) === "across").length;
    const detail = [
      ...(byAddress > 0 ? [`${byAddress} by address`] : []),
      ...(across > 0 ? [`${across} across the street`] : []),
      ...(strips > 0 ? [`${strips} parking strip(s)`] : []),
      ...(enclosed > 0 ? [`${enclosed} enclosed`] : []),
    ].join(", ");
    return {
      areaSqm,
      result: parcelResult(
        geometry,
        areaSqm,
        anchor.state,
        confidence,
        1,
        joined > 0 ? `ALKIS parcel + ${joined} with vehicles` : "ALKIS parcel",
        "operationalLot",
      ),
      reason:
        `parcel at the point${joined > 0 ? ` + ${joined} adjacent parcel(s)${detail ? ` (${detail})` : ""}` : ""} hold ${covered} of ${lot.length} lot vehicles (${Math.round(coverage * 100)}%)` +
        (trimmed
          ? `; ${Math.round(trimmed.removedSqm)} m² of vegetation without vehicles trimmed off`
          : ""),
    };
  };

  const firstMembers = grow(firstLot);
  const first = build(firstLot, firstMembers);
  if (!first) {
    return { result: null, reason: "parcel union failed", alternatives: [] };
  }
  // Area held by the parcel at the point and the parcels its vehicles grew
  // onto; strips and enclosed plots only complete such a lot.
  const grownSqm = firstMembers
    .filter(
      (parcel) =>
        !joinedAs.has(parcel) ||
        joinedAs.get(parcel) === "address" ||
        joinedAs.get(parcel) === "across",
    )
    .reduce((sum, parcel) => sum + parcel.areaSqm, 0);
  if (grownSqm < CASCADE_LIMITS.minLotSqm) {
    // A sliver at the point (a 128 m² town-centre plot in the 50-site run)
    // with nothing joined is not a lot; the vehicle outline does better. A
    // parking strip beside it does not make it one either.
    return {
      result: null,
      reason: `parcel at the point is ${Math.round(anchor.areaSqm)} m² and no parcel with vehicles joined, too small for a lot`,
      alternatives: [],
    };
  }
  const offLot = anchorOffLot(
    input,
    anchor,
    firstLot,
    first.result,
    grow,
    build,
  );
  // Second pass: rows cut off at `maxReachM`, and vehicles on parcels the lot
  // already holds, continue the lot up to `extendedReachM`.
  const lot = extendLot(
    input.vehicles,
    input.anchor,
    firstLot,
    firstMembers.map((parcel) => parcel.ring),
  );
  const extendedMembers = lot.length > firstLot.length ? grow(lot) : null;
  const extended =
    extendedMembers && extendedMembers.length > firstMembers.length
      ? build(lot, extendedMembers)
      : null;
  if (!extended) {
    return {
      ...first,
      reason: first.reason + offLot.note,
      alternatives: offLot.alternatives,
      lotVehicles: firstLot.length,
      flags: offLot.flags,
    };
  }
  const added = extended.areaSqm / first.areaSqm - 1;
  const note = `lot continued beyond ${CASCADE_LIMITS.maxReachM} m by ${lot.length - firstLot.length} vehicles adds ${Math.round(added * 100)}% area`;
  if (added <= CASCADE_LIMITS.maxExtensionShare) {
    return {
      result: extended.result,
      reason: `${extended.reason}; ${note}${offLot.note}`,
      alternatives: offLot.alternatives,
      lotVehicles: lot.length,
      flags: offLot.flags,
    };
  }
  return {
    result: first.result,
    reason: `${first.reason}; ${note}, offered as an alternative${offLot.note}`,
    alternatives: [
      {
        ...extended.result,
        label: `${extended.result.label ?? "ALKIS parcels"} (lot beyond ${CASCADE_LIMITS.maxReachM} m)`,
      },
      ...offLot.alternatives,
    ],
    lotVehicles: firstLot.length,
    flags: offLot.flags,
  };
}

/**
 * Whether the point lies off the vehicle lot: the parcel at the point holds
 * less than `anchorOffLotShare`, and the chosen parcels less than
 * `anchorOffLotResultShare`, of the lot vehicles that are not on a street
 * (kerbside cars say nothing about which plot is the dealer's). The point is
 * then often on a neighbouring plot or in the wrong building; the result is
 * kept, flagged `anchorOffLot`, and the parcels around the parcel holding
 * most of the lot are offered as an alternative.
 */
function anchorOffLot(
  input: CascadeInput,
  anchor: ParcelFeature,
  lot: LonLat[],
  result: BoundaryResult,
  grow: (lot: LonLat[], seed?: ParcelFeature) => ParcelFeature[],
  build: (
    lot: LonLat[],
    members: ParcelFeature[],
  ) => { areaSqm: number; result: BoundaryResult; reason: string } | null,
): {
  flags: BoundaryReviewFlag[];
  alternatives: BoundaryResult[];
  note: string;
} {
  const none = { flags: [], alternatives: [], note: "" };
  const streets = streetParcels(input.parcels);
  const offStreet = lot.filter(
    (v) => ![...streets].some((street) => contains(street.ring, v)),
  );
  if (offStreet.length < CASCADE_LIMITS.minLotVehicles) return none;
  const onAnchor = offStreet.filter((v) => contains(anchor.ring, v)).length;
  const onResult = offStreet.filter((v) =>
    geometryContains(result.polygon, v),
  ).length;
  if (
    onAnchor / offStreet.length >= CASCADE_LIMITS.anchorOffLotShare ||
    onResult / offStreet.length >= CASCADE_LIMITS.anchorOffLotResultShare
  ) {
    return none;
  }
  const note = `; the point lies off the lot (its parcel holds ${onAnchor} of ${offStreet.length} lot vehicles off the street)`;
  const seed = input.parcels
    .filter(
      (parcel) =>
        parcel !== anchor &&
        parcel.areaSqm <= CASCADE_LIMITS.maxParcelSqm &&
        !isStreetParcel(parcel),
    )
    .map((parcel) => ({
      parcel,
      count: offStreet.filter((v) => contains(parcel.ring, v)).length,
    }))
    .sort((a, b) => b.count - a.count)[0];
  const alternative =
    seed && seed.count >= CASCADE_LIMITS.minLotVehicles
      ? build(lot, grow(lot, seed.parcel))
      : null;
  return {
    flags: ["anchorOffLot"],
    alternatives: alternative
      ? [
          {
            ...alternative.result,
            label: "ALKIS parcels holding the vehicle lot",
          },
        ]
      : [],
    note,
  };
}

/**
 * The parcel union without the planted areas at its edge: vegetation on the
 * aerial image that forms a patch of at least `trimMinSqm`, survives an
 * opening of `trimOpenM` (rows of trees and planted islands do not), touches
 * the outside of the union and has no detected vehicle within
 * `trimVehicleClearM`. Parcels follow legal lines; the wood or meadow that
 * belongs to the plot is not where the stock stands. Null when nothing is
 * trimmed or the image is unknown.
 */
/** Closing radius (cells) applied to the vegetation before the opening. */
const TRIM_CLOSE_CELLS = 2;

export function trimVegetation(
  geometry: BoundaryGeometry,
  input: CascadeInput,
  lot: LonLat[],
): { geometry: BoundaryGeometry; removedSqm: number } | null {
  const { vegetationAt } = input;
  if (!vegetationAt) return null;
  const rings = outerRings(geometry) as LonLat[][];
  let reachM = 0;
  for (const ring of rings) {
    for (const point of ring) {
      reachM = Math.max(reachM, metres(input.anchor, point));
    }
  }
  if (reachM > 400) return null;
  const spec = createGridSpec(input.anchor, 1, 2 * (reachM + 6));
  const inside = new Uint8Array(cellCount(spec));
  for (const ring of rings) {
    const cells = new Uint8Array(inside.length);
    rasterizeMaskPolygon(spec, ring, cells);
    for (let i = 0; i < cells.length; i += 1) if (cells[i]) inside[i] = 1;
  }
  // A dark roof can pass the colour test; a building is never trimmed.
  const roof = new Uint8Array(inside.length);
  for (const ring of input.buildings ?? []) {
    rasterizeMaskPolygon(spec, ring, roof);
  }
  const green = new Uint8Array(inside.length);
  let insideCount = 0;
  let greenCount = 0;
  for (let i = 0; i < inside.length; i += 1) {
    if (!inside[i]) continue;
    insideCount += 1;
    if (roof[i]) continue;
    const col = i % spec.cols;
    const row = Math.floor(i / spec.cols);
    if (vegetationAt(cellToLonLat(spec, col, row)) === true) {
      green[i] = 1;
      greenCount += 1;
    }
  }
  if (greenCount < CASCADE_LIMITS.trimMinSqm) return null;
  const open = CASCADE_LIMITS.trimOpenM;
  // Close the gaps shadows leave in a meadow first, then open.
  const closed = erode(
    spec,
    dilate(spec, green, TRIM_CLOSE_CELLS),
    TRIM_CLOSE_CELLS,
  );
  const opened = dilate(spec, erode(spec, closed, open), open);
  const stamp = new Float32Array(inside.length);
  for (const vehicle of input.vehicles ?? []) {
    rasterizeDisk(spec, vehicle, CASCADE_LIMITS.trimVehicleClearM, stamp, 1);
  }
  const removable = new Uint8Array(inside.length);
  for (let i = 0; i < inside.length; i += 1) {
    if (opened[i] && inside[i] && !roof[i] && stamp[i] === 0) {
      removable[i] = 1;
    }
  }
  let removed = 0;
  const kept = Uint8Array.from(inside);
  for (const patch of components(spec, removable)) {
    let size = 0;
    let atEdge = false;
    for (let i = 0; i < patch.length; i += 1) {
      if (!patch[i]) continue;
      size += 1;
      if (atEdge) continue;
      const col = i % spec.cols;
      const row = Math.floor(i / spec.cols);
      atEdge =
        col === 0 ||
        row === 0 ||
        col === spec.cols - 1 ||
        row === spec.rows - 1 ||
        !inside[i - 1] ||
        !inside[i + 1] ||
        !inside[i - spec.cols] ||
        !inside[i + spec.cols];
    }
    if (!atEdge || size < CASCADE_LIMITS.trimMinSqm) continue;
    for (let i = 0; i < patch.length; i += 1) if (patch[i]) kept[i] = 0;
    removed += size;
  }
  if (removed === 0) return null;
  // What a removed patch cut off stays only where the point or lot
  // vehicles are.
  const anchorRef = lonLatToCell(spec, input.anchor);
  const anchorCell = anchorRef
    ? cellIndex(spec, anchorRef.col, anchorRef.row)
    : -1;
  const lotCells = lot.flatMap((vehicle) => {
    const cell = lonLatToCell(spec, vehicle);
    return cell ? [cellIndex(spec, cell.col, cell.row)] : [];
  });
  const parts = components(spec, kept).filter(
    (part) =>
      (anchorCell >= 0 && part[anchorCell] === 1) ||
      lotCells.filter((index) => part[index]).length >=
        CASCADE_LIMITS.minLotVehicles,
  );
  if (parts.length === 0) return null;
  for (const part of parts) fillHoles(spec, part);
  const outline = masksToGeometry(spec, parts, {
    simplifyToleranceM: 1.5,
    regularizeAngleToleranceDeg: 0,
  });
  if (!outline) return null;
  const areaSqm = geometryAreaSqm(outline.geometry);
  if (areaSqm < CASCADE_LIMITS.minLotSqm) return null;
  return { geometry: outline.geometry, removedSqm: insideCount - areaSqm };
}

// --- Stage 2: outline of the vehicle lot ----------------------------------

const OUTLINE_CELL_M = 1;
/** Closing radius (cells) that joins an added building to the outline. */
const HULL_JOIN_CELLS = 6;

/** 4-connected components of a mask, one mask per component. */
function components(spec: GridSpec, mask: Uint8Array): Uint8Array[] {
  const label = new Int32Array(mask.length);
  const result: Uint8Array[] = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || label[start]) continue;
    const component = new Uint8Array(mask.length);
    const stack = [start];
    label[start] = result.length + 1;
    while (stack.length > 0) {
      const index = stack.pop()!;
      component[index] = 1;
      const col = index % spec.cols;
      const row = Math.floor(index / spec.cols);
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const c = col + dc;
        const r = row + dr;
        if (c < 0 || r < 0 || c >= spec.cols || r >= spec.rows) continue;
        const next = cellIndex(spec, c, r);
        if (mask[next] && !label[next]) {
          label[next] = result.length + 1;
          stack.push(next);
        }
      }
    }
    result.push(component);
  }
  return result;
}

/**
 * Outline of the vehicle lot: every vehicle stamped as a disk of `hullCloseM`,
 * then shrunk by `hullCloseM − hullMarginM`. That is a morphological closing:
 * aisles and empty bays between rows are filled, the outline follows an
 * L-shaped lot instead of cutting its corner, and it ends `hullMarginM`
 * beyond the outermost vehicles. The outline is squared up along the lot's
 * own axis.
 */
export function vehicleHullStage(input: CascadeInput): StageOutcome {
  if (!input.vehicles) {
    return { result: null, reason: "no vehicle detection", alternatives: [] };
  }
  const lot = vehicleLot(
    input.vehicles,
    input.anchor,
    anchorParcelOf(input)?.ring,
    anchorBuildingOf(input),
  );
  if (lot.length === 0) {
    return {
      result: null,
      reason: "no vehicle lot at the point",
      alternatives: [],
    };
  }
  if (lot.length < CASCADE_LIMITS.hullMinVehicles) {
    return {
      result: null,
      reason: `only ${lot.length} vehicles at the point, too few to outline a lot`,
      alternatives: [],
    };
  }
  const { hullCloseM, hullMarginM, maxReachM } = CASCADE_LIMITS;
  const spec = createGridSpec(
    input.anchor,
    OUTLINE_CELL_M,
    2 * (maxReachM + hullCloseM + 2),
  );
  const stamp = new Float32Array(cellCount(spec));
  for (const vehicle of lot) {
    rasterizeDisk(spec, vehicle, hullCloseM, stamp, 1);
  }
  const mask = erode(
    spec,
    Uint8Array.from(stamp, (value) => (value > 0 ? 1 : 0)),
    // +1: the stamped disks reach half a cell beyond their radius on each side.
    // −1: a stamped disk covers every cell whose centre lies inside it, so it
    // reaches about one cell further than its radius.
    Math.round((hullCloseM - hullMarginM) / OUTLINE_CELL_M) - 1,
  );
  completeOutline(spec, mask, stamp, input);
  // Parts without lot vehicles are what is left beyond a removed street;
  // the part holding the point (its building) always stays.
  const lotCells = lot.flatMap((vehicle) => {
    const cell = lonLatToCell(spec, vehicle);
    return cell ? [cellIndex(spec, cell.col, cell.row)] : [];
  });
  const anchorRef = lonLatToCell(spec, input.anchor);
  const anchorCell = anchorRef
    ? cellIndex(spec, anchorRef.col, anchorRef.row)
    : -1;
  const outline = masksToGeometry(
    spec,
    components(spec, mask).filter(
      (component) =>
        (anchorCell >= 0 && component[anchorCell] === 1) ||
        lotCells.filter((index) => component[index]).length >=
          CASCADE_LIMITS.minLotVehicles,
    ),
    { simplifyToleranceM: 1 },
  );
  const maxArea = input.parameters.boundaryMaxAreaSqm;
  const areaSqm = outline ? geometryAreaSqm(outline.geometry) : 0;
  if (
    !outline ||
    areaSqm < CASCADE_LIMITS.minHullSqm ||
    areaSqm > maxArea ||
    !outerRings(outline.geometry).every((ring) =>
      validRing(ring as LonLat[], maxArea),
    )
  ) {
    return {
      result: null,
      reason: `vehicle lot outline is ${Math.round(areaSqm)} m², outside the plausible range`,
      alternatives: [],
    };
  }
  const confidence = CASCADE_CONFIDENCE.vehicleHull;
  return {
    result: {
      source: "aerial",
      role: "operationalLot",
      provider: "vehicle-hull",
      polygon: outline.geometry,
      areaSqm,
      confidence,
      label: `Vehicle lot (${lot.length})`,
      evidence: {
        source: "Aerial imagery / vehicle detection",
        retrievedAt: now(),
        method: "cascade stage 2: outline of the detected vehicle lot",
        confidence,
        fallbackUsed: false,
        limitations: [
          "Outline of the vehicles seen, not a surveyed boundary",
          (input.buildings ?? []).length > 0
            ? "Buildings are included only where the vehicles surround them; empty yards are not"
            : "No building footprints here: showroom, workshop and empty areas without vehicles are not included",
        ],
      },
    },
    reason: `outline of ${lot.length} lot vehicles`,
    alternatives: [],
    lotVehicles: lot.length,
  };
}

/**
 * Completes the vehicle outline in place:
 *
 * - adds every building of which at least `hullBuildingShare` lies within
 *   `hullCloseM` of the lot vehicles (the showroom the rows stand around);
 * - fills holes (a courtyard or building the outline encloses);
 * - removes street-like parcels, so cars parked along the kerb do not carry
 *   the outline into the road.
 */
function completeOutline(
  spec: GridSpec,
  mask: Uint8Array,
  stamp: Float32Array,
  input: CascadeInput,
): void {
  let added = false;
  // The building the point lies in is the dealership's as a rule (the point
  // is its address or POI), so it belongs to the outline even where the lot
  // stands on one side only. Without cadastre (Bayern) it is the only
  // evidence of the showroom.
  const atPoint = anchorBuildingOf(input);
  const complex = atPoint
    ? buildingComplex(atPoint, input.buildings ?? [])
    : [];
  const complexArea = complex.reduce((sum, ring) => sum + ringAreaSqm(ring), 0);
  if (complex.length > 0 && complexArea <= CASCADE_LIMITS.maxParcelSqm) {
    for (const ring of complex) {
      const cells = new Uint8Array(mask.length);
      if (rasterizeMaskPolygon(spec, ring, cells) === 0) continue;
      for (let i = 0; i < cells.length; i += 1) if (cells[i]) mask[i] = 1;
      added = true;
    }
  }
  for (const ring of input.buildings ?? []) {
    if (complex.includes(ring)) continue;
    if (ringAreaSqm(ring) > CASCADE_LIMITS.hullBuildingMaxSqm) continue;
    const cells = new Uint8Array(mask.length);
    if (rasterizeMaskPolygon(spec, ring, cells) === 0) continue;
    // Share of the footprint, and of its outline, within reach of the lot:
    // a large showroom the rows stand around is near along its walls only.
    let total = 0;
    let near = 0;
    let edge = 0;
    let edgeNear = 0;
    for (let i = 0; i < cells.length; i += 1) {
      if (!cells[i]) continue;
      total += 1;
      if (stamp[i] > 0) near += 1;
      const col = i % spec.cols;
      const row = Math.floor(i / spec.cols);
      const onEdge =
        col === 0 ||
        row === 0 ||
        col === spec.cols - 1 ||
        row === spec.rows - 1 ||
        !cells[i - 1] ||
        !cells[i + 1] ||
        !cells[i - spec.cols] ||
        !cells[i + spec.cols];
      if (!onEdge) continue;
      edge += 1;
      if (stamp[i] > 0) edgeNear += 1;
    }
    if (
      Math.max(near / total, edgeNear / edge) < CASCADE_LIMITS.hullBuildingShare
    ) {
      continue;
    }
    for (let i = 0; i < cells.length; i += 1) if (cells[i]) mask[i] = 1;
    added = true;
  }
  if (added) {
    // A building can sit a few metres off the outline (a footpath, a kerb);
    // a small closing joins it instead of leaving a separate part.
    mask.set(erode(spec, dilate(spec, mask, HULL_JOIN_CELLS), HULL_JOIN_CELLS));
  }
  fillHoles(spec, mask);
  if (input.isStreetAt) {
    for (let i = 0; i < mask.length; i += 1) {
      if (!mask[i]) continue;
      const col = i % spec.cols;
      const row = Math.floor(i / spec.cols);
      if (input.isStreetAt(cellToLonLat(spec, col, row))) mask[i] = 0;
    }
  }
  const streets = streetParcels(input.parcels);
  for (const parcel of input.parcels) {
    if (!streets.has(parcel)) continue;
    const cells = new Uint8Array(mask.length);
    rasterizeMaskPolygon(spec, parcel.ring, cells);
    for (let i = 0; i < cells.length; i += 1) if (cells[i]) mask[i] = 0;
  }
}

/**
 * The building at the point and every building attached to it (wall to
 * wall, within `BUILDING_ATTACHED_M`): official models split a showroom,
 * workshop and annex into separate buildings of one complex.
 */
function buildingComplex(seed: LonLat[], buildings: LonLat[][]): LonLat[][] {
  const complex = [seed];
  const queue = [seed];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const ring of buildings) {
      if (complex.includes(ring)) continue;
      const touches =
        ring.some((p) => distanceToRingM(p, current) <= BUILDING_ATTACHED_M) ||
        current.some((p) => distanceToRingM(p, ring) <= BUILDING_ATTACHED_M);
      if (!touches) continue;
      complex.push(ring);
      queue.push(ring);
    }
  }
  return complex;
}

/** Buildings closer than this count as attached (shared or touching walls). */
const BUILDING_ATTACHED_M = 1;

/** Sets every empty cell not connected to the grid edge (a hole). */
function fillHoles(spec: GridSpec, mask: Uint8Array): void {
  const outside = new Uint8Array(mask.length);
  const stack: number[] = [];
  const push = (col: number, row: number): void => {
    const index = cellIndex(spec, col, row);
    if (mask[index] || outside[index]) return;
    outside[index] = 1;
    stack.push(index);
  };
  for (let col = 0; col < spec.cols; col += 1) {
    push(col, 0);
    push(col, spec.rows - 1);
  }
  for (let row = 0; row < spec.rows; row += 1) {
    push(0, row);
    push(spec.cols - 1, row);
  }
  while (stack.length > 0) {
    const index = stack.pop()!;
    const col = index % spec.cols;
    const row = Math.floor(index / spec.cols);
    if (col > 0) push(col - 1, row);
    if (col < spec.cols - 1) push(col + 1, row);
    if (row > 0) push(col, row - 1);
    if (row < spec.rows - 1) push(col, row + 1);
  }
  for (let i = 0; i < mask.length; i += 1) if (!outside[i]) mask[i] = 1;
}

// --- Stage 3: OSM car-dealer area (cached only) ----------------------------

/**
 * An OSM area tagged as a car dealer that contains the point, or that carries
 * the dealership's name or address and lies within
 * `boundaryNearPointDistanceM` of it. A dealer tag on a building is a
 * showroom footprint, not the lot, and is ignored.
 */
export function osmDealerStage(input: CascadeInput): StageOutcome {
  if (!input.osm) {
    return { result: null, reason: "OSM not cached", alternatives: [] };
  }
  const maxArea = input.parameters.boundaryMaxAreaSqm;
  const nearM = input.parameters.boundaryNearPointDistanceM;
  const best = input.osm.areas
    .filter((area) => area.kind === "dealerArea" && !area.tags.building)
    .map((area) => ({
      area,
      areaSqm: ringAreaSqm(area.ring),
      distance: distanceM(area.ring, input.anchor),
      identity: matchesSite(area.tags, input.name, input.address),
    }))
    .filter(
      (c) =>
        c.areaSqm >= CASCADE_LIMITS.minLotSqm &&
        c.areaSqm <= maxArea &&
        validRing(c.area.ring, maxArea) &&
        (c.distance === 0 || (c.identity && c.distance <= nearM)),
    )
    // Identity first, then containment, then the more specific (smaller) area.
    .sort(
      (a, b) =>
        Number(b.identity) - Number(a.identity) ||
        a.distance - b.distance ||
        a.areaSqm - b.areaSqm,
    )[0];
  if (!best) {
    return {
      result: null,
      reason: "no OSM dealer area at the point",
      alternatives: [],
    };
  }
  const inside = best.distance === 0;
  const namedOtherwise =
    !best.identity && Boolean(best.area.tags.name) && Boolean(input.name);
  const confidence = best.identity
    ? inside
      ? CASCADE_CONFIDENCE.dealerMatchedInside
      : CASCADE_CONFIDENCE.dealerMatchedNear
    : namedOtherwise
      ? CASCADE_CONFIDENCE.dealerNamedOtherwise
      : CASCADE_CONFIDENCE.dealerInside;
  return {
    result: {
      source: "osm",
      role: "operationalLot",
      provider: "osm-dealer-area",
      polygon: { type: "Polygon", coordinates: [best.area.ring] },
      areaSqm: best.areaSqm,
      confidence,
      ...(best.area.tags.name ? { label: best.area.tags.name } : {}),
      evidence: {
        source: "OpenStreetMap / Overpass",
        retrievedAt: now(),
        method: "cascade stage 3: car-dealer area at the point",
        confidence,
        fallbackUsed: false,
        limitations: [
          "Drawn by OSM mappers; completeness varies by region",
          ...(namedOtherwise
            ? ["Area is named differently from the dealership"]
            : []),
        ],
      },
    },
    reason: best.identity
      ? `OSM dealer area matches name/address${inside ? " and contains the point" : `, ${Math.round(best.distance)} m from the point`}`
      : namedOtherwise
        ? `OSM dealer area contains the point but is named "${best.area.tags.name}"`
        : "OSM dealer area contains the point",
    alternatives: [],
  };
}

// --- Stage 4: the parcel at the point ---------------------------------------

/** The parcel containing the point, between `minLotSqm` and `maxParcelSqm`. */
export function parcelStage(input: CascadeInput): StageOutcome {
  const anchor = anchorParcelOf(input);
  if (!anchor) {
    return {
      result: null,
      reason:
        input.parcels.length === 0
          ? "no cadastral parcels here"
          : "no cadastral parcel contains the point",
      alternatives: [],
    };
  }
  if (
    anchor.areaSqm < CASCADE_LIMITS.minLotSqm ||
    anchor.areaSqm > CASCADE_LIMITS.maxParcelSqm
  ) {
    return {
      result: null,
      reason: `parcel at the point is ${Math.round(anchor.areaSqm)} m², outside the plausible range`,
      alternatives: [],
    };
  }
  return {
    result: parcelResult(
      { type: "Polygon", coordinates: [anchor.ring] },
      anchor.areaSqm,
      anchor.state,
      CASCADE_CONFIDENCE.parcel,
      4,
      "ALKIS parcel",
      "parcel",
    ),
    reason: "cadastral parcel contains the point",
    alternatives: [],
  };
}

// --- Point plausibility (v11) -------------------------------------------

/** Limits of the off-site test. See docs/boundary-model.md, "Cascade v11". */
export const POINT_SITE_LIMITS = {
  /** A building this close to the point may be the showroom. */
  buildingM: 50,
  /** Radius of the disc around the point whose vegetation is measured. */
  discM: 60,
  /** This many vehicles within `discM` are some kind of site. */
  maxVehicles: 3,
  /** Share of the disc that is vegetation on the image for "woodland". */
  greenShare: 0.75,
  /** Share of the parcel the cadastre lists as open land (farm, wood, water). */
  openShare: 0.8,
  /** The nearest vehicle lot is looked for this far from the point. */
  nearestLotM: 250,
  /** Confidence cap for a lot found away from an off-site point. */
  movedConfidence: 0.3,
} as const;

/** Octagon of `radiusM` around a point, closed. */
function discRing(center: LonLat, radiusM: number): LonLat[] {
  const dLat = radiusM / 111_320;
  const dLon = dLat / Math.max(0.1, Math.cos((center[1] * Math.PI) / 180));
  const ring: LonLat[] = [];
  for (let i = 0; i <= 8; i += 1) {
    const a = (i / 8) * 2 * Math.PI;
    ring.push([center[0] + dLon * Math.cos(a), center[1] + dLat * Math.sin(a)]);
  }
  return ring;
}

/**
 * Whether the point can be on a dealership at all. Off the site means: no
 * building within `buildingM`, hardly any vehicles around, and the ground is
 * woodland or open land — by the aerial image (vegetation share of the disc
 * around the point) or by the cadastre (open-land share of its parcel).
 * Null when neither source says anything about the ground.
 */
export function pointSiteCheck(
  input: CascadeInput,
): { offSite: boolean; reason: string } | null {
  const { anchor } = input;
  const building = (input.buildings ?? []).some(
    (ring) =>
      contains(ring, anchor) ||
      distanceToRingM(anchor, ring) <= POINT_SITE_LIMITS.buildingM,
  );
  if (building) {
    return { offSite: false, reason: "a building is near the point" };
  }
  const nearVehicles = (input.vehicles ?? []).filter(
    (v) => metres(anchor, v) <= POINT_SITE_LIMITS.discM,
  ).length;
  if (nearVehicles >= POINT_SITE_LIMITS.maxVehicles) {
    return { offSite: false, reason: "vehicles stand near the point" };
  }
  const green = greenShare(
    discRing(anchor, POINT_SITE_LIMITS.discM),
    input.vegetationAt,
    input.buildings,
  );
  const use = anchorParcelOf(input)?.landUse;
  const open = use ? (use.open ?? 0) : null;
  if (green == null && open == null) return null;
  if (green != null && green >= POINT_SITE_LIMITS.greenShare) {
    return {
      offSite: true,
      reason: `the point lies in vegetation (${Math.round(green * 100)} % within ${POINT_SITE_LIMITS.discM} m) with no building or vehicles near it`,
    };
  }
  if (open != null && open >= POINT_SITE_LIMITS.openShare) {
    return {
      offSite: true,
      reason: `the cadastre lists the parcel at the point as open land (${Math.round(open * 100)} %) and no building or vehicles are near it`,
    };
  }
  return { offSite: false, reason: "the ground at the point is not open land" };
}

/**
 * The nearest vehicle lot within `nearestLotM` of an off-site point, outlined
 * as stage 1 or 2 would from one of its vehicles. Null when there is none.
 */
function nearestLot(
  input: CascadeInput,
): { result: BoundaryResult; stage: CascadeStage; distanceM: number } | null {
  if (!input.vehicles || input.vehicles.length === 0) return null;
  const tried: LonLat[] = [];
  const nearby = input.vehicles
    .map((v) => ({ v, d: metres(input.anchor, v) }))
    .filter(({ d }) => d <= POINT_SITE_LIMITS.nearestLotM)
    .sort((a, b) => a.d - b.d);
  for (const { v, d } of nearby) {
    if (tried.some((t) => metres(t, v) <= CASCADE_LIMITS.vehicleLinkM)) {
      continue;
    }
    const at = { ...input, anchor: v };
    const lot = vehicleLot(
      input.vehicles,
      v,
      anchorParcelOf(at)?.ring,
      anchorBuildingOf(at),
    );
    tried.push(...(lot.length > 0 ? lot : [v]));
    if (lot.length < CASCADE_LIMITS.hullMinVehicles) continue;
    for (const [stage, run] of [
      [1, vehicleParcelStage],
      [2, vehicleHullStage],
    ] as const) {
      const outcome = run(at);
      if (outcome.result) {
        return {
          result: {
            ...outcome.result,
            confidence: Math.min(
              outcome.result.confidence,
              POINT_SITE_LIMITS.movedConfidence,
            ),
          },
          stage,
          distanceM: d,
        };
      }
    }
    if (tried.length > 400) break;
  }
  return null;
}

// --- Orchestration ------------------------------------------------------

/**
 * Runs stages 1–4 in order and stops at the first that accepts. Later stages
 * still run so their geometry can be offered as an alternative, but they never
 * change the chosen result. The vehicle outline is not offered next to
 * well-covering parcels.
 */
export function runCascade(given: CascadeInput): CascadeOutcome {
  const trace: string[] = [];
  const moved = addressAnchor(given);
  const input = moved ? { ...given, anchor: moved.anchor } : given;
  if (moved) {
    trace.push(
      `the dealership's address is on a parcel ${Math.round(moved.distanceM)} m from the point; the boundary starts there`,
    );
  }
  const alternatives: BoundaryResult[] = [];
  const stages: Array<[CascadeStage, (input: CascadeInput) => StageOutcome]> = [
    [1, vehicleParcelStage],
    [2, vehicleHullStage],
    [3, osmDealerStage],
    [4, parcelStage],
  ];
  let chosen: { result: BoundaryResult; stage: CascadeStage } | null = null;
  let lotVehicles: number | undefined;
  let stageFlags: BoundaryReviewFlag[] = [];
  for (const [stage, run] of stages) {
    const outcome = run(input);
    alternatives.push(...outcome.alternatives);
    lotVehicles ??= outcome.lotVehicles;
    if (chosen) {
      // Parcels that hold most of the lot leave the vehicle outline nothing
      // to add: it only follows parked cars into the street.
      const outlineAfterGoodParcels =
        stage === 2 &&
        chosen.stage === 1 &&
        chosen.result.confidence >= CASCADE_CONFIDENCE.vehicleParcels;
      if (outcome.result && !outlineAfterGoodParcels) {
        alternatives.push(outcome.result);
      }
      continue;
    }
    trace.push(`stage ${stage}: ${outcome.reason}`);
    if (outcome.result) {
      chosen = { result: outcome.result, stage };
      stageFlags = outcome.flags ?? [];
    }
  }
  const flags: BoundaryReviewFlag[] = [...stageFlags];
  const anchorParcel = anchorParcelOf(input);
  if (input.parcelsTruncated && !anchorParcel) {
    // The service capped its answer and the parcel at the point is missing;
    // the result fell back to a weaker stage for want of data.
    flags.push("cadastreIncomplete");
    trace.push("cadastre answer capped; the parcel at the point is missing");
  }
  if (
    input.vehicles != null &&
    (chosen == null || chosen.stage >= 4) &&
    (lotVehicles ?? 0) < CASCADE_LIMITS.hullMinVehicles
  ) {
    // Vehicles were detected, but none form a lot at the point: often the
    // geocoded point is not where the dealership is.
    flags.push("noLotAtPoint");
  }
  let pointOffSite = false;
  if (chosen == null || chosen.stage >= 4) {
    const check = pointSiteCheck(input);
    if (check?.offSite) {
      // A wood or a field is no dealership, whatever its parcel: drop it and
      // look for the nearest lot instead.
      pointOffSite = true;
      flags.push("pointOffSite");
      trace.push(`point check: ${check.reason}`);
      if (chosen?.stage === 4) {
        alternatives.push(chosen.result);
        chosen = null;
      }
      const near = nearestLot(input);
      if (near) {
        chosen = { result: near.result, stage: near.stage };
        trace.push(
          `point check: nearest vehicle lot ${Math.round(near.distanceM)} m away used instead; check that it is the dealership`,
        );
      } else {
        trace.push(
          `point check: no vehicle lot within ${POINT_SITE_LIMITS.nearestLotM} m; correct the position`,
        );
      }
    }
  }
  return {
    result: chosen?.result ?? null,
    stage: chosen?.stage ?? null,
    trace,
    alternatives,
    ...(lotVehicles != null ? { lotVehicles } : {}),
    flags,
    ...(pointOffSite ? { pointOffSite } : {}),
    ...(moved ? { anchor: moved.anchor } : {}),
  };
}

/**
 * Adds the quality block every result carries. `vehiclesOutsideNearby` counts
 * vehicles within `outsideNearbyM` outside the result — a row of cars there
 * usually means a clipped lot and sends the result to review.
 * `sourceAgreement` is informational: the best overlap with an alternative
 * from a different dataset.
 */
export function finalizeCascadeResult(
  result: BoundaryResult,
  stage: CascadeStage,
  anchor: LonLat,
  alternatives: BoundaryResult[],
  trace: string[],
  parameters: RiskParameters,
  vehicles: LonLat[] | null = null,
  context: {
    /** Parcels at the site; vehicles on street-like ones are not counted outside. */
    parcels?: ParcelFeature[];
    lotVehicles?: number;
    flags?: BoundaryReviewFlag[];
    /** Traffic areas without street parcels (Bayern), as in `CascadeInput`. */
    isStreetAt?: (point: LonLat) => boolean;
  } = {},
): BoundaryResult {
  const rings = outerRings(result.polygon) as LonLat[][];
  // Every street-like parcel, field strips included: the cars at a kerb, or
  // on a strip beside the lot, are not a clipped lot. (Telling strips from
  // streets here made parallel footpath parcels count as strips and their
  // kerbside cars as outside vehicles.)
  const streets = (context.parcels ?? [])
    .filter((parcel) => isStreetParcel(parcel))
    .map((parcel) => parcel.ring);
  const inside = rings.some((ring) => contains(ring, anchor));
  const pointDistanceM = inside
    ? 0
    : Math.min(...rings.map((ring) => distanceToRingM(anchor, ring)));
  const pointRelation = inside
    ? "inside"
    : pointDistanceM <= parameters.boundaryNearPointDistanceM
      ? "near"
      : "outside";
  const sourceAgreement = alternatives
    .filter(
      (other) => other.source !== "synthetic" && other.source !== result.source,
    )
    .reduce(
      (best, other) =>
        Math.max(best, approximatePolygonIoU(result.polygon, other.polygon)),
      0,
    );
  const areaPlausibility =
    result.areaSqm >= CASCADE_LIMITS.minHullSqm &&
    result.areaSqm <= parameters.boundaryMaxAreaSqm
      ? 1
      : 0;
  const vehiclesOutsideNearby =
    vehicles == null || result.source === "synthetic"
      ? undefined
      : vehicles.filter(
          (v) =>
            !geometryContains(result.polygon, v) &&
            // Cars parked along the kerb are not a clipped lot.
            !streets.some((ring) => contains(ring, v)) &&
            !(context.isStreetAt?.(v) ?? false) &&
            Math.min(...rings.map((ring) => distanceToRingM(v, ring))) <=
              CASCADE_LIMITS.outsideNearbyM,
        ).length;
  return {
    ...result,
    quality: {
      geometryValid: true,
      pointRelation,
      pointDistanceM,
      sourceAgreement,
      areaPlausibility,
      boundaryFit: result.role === "operationalLot" ? 1 : 0.5,
      reasons: [...trace],
      ...(vehiclesOutsideNearby != null ? { vehiclesOutsideNearby } : {}),
      ...(context.lotVehicles != null
        ? { lotVehicles: context.lotVehicles }
        : {}),
      ...(context.flags && context.flags.length > 0
        ? { reviewFlags: [...context.flags] }
        : {}),
      requestedEngine: "cascade",
      usedEngine: "cascade",
      resultVersion: CASCADE_VERSION,
      cascadeStage: stage,
    },
  };
}
