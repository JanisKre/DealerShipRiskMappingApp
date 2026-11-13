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
import { finalizeCascadeResult, runCascade } from "./cascade";
import { vegetationAt, type VegetationMask } from "./vegetation";

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
  vegetation?: VegetationMask;
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
}

export interface ReplayOutcome {
  rows: ReplayRow[];
  /** Over the samples with a reference only. */
  all: BoundaryBenchmarkResult | null;
  holdout: BoundaryBenchmarkResult | null;
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
    const { vegetation } = sample;
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
    };
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
  };
}
