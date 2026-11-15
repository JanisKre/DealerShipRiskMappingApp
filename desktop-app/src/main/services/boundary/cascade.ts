import type {
  BoundaryResult,
  BoundaryReviewFlag,
  RiskParameters,
} from "@shared/types";
import { outerRings } from "@shared/boundary-geometry-utils";
import {
  approximatePolygonIoU,
  distanceToRingM,
  type LonLat,
} from "../boundary-geometry";
import type { ParcelFeature } from "../alkis.service";
import {
  CASCADE_VERSION,
  CASCADE_LIMITS,
  CASCADE_CONFIDENCE,
  type CascadeStage,
  type CascadeInput,
  type StageOutcome,
  type CascadeOutcome,
} from "./cascade-config";
import {
  contains,
  geometryContains,
  metres,
  discRing,
} from "./cascade-geometry";
import {
  vehicleLot,
  anchorBuildingOf,
  anchorParcelOf,
} from "./cascade-anchors";
import { isStreetParcel, greenShare } from "./cascade-parcels";
import {
  addressAnchor,
  parcelResult,
  vehicleParcelStage,
} from "./cascade-vehicle-parcel";
import { vehicleHullStage, osmDealerStage } from "./cascade-hull";

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
 *
 * Files: `cascade-config` (version, limits, shapes), `cascade-geometry`
 * (ring helpers), `cascade-parcels` (street, strip and land-use tests),
 * `cascade-anchors` (vehicle lot, anchor building and parcel),
 * `cascade-vehicle-parcel` (stage 1), `cascade-hull` (stages 2 and 3 and
 * their grid masks); this file holds stage 4, the off-site check and the
 * cascade itself, and re-exports the rest.
 */

export * from "./cascade-config";
export * from "./cascade-geometry";
export * from "./cascade-parcels";
export * from "./cascade-anchors";
export * from "./cascade-vehicle-parcel";
export * from "./cascade-hull";

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
