import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import { featureCollection, polygon as turfPolygon } from "@turf/helpers";
import { union } from "@turf/union";
import type { Feature, MultiPolygon, Polygon as GeoPolygon } from "geojson";
import type {
  BoundaryGeometry,
  BoundaryResult,
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
import { cellCount, cellIndex, createGridSpec, type GridSpec } from "./grid";
import { erode, rasterizeDisk } from "./rasterize";
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

/** Bumped whenever a stage rule changes, so cached results can be retired. */
export const CASCADE_VERSION = 2;

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
  /** A vehicle cluster belongs to the site if it comes this close to the point. */
  anchorReachM: 25,
  /**
   * Vehicles further from the point are ignored, so lots cannot chain on
   * through a business park. 150 m doubled the area bias on the benchmark.
   */
  maxReachM: 80,
  /** Fewer vehicles than this are a few parked cars, not a lot. */
  minLotVehicles: 3,
  /**
   * An adjacent parcel joins when at least this many lot vehicles stand on it:
   * a yard, not a neighbour's staff parking.
   */
  parcelMinVehicles: 10,
  /** Vertex distance at which two parcels count as neighbours. */
  adjacentParcelM: 3,
  /** Parcels narrower than this and long … */
  streetMaxWidthM: 20,
  /** … by more than this factor are streets or paths and never join. */
  streetMinElongation: 6,
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
  /** Vehicles outside the result but this close to it count as unexplained. */
  outsideNearbyM: 15,
  /** Share of lot vehicles a parcel result must cover for full confidence. */
  goodCoverage: 0.8,
} as const;

export const CASCADE_CONFIDENCE = {
  vehicleParcels: 0.75,
  vehicleParcelsPartial: 0.6,
  vehicleHull: 0.55,
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
  parameters: RiskParameters;
}

export interface StageOutcome {
  result: BoundaryResult | null;
  /** One line explaining why the stage accepted or declined. */
  reason: string;
  /** Geometries worth offering as alternatives even though not chosen. */
  alternatives: BoundaryResult[];
}

export interface CascadeOutcome {
  /** Null when stages 1–4 all declined; the caller adds the circle. */
  result: BoundaryResult | null;
  stage: CascadeStage | null;
  trace: string[];
  alternatives: BoundaryResult[];
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
): LonLat[] {
  const points = vehicles.filter(
    (v) => metres(anchor, v) <= CASCADE_LIMITS.maxReachM,
  );
  const xy = points.map((p) => projectPoint(p, anchor));
  const parent = points.map((_, i) => i);
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
  points.forEach((_, i) => {
    const root = find(i);
    clusters.set(root, [...(clusters.get(root) ?? []), i]);
  });
  const lot: LonLat[] = [];
  for (const members of clusters.values()) {
    if (members.length < CASCADE_LIMITS.minLotVehicles) continue;
    const touches = members.some(
      (i) =>
        Math.hypot(xy[i][0], xy[i][1]) <= CASCADE_LIMITS.anchorReachM ||
        (anchorParcel != null && contains(anchorParcel, points[i])),
    );
    if (touches) lot.push(...members.map((i) => points[i]));
  }
  return lot;
}

/** Long and narrow: a street, path or rail parcel between two plots. */
export function isStreetLike(ring: LonLat[]): boolean {
  const origin = ring[0];
  const xy = ring.map((p) => projectPoint(p, origin));
  let perimeter = 0;
  for (let i = 1; i < xy.length; i += 1) {
    perimeter += Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]);
  }
  if (perimeter === 0) return false;
  // For a long rectangle, 2·area/perimeter is close to its width.
  const width = (2 * ringAreaSqm(ring)) / perimeter;
  const length = perimeter / 2 - width;
  return (
    width < CASCADE_LIMITS.streetMaxWidthM &&
    length > CASCADE_LIMITS.streetMinElongation * width
  );
}

function isAdjacent(a: ParcelFeature, b: ParcelFeature): boolean {
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
  const lot = vehicleLot(input.vehicles, input.anchor, anchor.ring);
  if (lot.length === 0) {
    return {
      result: null,
      reason: "no vehicle lot at the point",
      alternatives: [],
    };
  }

  const vehiclesOn = (parcel: ParcelFeature): number =>
    lot.filter((v) => contains(parcel.ring, v)).length;
  const members: ParcelFeature[] = [anchor];
  let areaSqm = anchor.areaSqm;
  const queue = [anchor];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const parcel of input.parcels) {
      if (members.includes(parcel) || !isAdjacent(parcel, current)) continue;
      if (vehiclesOn(parcel) < CASCADE_LIMITS.parcelMinVehicles) continue;
      if (parcel.areaSqm > CASCADE_LIMITS.maxParcelSqm) continue;
      if (isStreetLike(parcel.ring)) continue;
      if (areaSqm + parcel.areaSqm > input.parameters.boundaryMaxAreaSqm) {
        continue;
      }
      members.push(parcel);
      areaSqm += parcel.areaSqm;
      queue.push(parcel);
    }
  }

  const geometry = unionRings(members.map((parcel) => parcel.ring));
  if (!geometry) {
    return { result: null, reason: "parcel union failed", alternatives: [] };
  }
  areaSqm = geometryAreaSqm(geometry);
  const covered = lot.filter((v) => geometryContains(geometry, v)).length;
  const coverage = covered / lot.length;
  const confidence =
    coverage >= CASCADE_LIMITS.goodCoverage
      ? CASCADE_CONFIDENCE.vehicleParcels
      : CASCADE_CONFIDENCE.vehicleParcelsPartial;
  const joined = members.length - 1;
  return {
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
    alternatives: [],
  };
}

// --- Stage 2: outline of the vehicle lot ----------------------------------

const OUTLINE_CELL_M = 1;

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
  const outline = masksToGeometry(spec, components(spec, mask), {
    simplifyToleranceM: 1,
  });
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
          "Showroom, workshop and empty areas without vehicles are not included",
        ],
      },
    },
    reason: `outline of ${lot.length} lot vehicles`,
    alternatives: [],
  };
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
 * change the chosen result.
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
  for (const [stage, run] of stages) {
    const outcome = run(input);
    alternatives.push(...outcome.alternatives);
    if (chosen) {
      if (outcome.result) alternatives.push(outcome.result);
      continue;
    }
    trace.push(`stage ${stage}: ${outcome.reason}`);
    if (outcome.result) chosen = { result: outcome.result, stage };
  }
  return {
    result: chosen?.result ?? null,
    stage: chosen?.stage ?? null,
    trace,
    alternatives,
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
): BoundaryResult {
  const rings = outerRings(result.polygon) as LonLat[][];
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
      requestedEngine: "cascade",
      usedEngine: "cascade",
      resultVersion: CASCADE_VERSION,
      cascadeStage: stage,
    },
  };
}
