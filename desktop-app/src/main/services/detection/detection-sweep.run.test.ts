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
 * Tiles are scored whole (640 px at the model's gsdM); the boundary clip and
 * roof mask are not applied, so the in-app count can be a little lower.
 */
import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { describe, expect, it } from "vitest";
import { evaluateDetectionBenchmark } from "../detection-benchmark";
import { parseVehicleModelManifest } from "@shared/model-manifest";
import { inferWindow } from "./onnx-infer";

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
      for (const file of tiles) {
        const stem = file.replace(/\.jpg$/, "");
        const site = stem.split("__")[0];
        if (/neg/.test(site)) continue; // hard negatives: no count metric
        const labels = readFileSync(join(labelDir, `${stem}.txt`), "utf8")
          .split("\n")
          .filter((l) => l.trim()).length;
        expected.set(site, (expected.get(site) ?? 0) + labels);

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

      const sites = [...expected.keys()].sort();
      const total = sites.reduce((sum, s) => sum + expected.get(s)!, 0);
      const rows = THRESHOLDS.map((threshold) => {
        const counts = predicted.get(threshold)!;
        const samples = sites.map((id) => ({
          id,
          expectedCount: expected.get(id)!,
          predictedCount: counts.get(id) ?? 0,
        }));
        const result = evaluateDetectionBenchmark(samples, "training-val");
        const bias =
          samples.reduce((s, x) => s + x.predictedCount - x.expectedCount, 0) /
          (total || 1);
        return {
          conf: threshold,
          mae: result.countMae,
          bias: Math.round(bias * 10_000) / 10_000,
          within10: result.within10PctRate,
        };
      });

      console.table(
        rows.map((r) => ({
          conf: r.conf.toFixed(2),
          MAE: r.mae.toFixed(1),
          bias: `${(r.bias * 100).toFixed(1)} %`,
          "within 10 %": `${Math.round(r.within10 * 100)} %`,
        })),
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
            },
            null,
            1,
          ),
        );
      }
      expect(rows).toHaveLength(THRESHOLDS.length);
    },
    30 * 60 * 1000,
  );
});
