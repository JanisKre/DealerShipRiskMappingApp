/**
 * Threshold sweep of a vehicle model through the app's own window inference
 * (`inferWindow`: letterbox, decoding, per-class offsets, size filter, hard
 * NMS) on the held-out validation tiles of `training/`. This is the number
 * a manifest's `defaultConfidence` is chosen from (docs/detection-benchmark.md,
 * "Model default threshold"). It reads local, git-ignored training data and
 * is skipped unless DETECTION_SWEEP_MODEL is set:
 *
 *   DETECTION_SWEEP_MODEL=../training/export/dealer_vehicles.onnx \
 *   DETECTION_SWEEP_TILES=../training/data/dataset \
 *   DETECTION_SWEEP_JSON=/tmp/sweep.json npm run benchmark:detection
 *
 * Two pipelines are scored. "tiles" runs each 640 px tile on its own, as the
 * model saw it in training. "mosaic" is the app's path: the n×n tiles of a
 * site are stitched into one image, cut into the detector's overlapping
 * windows (`planCrops`, `windowStride`) and merged with the mosaic NMS, so a
 * vehicle on a tile seam is counted once; its ground truth joins the two
 * clipped labels of such a vehicle (`countMosaicLabels`). The boundary clip
 * and roof mask are not applied in either, so the in-app count can be a
 * little lower. Every MAE comes with a seeded 90 % bootstrap interval over
 * sites.
 */
import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { describe, expect, it } from "vitest";
import {
  bootstrapMaeInterval,
  countMosaicLabels,
  evaluateDetectionBenchmark,
  type DetectionBenchmarkSample,
  type TileLabel,
} from "../detection-benchmark";
import { parseVehicleModelManifest } from "@shared/model-manifest";
import { inferWindow } from "./onnx-infer";
import {
  nms,
  nmsOptionsFor,
  planCrops,
  windowStride,
  type VehicleCandidate,
} from "./yolo";

const modelPath = process.env.DETECTION_SWEEP_MODEL;
const THRESHOLDS = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6];

describe.skipIf(!modelPath)("detection threshold sweep (local data)", () => {
  it(
    "counts vehicles per held-out site at each base confidence",
    async () => {
      const ort = await import("onnxruntime-node");
      const sharp = (await import("sharp")).default;
      const model = resolve(modelPath!);
      const manifest = parseVehicleModelManifest(
        JSON.parse(readFileSync(model.replace(/\.onnx$/, ".json"), "utf8")),
      );
      if (!manifest) throw new Error(`no valid manifest next to ${model}`);
      const session = await ort.InferenceSession.create(model, {
        executionProviders: ["cpu"],
      });
      const dataset = resolve(
        process.env.DETECTION_SWEEP_TILES ?? "../training/data/dataset",
      );
      const imageDir = join(dataset, "images", "val");
      const labelDir = join(dataset, "labels", "val");
      const tiles = readdirSync(imageDir)
        .filter((f) => f.endsWith(".jpg"))
        .sort();
      expect(tiles.length).toBeGreaterThan(0);

      const expected = new Map<string, number>();
      const predicted = new Map<number, Map<string, number>>(
        THRESHOLDS.map((t) => [t, new Map()]),
      );
      const siteTiles = new Map<
        string,
        Array<{ row: number; col: number; file: string }>
      >();
      const siteLabels = new Map<string, TileLabel[]>();
      for (const file of tiles) {
        const stem = file.replace(/\.jpg$/, "");
        const site = stem.split("__")[0];
        if (/neg/.test(site)) continue; // hard negatives: no count metric
        const lines = readFileSync(join(labelDir, `${stem}.txt`), "utf8")
          .split("\n")
          .filter((l) => l.trim());
        expected.set(site, (expected.get(site) ?? 0) + lines.length);
        const cell = /__(\d+)_(\d+)$/.exec(stem);
        if (cell) {
          const row = Number(cell[1]);
          const col = Number(cell[2]);
          siteTiles.set(site, [
            ...(siteTiles.get(site) ?? []),
            { row, col, file },
          ]);
          siteLabels.set(site, [
            ...(siteLabels.get(site) ?? []),
            ...lines.map((line) => ({
              row,
              col,
              corners: line.trim().split(/\s+/).slice(1).map(Number),
            })),
          ]);
        }

        const { data, info } = await sharp(join(imageDir, file))
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        for (const threshold of THRESHOLDS) {
          const detections = await inferWindow(ort, session, manifest, {
            pixels: new Uint8ClampedArray(data),
            width: info.width,
            height: info.height,
            confidenceThreshold: threshold,
            metersPerPixel: manifest.gsdM,
          });
          const counts = predicted.get(threshold)!;
          counts.set(site, (counts.get(site) ?? 0) + detections.length);
        }
      }

      // The app's path: one mosaic per site, sliced and merged like the
      // detector does it. Only complete n×n grids qualify.
      const mosaicExpected = new Map<string, number>();
      const mosaicPredicted = new Map<number, Map<string, number>>(
        THRESHOLDS.map((t) => [t, new Map()]),
      );
      const tilePx = 640;
      for (const [site, tiles] of siteTiles) {
        const n = Math.max(...tiles.map((t) => Math.max(t.row, t.col))) + 1;
        if (tiles.length !== n * n) continue;
        mosaicExpected.set(site, countMosaicLabels(siteLabels.get(site) ?? []));
        const width = n * tilePx;
        const { data: mosaic } = await sharp({
          create: {
            width,
            height: width,
            channels: 4,
            background: { r: 128, g: 128, b: 128, alpha: 1 },
          },
        })
          .composite(
            tiles.map((t) => ({
              input: join(imageDir, t.file),
              left: t.col * tilePx,
              top: t.row * tilePx,
            })),
          )
          .raw()
          .toBuffer({ resolveWithObject: true });
        const window = manifest.imgsz;
        const crops = planCrops(
          width,
          width,
          window,
          windowStride(window, manifest.gsdM),
        );
        for (const threshold of THRESHOLDS) {
          const candidates: VehicleCandidate[] = [];
          for (const c of crops) {
            const crop = new Uint8ClampedArray(c.w * c.h * 4);
            for (let y = 0; y < c.h; y++) {
              const from = ((c.cropY + y) * width + c.cropX) * 4;
              crop.set(mosaic.subarray(from, from + c.w * 4), y * c.w * 4);
            }
            const detections = await inferWindow(ort, session, manifest, {
              pixels: crop,
              width: c.w,
              height: c.h,
              confidenceThreshold: threshold,
              metersPerPixel: manifest.gsdM,
            });
            for (const d of detections) {
              candidates.push({ ...d, cx: d.cx + c.cropX, cy: d.cy + c.cropY });
            }
          }
          mosaicPredicted
            .get(threshold)!
            .set(site, nms(candidates, nmsOptionsFor(manifest.task)).length);
        }
      }

      const score = (
        truth: Map<string, number>,
        counted: Map<number, Map<string, number>>,
      ): Array<{
        conf: number;
        mae: number;
        maeInterval: { low: number; high: number };
        bias: number;
        within10: number;
      }> => {
        const ids = [...truth.keys()].sort();
        const vehicles = ids.reduce((sum, s) => sum + truth.get(s)!, 0);
        return THRESHOLDS.map((threshold) => {
          const counts = counted.get(threshold)!;
          const samples: DetectionBenchmarkSample[] = ids.map((id) => ({
            id,
            expectedCount: truth.get(id)!,
            predictedCount: counts.get(id) ?? 0,
          }));
          const result = evaluateDetectionBenchmark(samples, "training-val");
          const bias =
            samples.reduce(
              (s, x) => s + x.predictedCount - x.expectedCount,
              0,
            ) / (vehicles || 1);
          return {
            conf: threshold,
            mae: result.countMae,
            maeInterval: bootstrapMaeInterval(samples),
            bias: Math.round(bias * 10_000) / 10_000,
            within10: result.within10PctRate,
          };
        });
      };
      const sites = [...expected.keys()].sort();
      const total = sites.reduce((sum, s) => sum + expected.get(s)!, 0);
      const rows = score(expected, predicted);
      const mosaicRows = score(mosaicExpected, mosaicPredicted);
      const mosaicVehicles = [...mosaicExpected.values()].reduce(
        (a, b) => a + b,
        0,
      );

      const show = (title: string, table: typeof rows): void => {
        console.log(title);
        console.table(
          table.map((r) => ({
            conf: r.conf.toFixed(2),
            MAE: r.mae.toFixed(1),
            "90 % interval": `${r.maeInterval.low.toFixed(1)}–${r.maeInterval.high.toFixed(1)}`,
            bias: `${(r.bias * 100).toFixed(1)} %`,
            "within 10 %": `${Math.round(r.within10 * 100)} %`,
          })),
        );
      };
      show(`tiles: ${sites.length} sites, ${total} labelled boxes`, rows);
      show(
        `mosaic (app pipeline): ${mosaicExpected.size} sites, ${mosaicVehicles} vehicles`,
        mosaicRows,
      );
      if (process.env.DETECTION_SWEEP_JSON) {
        writeFileSync(
          process.env.DETECTION_SWEEP_JSON,
          JSON.stringify(
            {
              pipeline: "app-inferWindow",
              run: process.env.DETECTION_SWEEP_RUN ?? null,
              model: manifest.name,
              version: manifest.version,
              sha256: manifest.sha256 ?? null,
              sites: sites.length,
              vehicles: total,
              date: new Date().toISOString(),
              thresholds: rows,
              mosaic: {
                pipeline: "app-mosaic-windows-nms",
                sites: mosaicExpected.size,
                vehicles: mosaicVehicles,
                thresholds: mosaicRows,
              },
            },
            null,
            1,
          ),
        );
      }
      expect(rows).toHaveLength(THRESHOLDS.length);
      expect(mosaicExpected.size).toBeGreaterThan(0);
    },
    30 * 60 * 1000,
  );
});
