/**
 * Opt-in boundary benchmark runner.
 *
 * Skipped by default: it talks to Overpass, the state cadastre services and the
 * imagery provider, so it must never gate CI. Run it deliberately:
 *
 *   npm run benchmark:boundary
 *   BOUNDARY_BENCHMARK_LIMIT=5 BOUNDARY_BENCHMARK_DELAY_MS=8000 npm run benchmark:boundary
 *   BOUNDARY_GROUNDTRUTH=~/.dealership-risk/benchmarks/boundary-groundtruth.local.json \
 *     npm run benchmark:boundary
 *
 * It reports the tuning and hold-out strata separately. The hold-out stratum is
 * the one that decides whether a change is an improvement — tuning against the
 * same sites you measure on produces numbers that only describe themselves.
 *
 * The SQLite cache and settings are replaced with in-memory stubs so the run
 * needs no Electron app directory, and so a re-run inside one session reuses
 * responses instead of hammering public services.
 */
import { describe, expect, it, vi } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const stubs = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  return {
    store,
    cacheGet: <T>(key: string): T | null => (store.get(key) as T) ?? null,
    cacheSet: <T>(key: string, value: T): void => {
      store.set(key, value);
    },
    cached: async <T>(key: string, _ttl: number, fetcher: () => Promise<T>) => {
      if (store.has(key)) return store.get(key) as T;
      const value = await fetcher();
      store.set(key, value);
      return value;
    },
  };
});

vi.mock("../cache.service", () => ({
  cacheGet: stubs.cacheGet,
  cacheSet: stubs.cacheSet,
  cached: stubs.cached,
  TTL: {
    geocode: 1,
    overpass: 1,
    buildings: 1,
    weather: 1,
    osmDetails: 1,
    osmVector: 1,
    cadastre: 1,
  },
}));

vi.mock("../settings.service", () => ({
  getSettings: () => ({
    satelliteProvider: "esri" as const,
    // BOUNDARY_ENGINE=fused scores the fusion engine instead of the candidate
    // chain, so the two can be compared on identical inputs.
    boundaryEngine:
      process.env.BOUNDARY_ENGINE === "fused"
        ? ("fused" as const)
        : ("legacy" as const),
  }),
}));

import type { Polygon } from "@shared/types";
import {
  evaluateBoundaryBenchmark,
  type BoundaryBenchmarkResult,
  type BoundaryBenchmarkSample,
} from "../boundary-benchmark";
import { detectBoundary } from "../boundary.service";

interface PublicFixture {
  id: string;
  lat: number;
  lon: number;
  state: string;
  city?: string;
  areaSqm: number;
  cadastreAvailable: boolean;
  holdout: boolean;
  reference: Polygon;
}

interface PublicFixtureFile {
  dataset: string;
  attribution: string;
  samples: PublicFixture[];
}

const FIXTURES = resolve(
  __dirname,
  "../../../../resources/benchmarks/boundary-public-fixtures.json",
);
const OUTPUT = resolve(__dirname, "../../../../coverage/boundary-benchmark.json");

const enabled = Boolean(process.env.BOUNDARY_BENCHMARK);

/**
 * Pause between sites. Overpass' public instances rate-limit by IP, and a
 * benchmark run is a burst of identical-looking queries — exactly what that
 * limit exists to stop. Pacing costs wall-clock time and buys a run that
 * actually completes with evidence.
 */
const DELAY_MS = Number(process.env.BOUNDARY_BENCHMARK_DELAY_MS ?? 0);

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function loadFixtures(): PublicFixture[] {
  const file = JSON.parse(readFileSync(FIXTURES, "utf8")) as PublicFixtureFile;
  const limit = Number(process.env.BOUNDARY_BENCHMARK_LIMIT ?? 0);
  return limit > 0 ? file.samples.slice(0, limit) : file.samples;
}

function table(label: string, result: BoundaryBenchmarkResult): void {
  console.log(
    `\n${label}  (n=${result.evaluatedSamples}, ${result.resolutionM} m cells)`,
  );
  console.log(`  mean IoU           ${result.meanIoU.toFixed(3)}`);
  console.log(`  mean Boundary-F1   ${result.meanBoundaryF1.toFixed(3)}`);
  console.log(`  mean coverage      ${result.meanCoverage.toFixed(3)}`);
  console.log(`  coverage>=90%      ${result.coverage90Rate.toFixed(3)}`);
  console.log(`  outline within 2 m ${result.within2mBoundaryRate.toFixed(3)}`);
  console.log(`  mean area bias     ${result.meanAreaBias.toFixed(3)}`);
  console.log(
    `  calibration MAE    ${result.calibration.meanAbsoluteError.toFixed(3)}`,
  );
}

describe.skipIf(!enabled)("boundary benchmark (network)", () => {
  it(
    "scores the current engine against the public fixture set",
    async () => {
      const fixtures = loadFixtures();
      expect(fixtures.length).toBeGreaterThan(0);
      const engine =
        process.env.BOUNDARY_ENGINE === "fused" ? "fused" : "legacy";
      console.log(`engine: ${engine}\n`);

      const rows: Array<{
        fixture: PublicFixture;
        sample: BoundaryBenchmarkSample;
        candidateSources: string[];
        reasons: string[];
      }> = [];

      for (const [position, fixture] of fixtures.entries()) {
        // Sequential and paced on purpose: these are shared public services.
        if (DELAY_MS > 0 && position > 0) await sleep(DELAY_MS);
        const boundary = await detectBoundary(fixture.lat, fixture.lon);
        // Which sources actually produced a usable geometry. Without this a run
        // in which Overpass was unreachable looks identical to one in which OSM
        // was consulted and lost — and those demand opposite conclusions.
        const candidateSources = [
          ...new Set((boundary.candidates ?? []).map((c) => c.provider ?? c.source)),
        ].sort();
        rows.push({
          fixture,
          sample: {
            id: fixture.id,
            reference: fixture.reference,
            predicted: boundary.polygon,
            predictedSource: boundary.source,
            predictedConfidence: boundary.confidence,
          },
          candidateSources,
          reasons: boundary.quality?.reasons ?? [],
        });
        console.log(
          `${fixture.id.padEnd(20)} ${String(boundary.source).padEnd(10)} ` +
            `${String(boundary.role ?? "-").padEnd(16)} ` +
            `${Math.round(boundary.areaSqm).toString().padStart(7)} m² ` +
            `(ref ${fixture.areaSqm} m²) conf ${boundary.confidence.toFixed(2)}` +
            `${boundary.reviewRequired ? " REVIEW" : ""}` +
            `  [${candidateSources.join(",") || "no candidates"}]`,
        );
      }

      const all = evaluateBoundaryBenchmark(
        rows.map((r) => r.sample),
        { dataset: `boundary-public-v1/${engine}` },
      );
      const tuning = evaluateBoundaryBenchmark(
        rows.filter((r) => !r.fixture.holdout).map((r) => r.sample),
        { dataset: "boundary-public-v1/tuning" },
      );
      const holdout = evaluateBoundaryBenchmark(
        rows.filter((r) => r.fixture.holdout).map((r) => r.sample),
        { dataset: "boundary-public-v1/holdout" },
      );

      table("ALL", all);
      table("TUNING", tuning);
      table("HOLD-OUT (decides whether a change is an improvement)", holdout);

      const bySource = new Map<string, number>();
      for (const row of rows) {
        const key = row.sample.predictedSource ?? "unknown";
        bySource.set(key, (bySource.get(key) ?? 0) + 1);
      }
      console.log(
        `\nwinning source: ${[...bySource]
          .map(([source, count]) => `${source}=${count}`)
          .join(" ")}`,
      );

      const contributed = new Map<string, number>();
      for (const row of rows) {
        for (const source of row.candidateSources) {
          contributed.set(source, (contributed.get(source) ?? 0) + 1);
        }
      }
      console.log(
        `sites with a candidate per provider: ${[...contributed]
          .sort()
          .map(([source, count]) => `${source}=${count}/${rows.length}`)
          .join(" ")}`,
      );

      mkdirSync(dirname(OUTPUT), { recursive: true });
      writeFileSync(
        OUTPUT,
        `${JSON.stringify(
          {
            engine,
            all,
            tuning,
            holdout,
            providerContribution: Object.fromEntries(
              [...contributed].sort().map(([source, count]) => [
                source,
                { sites: count, of: rows.length },
              ]),
            ),
            perSample: rows.map((r) => ({
              id: r.fixture.id,
              state: r.fixture.state,
              holdout: r.fixture.holdout,
              cadastreAvailable: r.fixture.cadastreAvailable,
              source: r.sample.predictedSource,
              confidence: r.sample.predictedConfidence,
              candidateSources: r.candidateSources,
              reasons: r.reasons,
            })),
          },
          null,
          2,
        )}\n`,
      );
      console.log(`\nwrote ${OUTPUT}`);

      // A guard, not a target: zero overlap everywhere means the harness broke,
      // not that the engine regressed.
      expect(all.evaluatedSamples).toBe(rows.length);
    },
    30 * 60 * 1000,
  );

  it.skipIf(!process.env.BOUNDARY_GROUNDTRUTH)(
    "scores manual corrections separately (biased sample)",
    () => {
      const path = resolve(process.env.BOUNDARY_GROUNDTRUTH!);
      const file = JSON.parse(readFileSync(path, "utf8")) as {
        samples: BoundaryBenchmarkSample[];
      };
      const result = evaluateBoundaryBenchmark(file.samples, {
        dataset: "boundary-groundtruth-local",
      });
      table("MANUAL CORRECTIONS (biased: only noticed failures)", result);
      expect(result.evaluatedSamples).toBe(file.samples.length);
    },
  );
});
