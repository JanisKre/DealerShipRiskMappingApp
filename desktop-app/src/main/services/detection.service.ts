import { basename, join } from "path";
import { app, utilityProcess, type UtilityProcess } from "electron";
import { existsSync, readFileSync } from "fs";
import sharp from "sharp";
import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import { point as turfPoint } from "@turf/helpers";
import type {
  BoundaryResult,
  DetectionBox,
  DetectionResult,
  VehicleClass,
} from "@shared/types";
import { DETECTION_WINDOW_OVERLAP } from "@shared/constants";
import {
  describeImagerySelection,
  type ImagerySelection,
} from "@shared/imagery-sources";
import {
  LEGACY_VISDRONE_MANIFEST,
  parseVehicleModelManifest,
  type VehicleModelManifest,
} from "@shared/model-manifest";
import type { AerialCapture } from "./tiles.service";
import { DEFAULT_RISK_PARAMETERS } from "@shared/parameters";
import type { RiskParameters } from "@shared/types";
import {
  coarseImageryLimitations,
  hullSize,
  mosaicMetersPerPixel,
  nms,
  nmsOptionsFor,
  planCrops,
  resampleFactor,
  type VehicleCandidate,
} from "./detection/yolo";

/**
 * Swappable detector interface. The ONNX model itself is described by a
 * sidecar manifest (see @shared/model-manifest), so retrained models swap in
 * without changing calling code.
 */
export interface VehicleDetector {
  readonly modelName: string;
  detect(
    image: AerialImage,
    boundary?: BoundaryResult,
    parameters?: RiskParameters,
  ): Promise<DetectionResult>;
}

export interface AerialImage {
  rgba: Uint8Array | null; // raw pixel buffer (RGBA); null when no image is available
  width: number;
  height: number;
  /** Geo bounds of the image: [west, south, east, north] */
  bbox: [number, number, number, number];
}

// --- Raw worker types --------------------------------------------------------

interface WorkerResult {
  type: "result";
  id: string;
  /** Candidates in crop pixels. */
  detections?: VehicleCandidate[];
  inferenceMs?: number;
  error?: string;
}

// --- Model path --------------------------------------------------------------

/** Filename of the downloadable ONNX model — used by the installation wizard. */
export const MODEL_FILENAME = "yolov26s_aerial_vehicles.onnx";

/**
 * Filename `training/export.py --install` gives a locally fine-tuned model.
 * Preferred over the downloadable model when present; it must ship with a
 * `<name>.json` manifest.
 */
export const TRAINED_MODEL_FILENAME = "dealer_vehicles.onnx";

/** Directory the installation wizard downloads the model into (survives updates). */
export function modelsDir(): string {
  return join(app.getPath("userData"), "models");
}

function manifestPathFor(modelPath: string): string {
  return modelPath.replace(/\.onnx$/i, ".json");
}

/**
 * Reads the sidecar manifest for a model. The legacy VisDrone model may lack
 * one and gets the built-in description; any other model without a valid
 * manifest is unusable because its output layout is unknown.
 */
export function loadModelManifest(
  modelPath: string,
): VehicleModelManifest | null {
  const manifestPath = manifestPathFor(modelPath);
  if (existsSync(manifestPath)) {
    try {
      return parseVehicleModelManifest(
        JSON.parse(readFileSync(manifestPath, "utf8")),
      );
    } catch {
      return null;
    }
  }
  return basename(modelPath) === MODEL_FILENAME
    ? LEGACY_VISDRONE_MANIFEST
    : null;
}

interface ResolvedModel {
  path: string;
  manifest: VehicleModelManifest;
}

function resolveModel(): ResolvedModel | null {
  // userData/models first: that's where the installation wizard and
  // `training/export.py --install` place models. Then packaged
  // extraResources (resources/models) and the repo-local dev copy.
  const dirs = [
    modelsDir(),
    join(process.resourcesPath ?? "", "models"),
    join(app.getAppPath(), "resources", "models"),
    join(app.getAppPath(), "..", "resources", "models"),
  ];
  for (const filename of [TRAINED_MODEL_FILENAME, MODEL_FILENAME]) {
    for (const dir of dirs) {
      const path = join(dir, filename);
      if (!existsSync(path)) continue;
      const manifest = loadModelManifest(path);
      if (manifest) return { path, manifest };
    }
  }
  return null;
}

function resolveWorkerPath(): string {
  return join(__dirname, "onnx-inference.worker.cjs");
}

// --- Helpers -----------------------------------------------------------------

/** Brings the mosaic to the model's training resolution (see resampleFactor). */
async function resampleRgba(
  rgba: Uint8Array,
  width: number,
  height: number,
  factor: number,
): Promise<{ rgba: Uint8Array; width: number; height: number }> {
  if (factor === 1) return { rgba, width, height };
  const newW = Math.max(1, Math.round(width * factor));
  const newH = Math.max(1, Math.round(height * factor));
  const buf = await sharp(rgba, { raw: { width, height, channels: 4 } })
    .resize(newW, newH, {
      fit: "fill",
      kernel: factor > 1 ? "cubic" : "lanczos3",
    })
    .raw()
    .toBuffer();
  return { rgba: new Uint8Array(buf), width: newW, height: newH };
}

function emptyCounts(): Record<VehicleClass, number> {
  return { car: 0, van: 0, truck: 0, bus: 0 };
}

// --- ONNX detector -------------------------------------------------------

/**
 * YOLO ONNX detector (axis-aligned or oriented boxes, per manifest). Spawns a
 * persistent utilityProcess, resamples the RGBA mosaic to the model's
 * training resolution, slices it into overlapping full-size windows, runs
 * inference, deduplicates with hard NMS, clips to the boundary polygon, and
 * converts the centers to lon/lat.
 */
export class OnnxYoloDetector implements VehicleDetector {
  readonly modelName: string;
  private proc: UtilityProcess | null = null;
  private ready: Promise<void> | null = null;
  private readonly modelPath: string;
  private readonly manifest: VehicleModelManifest;
  private seq = 0;
  private readonly pending = new Map<
    string,
    { resolve: (r: WorkerResult) => void; reject: (e: Error) => void }
  >();

  constructor(modelPath: string, manifest: VehicleModelManifest) {
    this.modelPath = modelPath;
    this.manifest = manifest;
    this.modelName = manifest.name;
  }

  private ensureStarted(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      const proc = utilityProcess.fork(resolveWorkerPath());
      this.proc = proc;
      let initialized = false;

      proc.on(
        "message",
        (msg: WorkerResult | { type: string; error?: string }) => {
          if (msg.type === "ready") {
            initialized = true;
            resolve();
            return;
          }
          if (msg.type === "error" && !initialized) {
            reject(new Error(msg.error ?? "Worker init failed"));
            return;
          }
          if (msg.type === "result") {
            const res = msg as WorkerResult;
            const entry = this.pending.get(res.id);
            if (entry) {
              this.pending.delete(res.id);
              entry.resolve(res);
            }
          }
        },
      );

      proc.on("exit", () => {
        this.proc = null;
        this.ready = null;
        for (const [, entry] of this.pending)
          entry.reject(new Error("Worker exited"));
        this.pending.clear();
      });

      proc.postMessage({
        type: "init",
        modelPath: this.modelPath,
        manifest: this.manifest,
      });
    });
    return this.ready;
  }

  private runWindow(
    pixels: Uint8ClampedArray,
    width: number,
    height: number,
    confidenceThreshold: number,
    metersPerPixel: number,
  ): Promise<WorkerResult> {
    const id = `${this.seq++}`;
    return new Promise<WorkerResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc!.postMessage({
        type: "infer",
        id,
        pixels,
        width,
        height,
        confidenceThreshold,
        metersPerPixel,
      });
    });
  }

  async detect(
    image: AerialImage,
    boundary?: BoundaryResult,
    parameters: RiskParameters = DEFAULT_RISK_PARAMETERS,
  ): Promise<DetectionResult> {
    if (!image.rgba || image.width === 0 || image.height === 0) {
      return {
        vehicleCount: 0,
        confidence: 0,
        model: this.modelName,
        classCounts: emptyCounts(),
        evidence: {
          source: "aerial imagery",
          retrievedAt: new Date().toISOString(),
          method: "no image available",
          confidence: 0,
          fallbackUsed: true,
          limitations: ["No aerial image was available for inference"],
        },
      };
    }
    await this.ensureStarted();

    // Bring the imagery to the model's training resolution, so vehicles have
    // the pixel size the model learned regardless of zoom 19/20 or DOP source.
    // Boxes stay in normalized mosaic coordinates, so georeferencing below is
    // unaffected by the resample.
    const sourceMpp = mosaicMetersPerPixel(image as AerialCapture);
    const factor = resampleFactor(sourceMpp, this.manifest.gsdM);
    const { rgba, width, height } = await resampleRgba(
      image.rgba,
      image.width,
      image.height,
      factor,
    );
    const metersPerPixel = (sourceMpp * image.width) / width;
    // Real detail of the scene: tiles can be upsampled from coarser imagery,
    // so the source's published resolution counts, not just the tile zoom.
    const sourceResolutionM = Math.max(
      sourceMpp,
      (image as AerialCapture).imagery?.chosen.resolutionM ?? 0,
    );

    const window = this.manifest.imgsz;
    const stride = Math.round(window * (1 - DETECTION_WINDOW_OVERLAP));
    const allCandidates: VehicleCandidate[] = [];
    let totalInferenceMs = 0;

    // Windows sequentially (single-session worker); inference itself is the
    // bottleneck, not the JS slicing.
    for (const c of planCrops(width, height, window, stride)) {
      const cropBuf = this.extractCrop(rgba, width, c.cropX, c.cropY, c.w, c.h);
      const res = await this.runWindow(
        cropBuf,
        c.w,
        c.h,
        parameters.detectionConfidence,
        metersPerPixel,
      );
      if (res.error || !res.detections) continue;
      totalInferenceMs += res.inferenceMs ?? 0;
      for (const d of res.detections) {
        allCandidates.push({ ...d, cx: d.cx + c.cropX, cy: d.cy + c.cropY });
      }
    }

    // Overlapping windows see the same vehicle twice; dedupe in mosaic pixels
    // (not normalized coordinates, which would distort rotated boxes).
    const deduped = nms(allCandidates, nmsOptionsFor(this.manifest.task));
    return this.finalize(
      deduped,
      width,
      height,
      image as AerialCapture,
      boundary,
      totalInferenceMs,
      factor,
      sourceResolutionM,
    );
  }

  /** Copies a rectangular RGBA window out of the mosaic into a dense buffer. */
  private extractCrop(
    rgba: Uint8Array,
    width: number,
    cropX: number,
    cropY: number,
    w: number,
    h: number,
  ): Uint8ClampedArray {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let row = 0; row < h; row++) {
      const srcStart = ((cropY + row) * width + cropX) * 4;
      const dstStart = row * w * 4;
      out.set(rgba.subarray(srcStart, srcStart + w * 4), dstStart);
    }
    return out;
  }

  /**
   * Clip to polygon + geo-reference + count → DetectionResult.
   *
   * The model still uses its source classes internally for confidence
   * thresholds, but the product deliberately exposes one underwriting category:
   * every detected road vehicle is a `car`.
   */
  private finalize(
    candidates: VehicleCandidate[],
    width: number,
    height: number,
    image: AerialCapture,
    boundary: BoundaryResult | undefined,
    inferenceMs: number,
    resample: number,
    sourceResolutionM: number,
  ): DetectionResult {
    // Normalized axis-aligned hulls: consumers only need the extent and the
    // geographic center, and stay independent of the model's box type.
    const boxes = candidates.map((c) => {
      const hull = hullSize(c);
      return {
        x: (c.cx - hull.w / 2) / width,
        y: (c.cy - hull.h / 2) / height,
        w: hull.w / width,
        h: hull.h / height,
        confidence: c.score,
      };
    });
    const hasGeo =
      typeof image.originLon === "number" &&
      typeof image.lonSpan === "number" &&
      image.lonSpan !== 0 &&
      image.latSpan !== 0;

    const counts = emptyCounts();
    const outBoxes: DetectionBox[] = [];
    let confSum = 0;

    for (const b of boxes) {
      let lon: number | undefined;
      let lat: number | undefined;
      if (hasGeo) {
        const cx = b.x + b.w / 2;
        const cy = b.y + b.h / 2;
        lon = image.originLon + cx * image.lonSpan;
        lat = image.originLat - cy * image.latSpan;
        // Clip to the boundary polygon (discard vehicles outside it)
        if (boundary) {
          const inside = booleanPointInPolygon(turfPoint([lon, lat]), {
            type: "Feature",
            properties: {},
            geometry: boundary.polygon,
          });
          if (!inside) continue;
        }
      }
      counts.car += 1;
      confSum += b.confidence;
      outBoxes.push({
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h,
        score: b.confidence,
        classLabel: "car",
        lon,
        lat,
      });
    }

    const vehicleCount = outBoxes.length;
    const m = this.manifest;
    const resampleNote =
      resample === 1 ? "" : `, imagery resampled ×${resample.toFixed(2)}`;
    return {
      vehicleCount,
      confidence: vehicleCount > 0 ? confSum / vehicleCount : 0,
      model: this.modelName,
      classCounts: counts,
      inferenceMs,
      boxes: outBoxes,
      evidence: {
        source: `${m.name} ONNX`,
        retrievedAt: new Date().toISOString(),
        dataVersion: m.version,
        method:
          `sliding-window ${m.task === "obb" ? "oriented " : ""}aerial vehicle ` +
          `detection at ${m.gsdM} m/px${resampleNote}, hard NMS`,
        confidence: vehicleCount > 0 ? confSum / vehicleCount : 0,
        fallbackUsed: false,
        limitations: [
          ...coarseImageryLimitations(sourceResolutionM),
          "Accuracy depends on imagery resolution and capture date",
          "Screening estimate of vehicles visible on the capture date, not a current stock count",
          ...m.limitations,
        ],
      },
    };
  }
}

/**
 * Placeholder detector. Provides an area-based heuristic instead of real
 * inference — fallback for when the ONNX model isn't available.
 */
export class StubVehicleDetector implements VehicleDetector {
  readonly modelName = "stub-area-heuristic";

  async detect(
    _image: AerialImage,
    boundary?: BoundaryResult,
    _parameters?: RiskParameters,
  ): Promise<DetectionResult> {
    const area = boundary?.areaSqm ?? 0;
    const vehicleCount = Math.round(area / 25);
    return {
      vehicleCount,
      confidence: boundary ? 0.3 : 0.1,
      model: this.modelName,
      classCounts: { car: vehicleCount, van: 0, truck: 0, bus: 0 },
      evidence: {
        source: "synthetic estimate",
        retrievedAt: new Date().toISOString(),
        method: "area-based vehicle estimate",
        confidence: boundary ? 0.3 : 0.1,
        fallbackUsed: true,
        limitations: ["No ML model installed; count is not a detection"],
      },
    };
  }
}

/** Automatically selects the ONNX detector if the model is present, otherwise the stub. */
function createDetector(): VehicleDetector {
  const model = resolveModel();
  if (model) {
    try {
      return new OnnxYoloDetector(model.path, model.manifest);
    } catch {
      return new StubVehicleDetector();
    }
  }
  return new StubVehicleDetector();
}

let detector: VehicleDetector | null = null;
function getDetector(): VehicleDetector {
  if (!detector) detector = createDetector();
  return detector;
}

/**
 * Forces a re-selection of the detector on the next call — needed after
 * the installation wizard has downloaded the model after the fact
 * (without a restart the process would otherwise be stuck on the stub for the session).
 */
export function resetDetector(): void {
  detector = null;
}

/** Whether a real ONNX model is currently available (for the installation wizard). */
export function isModelAvailable(): boolean {
  return resolveModel() !== null;
}

/**
 * Records which image a detection was made on. The selection goes onto the
 * result for the UI, and a one-line summary onto the evidence limitations so
 * reports and memos that only read `evidence` still carry the capture date.
 */
export function attachImageryProvenance(
  detection: DetectionResult,
  imagery: ImagerySelection | undefined,
): DetectionResult {
  if (!imagery) return detection;
  const line = describeImagerySelection(imagery);
  return {
    ...detection,
    imagery,
    evidence: detection.evidence
      ? {
          ...detection.evidence,
          limitations: [
            ...detection.evidence.limitations.filter(
              (l) => !l.startsWith("Vehicles counted on "),
            ),
            line,
          ],
        }
      : undefined,
  };
}

export async function detectVehicles(
  image: AerialImage,
  boundary?: BoundaryResult,
  parameters: RiskParameters = DEFAULT_RISK_PARAMETERS,
): Promise<DetectionResult> {
  return getDetector().detect(image, boundary, parameters);
}

/**
 * Detects every vehicle in `image` without clipping to any boundary
 * (docs/boundary-improvement-plan.de.md P5: run detection on the wider
 * context *before* the final boundary is chosen, so a too-tight boundary
 * cannot hide vehicles the imagery already shows). Reuse the result with
 * `filterDetectionToBoundary` once a boundary is settled, rather than
 * re-running the model.
 */
export async function detectVehiclesInContext(
  image: AerialImage,
  parameters: RiskParameters = DEFAULT_RISK_PARAMETERS,
): Promise<DetectionResult> {
  return getDetector().detect(image, undefined, parameters);
}

/**
 * Re-clips an already-computed detection to a (possibly different) boundary
 * using each box's stored lon/lat — no re-capture, no re-inference. This is
 * what lets a manual boundary edit or a P3 site-membership expansion update
 * the vehicle count instantly.
 *
 * Returns `null` when the source detection carries no per-vehicle geometry
 * to re-clip — the area-based `StubVehicleDetector` fallback has no real
 * boxes, and its area estimate must instead be recomputed directly against
 * the new boundary via `detectVehicles`.
 */
export function filterDetectionToBoundary(
  detection: DetectionResult,
  boundary: BoundaryResult,
): DetectionResult | null {
  if (!detection.boxes) return null;

  const counts = emptyCounts();
  const filtered: DetectionBox[] = [];
  let confSum = 0;
  for (const box of detection.boxes) {
    if (box.lon == null || box.lat == null) continue;
    const inside = booleanPointInPolygon(turfPoint([box.lon, box.lat]), {
      type: "Feature",
      properties: {},
      geometry: boundary.polygon,
    });
    if (!inside) continue;
    counts.car += 1;
    confSum += box.score;
    filtered.push(box);
  }

  const vehicleCount = filtered.length;
  const confidence = vehicleCount > 0 ? confSum / vehicleCount : 0;
  return {
    ...detection,
    vehicleCount,
    confidence,
    classCounts: counts,
    boxes: filtered,
    evidence: detection.evidence
      ? { ...detection.evidence, confidence }
      : undefined,
  };
}
