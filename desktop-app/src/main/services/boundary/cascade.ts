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
 */
export const CASCADE_VERSION = 7;

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
  if (!isStreetLike(parcel.ring)) return false;
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
      (parcel) => isStreetLike(parcel.ring) && !isFieldStrip(parcel, parcels),
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

function isAdjacent(a: ParcelFeature, b: ParcelFeature): boolean {
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
      source: `ALKIS (${state})`,
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
    const members: ParcelFeature[] = [seed];
    let areaSqm = seed.areaSqm;
    const queue = [seed];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const parcel of input.parcels) {
        if (members.includes(parcel) || !isAdjacent(parcel, current)) continue;
        const count = vehiclesOn(parcel);
        if (count < minVehicles) continue;
        if (parcel.areaSqm > CASCADE_LIMITS.maxParcelSqm) continue;
        if (isStreetLike(parcel.ring)) continue;
        const unbuilt = unbuiltAreaSqm(parcel, buildings);
        const minDensity =
          unbuilt > CASCADE_LIMITS.largeUnbuiltSqm
            ? CASCADE_LIMITS.parcelMinVehiclesPer1000SqmLarge
            : CASCADE_LIMITS.parcelMinVehiclesPer1000Sqm;
        if ((count / unbuilt) * 1000 < minDensity) continue;
        if (areaSqm + parcel.areaSqm > input.parameters.boundaryMaxAreaSqm) {
          continue;
        }
        members.push(parcel);
        areaSqm += parcel.areaSqm;
        queue.push(parcel);
      }
    }
    return members;
  };

  const build = (
    lot: LonLat[],
    members: ParcelFeature[],
  ): { areaSqm: number; result: BoundaryResult; reason: string } | null => {
    const geometry = unionRings(members.map((parcel) => parcel.ring));
    if (!geometry) return null;
    const areaSqm = geometryAreaSqm(geometry);
    const covered = lot.filter((v) => geometryContains(geometry, v)).length;
    const coverage = covered / lot.length;
    const confidence =
      coverage >= CASCADE_LIMITS.goodCoverage
        ? CASCADE_CONFIDENCE.vehicleParcels
        : CASCADE_CONFIDENCE.vehicleParcelsPartial;
    const joined = members.length - 1;
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
      reason: `parcel at the point${joined > 0 ? ` + ${joined} adjacent parcel(s)` : ""} hold ${covered} of ${lot.length} lot vehicles (${Math.round(coverage * 100)}%)`,
    };
  };

  const firstMembers = grow(firstLot);
  const first = build(firstLot, firstMembers);
  if (!first) {
    return { result: null, reason: "parcel union failed", alternatives: [] };
  }
  if (first.areaSqm < CASCADE_LIMITS.minLotSqm) {
    // A sliver at the point (a 128 m² town-centre plot in the 50-site run)
    // with nothing joined is not a lot; the vehicle outline does better.
    return {
      result: null,
      reason: `parcel at the point is ${Math.round(first.areaSqm)} m² and nothing joined, too small for a lot`,
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
        !isStreetLike(parcel.ring),
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

// --- Orchestration ------------------------------------------------------

/**
 * Runs stages 1–4 in order and stops at the first that accepts. Later stages
 * still run so their geometry can be offered as an alternative, but they never
 * change the chosen result. The vehicle outline is not offered next to
 * well-covering parcels.
 */
export function runCascade(input: CascadeInput): CascadeOutcome {
  const trace: string[] = [];
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
  return {
    result: chosen?.result ?? null,
    stage: chosen?.stage ?? null,
    trace,
    alternatives,
    ...(lotVehicles != null ? { lotVehicles } : {}),
    flags,
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
    .filter((parcel) => isStreetLike(parcel.ring))
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
