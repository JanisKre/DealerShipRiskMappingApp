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
  ringAreaSqm,
  type LonLat,
} from "../boundary-geometry";
import type { ParcelFeature } from "../alkis.service";
import type { EvidenceArea, OsmEvidence } from "./osm-overpass";
import { matchesSite } from "./site-membership";

/**
 * Source cascade: the boundary engine since `CASCADE_VERSION` 1.
 *
 * Each stage has one acceptance rule, and the first stage that accepts wins.
 * A later stage is consulted only when every earlier one declined, so every
 * result can be explained in one sentence ("stage 2, because no OSM dealer
 * area contains the point"). Nothing is blended, weighted or grown:
 *
 *   1. OSM car-dealer area   — the site as a mapper drew it
 *   2. ALKIS parcel          — the official plot containing the point
 *   3. OSM parking/building  — the surfaces at the point, joined
 *   4. aerial paved surface  — imagery heuristic (caller, needs network)
 *   5. synthetic circle      — always succeeds, always reviewed (caller)
 *
 * Stages 1–3 are pure over already-fetched evidence so the rules are
 * unit-testable; stages 4 and 5 are run by `boundary.service.ts`.
 *
 * Results are never silently enlarged with another source. Stages that also
 * produced a geometry are returned as alternatives, so a reviewer can switch to
 * the parcel with one click instead of redrawing.
 *
 * Confidence values are fixed priors per stage, not calibrated probabilities.
 * They are ordered so that stage 1 clears the default review threshold (0.7)
 * and everything after it does not.
 */

/** Bumped whenever a stage rule changes, so cached results can be retired. */
export const CASCADE_VERSION = 1;

export type CascadeStage = 1 | 2 | 3 | 4 | 5;

/** Area limits in m². See docs/boundary-model.md, "Source cascade". */
export const CASCADE_LIMITS = {
  /** Below this nothing is a dealership lot — a kiosk, a garage, a sliver. */
  minLotSqm: 300,
  /** An anchor parcel smaller than this is joined with adjacent site parcels. */
  smallParcelSqm: 1_500,
  /** A parcel larger than this is an estate or a field, not a lot. */
  maxParcelSqm: 30_000,
  /** OSM parking islands this close to the seed belong to the same surface. */
  surfaceJoinM: 10,
  /** Vertex distance at which two parcels count as neighbours. */
  adjacentParcelM: 3,
} as const;

export const CASCADE_CONFIDENCE = {
  dealerMatchedInside: 0.85,
  dealerInside: 0.75,
  dealerMatchedNear: 0.7,
  /** Contains the point but carries another business's name. */
  dealerNamedOtherwise: 0.6,
  parcel: 0.6,
  parcelJoined: 0.5,
  osmSurface: 0.45,
  aerialMax: 0.4,
} as const;

export interface CascadeInput {
  anchor: LonLat;
  name?: string;
  address?: string;
  /** Null when Overpass could not be reached. */
  osm: OsmEvidence | null;
  parcels: ParcelFeature[];
  /** A truncated parcel set must not be used to join neighbours. */
  parcelsTruncated: boolean;
  parameters: RiskParameters;
}

export interface StageOutcome {
  result: BoundaryResult | null;
  /** One line explaining why the stage accepted or declined. */
  reason: string;
  /** Geometries worth offering as alternatives even though not chosen. */
  alternatives: BoundaryResult[];
}

export interface VectorCascadeOutcome {
  /** Null when stages 1–3 all declined; the caller continues with 4 and 5. */
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

function distanceM(ring: LonLat[], point: LonLat): number {
  return contains(ring, point) ? 0 : distanceToRingM(point, ring);
}

function validRing(ring: LonLat[], maxAreaSqm: number): boolean {
  return (
    ring.length >= 4 && checkRing(ring, { minAreaSqm: 10, maxAreaSqm }).valid
  );
}

/** Shortest distance between two rings, by vertices; 0 when they overlap. */
function ringGapM(a: LonLat[], b: LonLat[]): number {
  let best = Infinity;
  for (const point of a) {
    if (contains(b, point)) return 0;
    best = Math.min(best, distanceToRingM(point, b));
  }
  for (const point of b) {
    if (contains(a, point)) return 0;
    best = Math.min(best, distanceToRingM(point, a));
  }
  return best;
}

function ringCentroid(ring: LonLat[]): LonLat {
  const points =
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
      ? ring.slice(0, -1)
      : ring;
  const sum = points.reduce<[number, number]>(
    (acc, [lon, lat]) => [acc[0] + lon, acc[1] + lat],
    [0, 0],
  );
  return [sum[0] / points.length, sum[1] / points.length];
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

// --- Stage 1: OSM car-dealer area ---------------------------------------

/**
 * An OSM area tagged as a car dealer (`shop=car`, `office=car_dealer`, …) that
 * contains the point, or that carries the dealership's name or address and
 * lies within `boundaryNearPointDistanceM` of it.
 *
 * A dealer tag on a *building* is a showroom footprint, not the lot; those are
 * left to stage 3.
 */
export function osmDealerStage(input: CascadeInput): StageOutcome {
  if (!input.osm) {
    return { result: null, reason: "OSM unreachable", alternatives: [] };
  }
  const maxArea = input.parameters.boundaryMaxAreaSqm;
  const nearM = input.parameters.boundaryNearPointDistanceM;
  const candidates = input.osm.areas
    .filter((area) => area.kind === "dealerArea" && !area.tags.building)
    .map((area) => {
      const areaSqm = ringAreaSqm(area.ring);
      return {
        area,
        areaSqm,
        distance: distanceM(area.ring, input.anchor),
        identity: matchesSite(area.tags, input.name, input.address),
      };
    })
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
    );

  const best = candidates[0];
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
  const reason = best.identity
    ? `OSM dealer area matches name/address${inside ? " and contains the point" : `, ${Math.round(best.distance)} m from the point`}`
    : namedOtherwise
      ? `OSM dealer area contains the point but is named "${best.area.tags.name}"`
      : "OSM dealer area contains the point";
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
        method: "cascade stage 1: car-dealer area at the point",
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
    reason,
    alternatives: [],
  };
}

// --- Stage 2: ALKIS parcel ----------------------------------------------

function hasSiteSurface(
  parcel: ParcelFeature,
  osm: OsmEvidence | null,
): boolean {
  if (!osm) return false;
  return osm.areas.some(
    (area) =>
      (area.kind === "parking" || area.kind === "dealerArea") &&
      contains(parcel.ring, ringCentroid(area.ring)),
  );
}

function isAdjacent(a: ParcelFeature, b: ParcelFeature): boolean {
  return a.ring.some(
    (point) => distanceToRingM(point, b.ring) <= CASCADE_LIMITS.adjacentParcelM,
  );
}

/**
 * The cadastral parcel containing the point.
 *
 * Accepted between `minLotSqm` and `maxParcelSqm`. A parcel below
 * `smallParcelSqm` is joined, one hop only, with adjacent parcels that carry an
 * OSM parking or dealer area — a dealership is routinely split over a showroom
 * plot and a yard plot. Neighbours without such evidence are never added.
 */
export function alkisParcelStage(input: CascadeInput): StageOutcome {
  const anchor = input.parcels.find((parcel) =>
    contains(parcel.ring, input.anchor),
  );
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
  const parcelResult = (
    geometry: BoundaryGeometry,
    areaSqm: number,
    joined: number,
  ): BoundaryResult => {
    const confidence =
      joined > 0 ? CASCADE_CONFIDENCE.parcelJoined : CASCADE_CONFIDENCE.parcel;
    return {
      source: "alkis",
      role: "parcel",
      provider: "alkis-parcel",
      polygon: geometry,
      areaSqm,
      confidence,
      label: joined > 0 ? `ALKIS parcel + ${joined} adjacent` : "ALKIS parcel",
      evidence: {
        source: `ALKIS (${anchor.state})`,
        retrievedAt: now(),
        method: "cascade stage 2: cadastral parcel containing the point",
        confidence,
        fallbackUsed: false,
        limitations: [
          "A parcel is a legal unit; the operational lot may be smaller or span more parcels",
        ],
      },
    };
  };

  if (anchor.areaSqm > CASCADE_LIMITS.maxParcelSqm) {
    return {
      result: null,
      reason: `parcel at the point is ${Math.round(anchor.areaSqm)} m², too large for one lot`,
      alternatives:
        anchor.areaSqm <= 500_000
          ? [
              parcelResult(
                { type: "Polygon", coordinates: [anchor.ring] },
                anchor.areaSqm,
                0,
              ),
            ]
          : [],
    };
  }

  let geometry: BoundaryGeometry = {
    type: "Polygon",
    coordinates: [anchor.ring],
  };
  let areaSqm = anchor.areaSqm;
  let joined = 0;
  if (
    anchor.areaSqm < CASCADE_LIMITS.smallParcelSqm &&
    !input.parcelsTruncated
  ) {
    const neighbours = input.parcels.filter(
      (parcel) =>
        parcel !== anchor &&
        isAdjacent(parcel, anchor) &&
        hasSiteSurface(parcel, input.osm),
    );
    const merged = unionRings([anchor.ring, ...neighbours.map((p) => p.ring)]);
    const mergedArea = merged ? geometryAreaSqm(merged) : 0;
    if (
      merged &&
      neighbours.length > 0 &&
      mergedArea <= CASCADE_LIMITS.maxParcelSqm
    ) {
      geometry = merged;
      areaSqm = mergedArea;
      joined = neighbours.length;
    }
  }
  if (areaSqm < CASCADE_LIMITS.minLotSqm) {
    return {
      result: null,
      reason: `parcel at the point is only ${Math.round(areaSqm)} m²`,
      alternatives: [],
    };
  }
  return {
    result: parcelResult(geometry, areaSqm, joined),
    reason:
      joined > 0
        ? `cadastral parcel joined with ${joined} adjacent parcel(s) carrying parking`
        : "cadastral parcel contains the point",
    alternatives: [],
  };
}

// --- Stage 3: OSM parking and buildings at the point --------------------

function isSurface(area: EvidenceArea): boolean {
  return area.kind === "parking";
}

function isSiteBuilding(area: EvidenceArea): boolean {
  return (
    area.kind === "building" ||
    (area.kind === "dealerArea" && Boolean(area.tags.building))
  );
}

/**
 * The OSM parking area or building at the point (or the nearest within
 * `boundaryNearPointDistanceM`), joined with parking areas within
 * `surfaceJoinM` of it. Buildings join only when they carry the dealership's
 * identity, because neighbouring halls touch the lot as often as its own.
 *
 * Declines when the joined set contains no parking at all: a showroom
 * footprint alone would understate the lot, and stage 4 or 5 is the more
 * honest answer.
 */
export function osmSurfaceStage(input: CascadeInput): StageOutcome {
  if (!input.osm) {
    return { result: null, reason: "OSM unreachable", alternatives: [] };
  }
  const maxArea = input.parameters.boundaryMaxAreaSqm;
  const nearM = input.parameters.boundaryNearPointDistanceM;
  const pool = input.osm.areas.filter(
    (area) =>
      (isSurface(area) || isSiteBuilding(area)) &&
      validRing(area.ring, maxArea),
  );
  let seeds = pool.filter((area) => contains(area.ring, input.anchor));
  if (seeds.length === 0) {
    const nearest = pool
      .map((area) => ({ area, distance: distanceM(area.ring, input.anchor) }))
      .filter((entry) => entry.distance <= nearM)
      .sort((a, b) => a.distance - b.distance)[0];
    seeds = nearest ? [nearest.area] : [];
  }
  if (seeds.length === 0) {
    return {
      result: null,
      reason: "no OSM parking or building at the point",
      alternatives: [],
    };
  }

  const members = [...seeds];
  for (const area of pool) {
    if (members.includes(area)) continue;
    const joins =
      isSurface(area) || matchesSite(area.tags, input.name, input.address);
    if (!joins) continue;
    if (
      members.some(
        (member) =>
          ringGapM(member.ring, area.ring) <= CASCADE_LIMITS.surfaceJoinM,
      )
    ) {
      members.push(area);
    }
  }

  const geometry = unionRings(members.map((area) => area.ring));
  if (!geometry) {
    return {
      result: null,
      reason: "OSM surface union failed",
      alternatives: [],
    };
  }
  const areaSqm = geometryAreaSqm(geometry);
  const confidence = CASCADE_CONFIDENCE.osmSurface;
  const result: BoundaryResult = {
    source: "osm",
    role: "parkingSurface",
    provider: "osm-surface",
    polygon: geometry,
    areaSqm,
    confidence,
    label: `OSM parking/building (${members.length})`,
    evidence: {
      source: "OpenStreetMap / Overpass",
      retrievedAt: now(),
      method: "cascade stage 3: parking and buildings at the point",
      confidence,
      fallbackUsed: false,
      limitations: [
        "Parking areas and buildings do not establish which business uses them",
      ],
    },
  };
  if (!members.some(isSurface)) {
    return {
      result: null,
      reason: "only a building footprint at the point, no parking",
      alternatives: [{ ...result, role: "building" }],
    };
  }
  if (areaSqm < CASCADE_LIMITS.minLotSqm || areaSqm > maxArea) {
    return {
      result: null,
      reason: `OSM surface at the point is ${Math.round(areaSqm)} m², outside the plausible range`,
      alternatives: [result],
    };
  }
  return {
    result,
    reason: `${members.length} OSM parking/building area(s) at the point`,
    alternatives: [],
  };
}

// --- Orchestration ------------------------------------------------------

/** Runs stages 1–3 in order; stops at the first that accepts. */
export function runVectorCascade(input: CascadeInput): VectorCascadeOutcome {
  const trace: string[] = [];
  const alternatives: BoundaryResult[] = [];
  const stages: Array<[CascadeStage, (input: CascadeInput) => StageOutcome]> = [
    [1, osmDealerStage],
    [2, alkisParcelStage],
    [3, osmSurfaceStage],
  ];
  let chosen: { result: BoundaryResult; stage: CascadeStage } | null = null;
  for (const [stage, run] of stages) {
    const outcome = run(input);
    alternatives.push(...outcome.alternatives);
    if (chosen) {
      // Later stages still run so their geometry can be offered for review,
      // but they never change the chosen result.
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

/** The dataset a geometry came from; agreement only counts across datasets. */
function datasetOf(result: BoundaryResult): string {
  return result.source;
}

/**
 * Adds the quality block every result carries. `sourceAgreement` is
 * informational here — the best overlap with an alternative from a different
 * dataset — and does not drive the review rule for cascade results.
 */
export function finalizeCascadeResult(
  result: BoundaryResult,
  stage: CascadeStage,
  anchor: LonLat,
  alternatives: BoundaryResult[],
  trace: string[],
  parameters: RiskParameters,
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
      (other) =>
        other.source !== "synthetic" && datasetOf(other) !== datasetOf(result),
    )
    .reduce(
      (best, other) =>
        Math.max(best, approximatePolygonIoU(result.polygon, other.polygon)),
      0,
    );
  const areaPlausibility =
    result.areaSqm >= CASCADE_LIMITS.minLotSqm &&
    result.areaSqm <= parameters.boundaryMaxAreaSqm
      ? 1
      : 0;
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
      requestedEngine: "cascade",
      usedEngine: "cascade",
      resultVersion: CASCADE_VERSION,
      cascadeStage: stage,
    },
  };
}
