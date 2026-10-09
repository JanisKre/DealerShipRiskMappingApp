import { z } from "zod";
import { VehicleClassSchema } from "./types";

/**
 * Sidecar manifest describing a vehicle-detection ONNX model
 * (`<model>.json` next to `<model>.onnx`). It tells the inference worker how
 * to read the model's output and at which ground resolution the model was
 * trained, so a retrained model can be swapped in without code changes.
 * `training/export.py` writes it; see docs/detection-benchmark.md.
 */

// JSON object keys are strings; class indices are parsed back to numbers.
const ClassIndexKey = z.string().regex(/^\d+$/);

export const VehicleModelManifestSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().min(1).max(120),
  version: z.string().min(1).max(120),
  /** `detect`: axis-aligned boxes. `obb`: oriented boxes with an angle. */
  task: z.enum(["detect", "obb"]),
  /**
   * `raw`: Ultralytics head output `[1, 4 + nc (+1 angle), N]`, NMS in the app.
   * `end2end`: NMS-free output `[1, N, 6]` (x1,y1,x2,y2,score,cls) or
   * `[1, N, 7]` for obb (cx,cy,w,h,score,cls,angle).
   */
  outputFormat: z.enum(["raw", "end2end"]).default("raw"),
  /** Square model input size in pixels. */
  imgsz: z.number().int().min(160).max(2048),
  /** Ground resolution (m/px) the model was trained at; imagery is resampled to it. */
  gsdM: z.number().min(0.03).max(0.6),
  /** All model classes, index → name. */
  classes: z.record(ClassIndexKey, z.string()),
  /** Which model classes count as vehicles, index → product vehicle class. */
  vehicleClasses: z
    .record(ClassIndexKey, VehicleClassSchema)
    .refine((m) => Object.keys(m).length > 0, "no vehicle classes"),
  /** Added to the user's base confidence threshold, per model class. */
  classOffsets: z
    .record(ClassIndexKey, z.number().min(-0.5).max(0.5))
    .default({}),
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  trainingData: z.array(z.string()).default([]),
  license: z.string().optional(),
  limitations: z.array(z.string()).default([]),
});
export type VehicleModelManifest = z.infer<typeof VehicleModelManifestSchema>;

/**
 * Built-in description of the original VisDrone-trained model, used when no
 * sidecar manifest exists. VisDrone is low-altitude, often oblique drone
 * footage — not nadir orthophotos — which is a known accuracy limit.
 */
export const LEGACY_VISDRONE_MANIFEST: VehicleModelManifest = {
  schemaVersion: 1,
  name: "yolov26s_aerial_vehicles",
  version: "visdrone-2026-09-11",
  task: "detect",
  outputFormat: "raw",
  imgsz: 640,
  gsdM: 0.1,
  classes: {
    "0": "pedestrian",
    "1": "people",
    "2": "bicycle",
    "3": "car",
    "4": "van",
    "5": "truck",
    "6": "tricycle",
    "7": "awning-tricycle",
    "8": "bus",
    "9": "motor",
    "10": "others",
  },
  vehicleClasses: { "3": "car", "4": "van", "5": "truck", "8": "bus" },
  // Large vehicles score high; requiring a bit more keeps building edges
  // and containers from being counted as trucks.
  classOffsets: { "3": 0, "4": 0.02, "5": 0.13, "8": 0.06 },
  trainingData: ["VisDrone2019-DET (low-altitude, partly oblique drone video)"],
  license: "AGPL-3.0 (Ultralytics)",
  limitations: [
    "Model trained on drone video, not nadir orthophotos; dense parking rows may be under-counted",
  ],
};

/** Parses a manifest file's JSON, returning null when it is not a valid manifest. */
export function parseVehicleModelManifest(
  json: unknown,
): VehicleModelManifest | null {
  const parsed = VehicleModelManifestSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}
