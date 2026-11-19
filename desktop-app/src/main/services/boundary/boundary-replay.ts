import type { BoundaryGeometry, RiskParameters } from "@shared/types";
import { DEFAULT_RISK_PARAMETERS } from "@shared/parameters";
import { boundaryReviewReasons } from "@shared/boundary-review";
import type { LonLat } from "../boundary-geometry";
import type { ParcelFeature } from "../alkis.service";
import {
  evaluateBoundaryBenchmark,
  type BoundaryBenchmarkResult,
} from "../boundary-benchmark";
import { syntheticFallbackBoundary } from "./synthetic";
import {
  cutBuildings,
  finalizeCascadeResult,
  geometryContains,
  runCascade,
} from "./cascade";
import { vegetationAt, type VegetationMask } from "./vegetation";

/** Radius of the analysis' first image (`CONTEXT_CAPTURE_RADIUS_M`). */
const REPLAY_IMAGE_RADIUS_M = 125;

/** A vegetation raster as it is stored in a dump: cells as base64. */
export type StoredVegetationMask = Omit<VegetationMask, "cells"> & {
  cells: string;
};

export function storeVegetation(mask: VegetationMask): StoredVegetationMask {
  return { ...mask, cells: Buffer.from(mask.cells).toString("base64") };
}

function loadVegetation(
  mask: VegetationMask | StoredVegetationMask,
): VegetationMask {
  return typeof mask.cells === "string"
    ? { ...mask, cells: new Uint8Array(Buffer.from(mask.cells, "base64")) }
    : (mask as VegetationMask);
}

/**
 * One site's frozen boundary inputs: what the cascade saw, without network
 * or model. Written by the network benchmark (`BOUNDARY_BENCHMARK_DUMP`) or
 * by hand from an audit; replayed by `replayBoundarySamples`.
 *
 * Inputs derived from a customer portfolio stay outside the repository
 * (`*.local.json`, see docs/boundary-model.md).
 */
export interface ReplaySample {
  id: string;
  holdout?: boolean;
  anchor: LonLat;
  /** Reference geometry, when one exists; without it only stage and area are reported. */
  reference?: BoundaryGeometry;
  /** Roof-masked vehicle centres; null when no detector ran. */
  vehicles: LonLat[] | null;
  parcels: ParcelFeature[];
  parcelsTruncated?: boolean;
  buildings?: LonLat[][];
  /** The dealership's address, as the analysis passes it (cascade v9). */
  address?: string;
  /** Vegetation raster of the context image (cascade v9). */
  vegetation?: VegetationMask | StoredVegetationMask;
  /**
   * Radius of the image the vehicles were detected on (cascade v16): beyond
   * it a parcel is "not seen". 125 m, the analysis' first image, when unset.
   */
  imageRadiusM?: number;
}

/** [west, south, east, north] of the square image of `radiusM` at a point. */
export function imageBoundsAround(
  anchor: LonLat,
  radiusM: number,
): [number, number, number, number] {
  const dLat = radiusM / 111_320;
  const dLon = dLat / Math.max(0.1, Math.cos((anchor[1] * Math.PI) / 180));
  return [
    anchor[0] - dLon,
    anchor[1] - dLat,
    anchor[0] + dLon,
    anchor[1] + dLat,
  ];
}

export interface ReplayRow {
  id: string;
  holdout: boolean;
  stage: number;
  areaSqm: number;
  confidence: number;
  polygon: BoundaryGeometry;
  reviewReasons: string[];
  trace: string[];
  /** Buildings the outline runs through (`cutBuildings`). */
  cutBuildings: number;
}

/**
 * What the overlap scores do not show. Buildings cut by the outline are
 * counted on every sample but the fallback circle (a placeholder, drawn
 * through whatever stands there); the vehicle split only where a reference
 * exists.
 * What a dealership insures against hail is the vehicles outside, so the
 * share of the reference's vehicles a result holds, and the share of its
 * vehicles that stand outside the reference, say more about the risk figure
 * than the area does.
 */
export interface ReplayDiagnostics {
  samples: number;
  /** Samples whose result is the fallback circle. */
  fallbackSamples: number;
  cutBuildings: number;
  samplesWithCutBuildings: number;
  /** Samples with a reference and a vehicle detection. */
  vehicleSamples: number;
  referenceVehicles: number;
  referenceVehiclesInside: number;
  resultVehicles: number;
  /** Vehicles inside the result but outside the reference. */
  foreignVehicles: number;
}

export interface ReplayOutcome {
  rows: ReplayRow[];
  /** Over the samples with a reference only. */
  all: BoundaryBenchmarkResult | null;
  holdout: BoundaryBenchmarkResult | null;
  diagnostics: ReplayDiagnostics;
}

/** `ReplayDiagnostics` of results against the inputs they were formed from. */
export function replayDiagnostics(
  samples: Array<Pick<ReplaySample, "reference" | "vehicles" | "buildings">>,
  polygons: BoundaryGeometry[],
  /** True where the result is the fallback circle. */
  fallback: boolean[] = [],
): { diagnostics: ReplayDiagnostics; cutPerSample: number[] } {
  const diagnostics: ReplayDiagnostics = {
    samples: samples.length,
    fallbackSamples: fallback.filter(Boolean).length,
    cutBuildings: 0,
    samplesWithCutBuildings: 0,
    vehicleSamples: 0,
    referenceVehicles: 0,
    referenceVehiclesInside: 0,
    resultVehicles: 0,
    foreignVehicles: 0,
  };
  const cutPerSample = samples.map((sample, i) => {
    const polygon = polygons[i];
    const cut = fallback[i]
      ? 0
      : cutBuildings(polygon, sample.buildings ?? []).length;
    diagnostics.cutBuildings += cut;
    if (cut > 0) diagnostics.samplesWithCutBuildings += 1;
    const { reference, vehicles } = sample;
    if (reference && vehicles) {
      const inResult = vehicles.filter((v) => geometryContains(polygon, v));
      const inReference = vehicles.filter((v) =>
        geometryContains(reference, v),
      );
      diagnostics.vehicleSamples += 1;
      diagnostics.referenceVehicles += inReference.length;
      diagnostics.referenceVehiclesInside += inReference.filter((v) =>
        geometryContains(polygon, v),
      ).length;
      diagnostics.resultVehicles += inResult.length;
      diagnostics.foreignVehicles += inResult.filter(
        (v) => !geometryContains(reference, v),
      ).length;
    }
    return cut;
  });
  return { diagnostics, cutPerSample };
}

/**
 * Runs the cascade on frozen inputs — deterministic, offline, in
 * milliseconds — so a rule change is measured on exactly the inputs the
 * previous rule saw. A live run differs between days (imagery, service
 * answers), and such a change must not be read as an algorithm gain.
 */
export function replayBoundarySamples(
  samples: ReplaySample[],
  parameters: RiskParameters = DEFAULT_RISK_PARAMETERS,
): ReplayOutcome {
  const rows = samples.map((sample): ReplayRow => {
    const vegetation = sample.vegetation
      ? loadVegetation(sample.vegetation)
      : undefined;
    const outcome = runCascade({
      anchor: sample.anchor,
      ...(sample.address ? { address: sample.address } : {}),
      ...(vegetation
        ? {
            vegetationAt: (point: LonLat): boolean | null =>
              vegetationAt(vegetation, point),
          }
        : {}),
      vehicles: sample.vehicles,
      osm: null,
      parcels: sample.parcels,
      parcelsTruncated: sample.parcelsTruncated ?? false,
      buildings: sample.buildings ?? [],
      imageBounds: imageBoundsAround(
        sample.anchor,
        sample.imageRadiusM ?? REPLAY_IMAGE_RADIUS_M,
      ),
      parameters,
    });
    const stage = outcome.stage ?? 5;
    const chosen =
      outcome.result ??
      syntheticFallbackBoundary(
        sample.anchor[1],
        sample.anchor[0],
        parameters.syntheticBoundaryRadiusM,
      );
    const result = finalizeCascadeResult(
      chosen,
      stage,
      outcome.anchor ?? sample.anchor,
      outcome.alternatives,
      outcome.trace,
      parameters,
      sample.vehicles,
      {
        parcels: sample.parcels,
        lotVehicles: outcome.lotVehicles,
        flags: outcome.flags,
        ...(outcome.imageTooSmall ? { imageTooSmall: true } : {}),
      },
    );
    return {
      id: sample.id,
      holdout: sample.holdout ?? false,
      stage,
      areaSqm: result.areaSqm,
      confidence: result.confidence,
      polygon: result.polygon,
      reviewReasons: boundaryReviewReasons(result, parameters),
      trace: outcome.trace,
      cutBuildings: 0,
    };
  });
  const { diagnostics, cutPerSample } = replayDiagnostics(
    samples,
    rows.map((row) => row.polygon),
    rows.map((row) => row.stage === 5),
  );
  rows.forEach((row, i) => {
    row.cutBuildings = cutPerSample[i];
  });
  const scored = (
    keep: (sample: ReplaySample) => boolean,
  ): BoundaryBenchmarkResult | null => {
    const pairs = samples.flatMap((sample, i) =>
      sample.reference && keep(sample)
        ? [
            {
              id: sample.id,
              reference: sample.reference,
              predicted: rows[i].polygon,
              predictedConfidence: rows[i].confidence,
            },
          ]
        : [],
    );
    return pairs.length > 0
      ? evaluateBoundaryBenchmark(pairs, { dataset: "boundary-replay" })
      : null;
  };
  return {
    rows,
    all: scored(() => true),
    holdout: scored((sample) => sample.holdout === true),
    diagnostics,
  };
}
