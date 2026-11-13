/**
 * Opt-in boundary benchmark runner.
 *
 * Skipped by default: it talks to the state cadastre services and the imagery
 * provider and runs the vehicle model, so it must never gate CI. Run it
 * deliberately:
 *
 *   npm run benchmark:boundary
 *   BOUNDARY_BENCHMARK_LIMIT=5 BOUNDARY_BENCHMARK_DELAY_MS=8000 npm run benchmark:boundary
 *   BOUNDARY_GROUNDTRUTH=~/.dealership-risk/benchmarks/boundary-groundtruth.local.json \
 *     npm run benchmark:boundary
 *   BOUNDARY_BENCHMARK_DUMP=/tmp/boundary-inputs.json npm run benchmark:boundary
 *     (then replay offline: BOUNDARY_REPLAY=/tmp/boundary-inputs.json
 *      npm run benchmark:boundary:replay)
 *
 * It reports the tuning and hold-out strata separately. The hold-out stratum is
 * the one that decides whether a change is an improvement — tuning against the
 * same sites you measure on produces numbers that only describe themselves.
 *
 * Each site runs like an analysis in the app: context image → vehicle
 * detection → roof mask → boundary. Imagery follows the app's default
 * ("auto": official DOP where a state publishes it); before November 2026
 * the runner forced Esri, so it measured a configuration the app does not
 * use. `BOUNDARY_BENCHMARK_IMAGERY=esri` reproduces the old setting. The
 * model is loaded from the app's data directory
 * (`BOUNDARY_BENCHMARK_USERDATA` overrides it) and runs in-process instead of
 * in a utilityProcess. OSM is treated as not cached, which is what the app sees
 * while the public Overpass servers are at capacity; the reference polygons
 * are OSM dealer areas, so using OSM here would also grade OSM against itself.
 *
 * The SQLite cache and settings are replaced with in-memory stubs so the run
 * needs no Electron app directory, and so a re-run inside one session reuses
 * responses instead of hammering public services.
 */
import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
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

vi.mock("../cache.service", async () => ({
  cacheGet: stubs.cacheGet,
  cacheSet: stubs.cacheSet,
  cached: stubs.cached,
  cacheKeyFragment: (value: string) =>
    createHash("sha1").update(value).digest("hex").slice(0, 10),
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
    satelliteProvider: (process.env.BOUNDARY_BENCHMARK_IMAGERY ?? "auto") as
      "auto" | "esri",
  }),
}));

vi.mock("./osm-evidence.service", () => ({
  osmEvidenceBy: async () => ({ evidence: null, status: "pending" }),
  fetchOsmEvidence: async () => null,
}));

/**
 * In-process stand-in for the inference utilityProcess: same protocol, same
 * window inference (`detection/onnx-infer.ts`), plain Node.
 */
vi.mock("electron", async () => {
  const { homedir } = await import("node:os");
  const { join } = await import("node:path");
  const userData =
    process.env.BOUNDARY_BENCHMARK_USERDATA ??
    join(homedir(), "Library/Application Support/Dealership Risk Mapping");
  return {
    app: { getPath: () => userData, getAppPath: () => userData },
    utilityProcess: {
      fork: () => {
        const listeners: Array<(message: unknown) => void> = [];
        const emit = (message: unknown): void => {
          setImmediate(() =>
            listeners.forEach((listener) => listener(message)),
          );
        };
        let ready: Promise<{
          ort: typeof import("onnxruntime-node");
          session: import("onnxruntime-node").InferenceSession;
          manifest: import("@shared/model-manifest").VehicleModelManifest;
        }> | null = null;
        return {
          on(event: string, listener: (message: unknown) => void) {
            if (event === "message") listeners.push(listener);
          },
          postMessage(message: Record<string, unknown>) {
            if (message.type === "init") {
              ready = (async () => {
                const ort = await import("onnxruntime-node");
                const session = await ort.InferenceSession.create(
                  message.modelPath as string,
                  { executionProviders: ["cpu"] },
                );
                return {
                  ort,
                  session,
                  manifest:
                    message.manifest as import("@shared/model-manifest").VehicleModelManifest,
                };
              })();
              ready.then(
                () => emit({ type: "ready" }),
                (error: unknown) =>
                  emit({ type: "error", error: String(error) }),
              );
              return;
            }
            void (async () => {
              const { inferWindow } = await import("../detection/onnx-infer");
              try {
                const { ort, session, manifest } = await ready!;
                const detections = await inferWindow(
                  ort,
                  session,
                  manifest,
                  message as unknown as import("../detection/onnx-infer").InferWindow,
                );
                emit({ type: "result", id: message.id, detections });
              } catch (error) {
                emit({ type: "result", id: message.id, error: String(error) });
              }
            })();
          },
          kill() {
            // Nothing to stop: inference runs in this process.
          },
        };
      },
    },
  };
});

import type { Polygon } from "@shared/types";
import {
  evaluateBoundaryBenchmark,
  type BoundaryBenchmarkResult,
  type BoundaryBenchmarkSample,
} from "../boundary-benchmark";
import { detectBoundary } from "../boundary.service";
import { DEFAULT_RISK_PARAMETERS } from "@shared/parameters";
import {
  detectVehiclesInContext,
  isModelAvailable,
} from "../detection.service";
import { aerialImageForContext } from "../tiles.service";
import { maskRoofDetections } from "../detection/roof-mask.service";
import { CASCADE_VERSION } from "./cascade";
import type { ReplaySample } from "./boundary-replay";
import type { LonLat } from "../boundary-geometry";

interface PublicFixture {
  id: string;
  osmType: "way" | "relation";
  osmId: number;
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
const OUTPUT = resolve(
  __dirname,
  "../../../../coverage/boundary-benchmark.json",
);

const enabled = Boolean(process.env.BOUNDARY_BENCHMARK);

/** Optional pause between sites, to go easy on the public services. */
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
      // Without the model every site would fall back to the parcel or circle,
      // which measures nothing about the cascade.
      expect(isModelAvailable()).toBe(true);
      const variant = `cascade-v${CASCADE_VERSION}/${process.env.BOUNDARY_BENCHMARK_IMAGERY ?? "auto"}`;
      console.log(`engine: ${variant}\n`);

      const dump: unknown[] = [];
      const rows: Array<{
        fixture: PublicFixture;
        sample: BoundaryBenchmarkSample;
        candidateSources: string[];
        reasons: string[];
      }> = [];

      for (const [position, fixture] of fixtures.entries()) {
        // Sequential and paced on purpose: these are shared public services.
        if (DELAY_MS > 0 && position > 0) await sleep(DELAY_MS);
        const image = await aerialImageForContext(fixture.lat, fixture.lon);
        // As in the analysis: roofs masked before the boundary sees vehicles.
        const detection = await maskRoofDetections(
          await detectVehiclesInContext(image, DEFAULT_RISK_PARAMETERS),
          fixture.lat,
          fixture.lon,
        );
        const vehicles: LonLat[] | null = detection.boxes
          ? detection.boxes.flatMap((box) =>
              box.lon == null || box.lat == null
                ? []
                : [[box.lon, box.lat] as LonLat],
            )
          : null;
        if (process.env.BOUNDARY_BENCHMARK_DUMP) {
          // Frozen inputs for `boundary-replay.run.test.ts`.
          const { fetchParcelsNear } = await import("../alkis.service");
          const { fetchOfficialBuildings } =
            await import("../alkis-buildings.service");
          const parcels = await fetchParcelsNear(
            fixture.lat,
            fixture.lon,
          ).catch(() => null);
          const official = await fetchOfficialBuildings(
            fixture.lat,
            fixture.lon,
          );
          const sample: ReplaySample = {
            id: fixture.id,
            holdout: fixture.holdout,
            anchor: [fixture.lon, fixture.lat],
            reference: fixture.reference,
            vehicles,
            parcels: parcels?.parcels ?? [],
            parcelsTruncated: parcels?.truncated ?? false,
            buildings: official.buildings.map((building) => building.ring),
          };
          dump.push(sample);
        }
        const boundary = await detectBoundary(
          fixture.lat,
          fixture.lon,
          undefined,
          undefined,
          DEFAULT_RISK_PARAMETERS,
          vehicles,
          { osmDeadline: Date.now() },
        );
        // Which sources actually produced a usable geometry. Without this a run
        // in which Overpass was unreachable looks identical to one in which OSM
        // was consulted and lost — and those demand opposite conclusions.
        const candidateSources = [
          ...new Set(
            (boundary.candidates ?? []).map((c) => c.provider ?? c.source),
          ),
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
            `${boundary.quality?.cascadeStage ? ` stage ${boundary.quality.cascadeStage}` : ""}` +
            ` vehicles ${vehicles?.length ?? "-"}` +
            `  [${candidateSources.join(",") || "no candidates"}]`,
        );
        // Why each stage accepted or declined, and which sources were down.
        for (const reason of boundary.quality?.reasons ?? []) {
          console.log(`    ${reason}`);
        }
      }

      const all = evaluateBoundaryBenchmark(
        rows.map((r) => r.sample),
        { dataset: `boundary-public-v1/${variant}` },
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
      if (process.env.BOUNDARY_BENCHMARK_DUMP) {
        writeFileSync(
          process.env.BOUNDARY_BENCHMARK_DUMP,
          JSON.stringify(dump),
        );
      }
      writeFileSync(
        OUTPUT,
        `${JSON.stringify(
          {
            engine: variant,
            all,
            tuning,
            holdout,
            providerContribution: Object.fromEntries(
              [...contributed]
                .sort()
                .map(([source, count]) => [
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
              iou: evaluateBoundaryBenchmark([r.sample]).meanIoU,
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
    // Public services can be slow; a full run over all sites may need longer.
    Number(process.env.BOUNDARY_BENCHMARK_TIMEOUT_MIN ?? 30) * 60 * 1000,
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
