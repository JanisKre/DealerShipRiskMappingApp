import { join } from "path";
import { app, utilityProcess, type UtilityProcess } from "electron";
import { existsSync } from "fs";
import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import { point as turfPoint } from "@turf/helpers";
import type {
  BoundaryResult,
  DetectionBox,
  DetectionResult,
  VehicleClass,
} from "@shared/types";
import { DETECTION_STRIDE, DETECTION_WINDOW_SIZE } from "@shared/constants";
import type { AerialCapture } from "./tiles.service";
import { DEFAULT_RISK_PARAMETERS } from "@shared/parameters";
import type { RiskParameters } from "@shared/types";

/**
 * Swappable detector interface. Allows the current YOLOv8-ONNX to be
 * replaced later with other models without changing calling code.
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

const WINDOW_SIZE = DETECTION_WINDOW_SIZE;
const STRIDE = DETECTION_STRIDE;

// --- Raw worker types --------------------------------------------------------

interface WorkerDetection {
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number;
  classId: number;
  classLabel: VehicleClass;
}

interface WorkerResult {
  type: "result";
  id: string;
  detections?: WorkerDetection[];
  inferenceMs?: number;
  error?: string;
}

// --- Model path --------------------------------------------------------------

/** Filename of the ONNX model — also used by the installation wizard when downloading. */
export const MODEL_FILENAME = "yolov26s_aerial_vehicles.onnx";

/** Directory the installation wizard downloads the model into (survives updates). */
export function modelsDir(): string {
  return join(app.getPath("userData"), "models");
}

function resolveModelPath(): string | null {
  // Packaged: extraResources → resources/models; Dev: repo-local resources/;
  // plus userData/models — where the installation wizard places the model.
  const candidates = [
    join(process.resourcesPath ?? "", "models", MODEL_FILENAME),
    join(app.getAppPath(), "resources", "models", MODEL_FILENAME),
    join(app.getAppPath(), "..", "resources", "models", MODEL_FILENAME),
    join(modelsDir(), MODEL_FILENAME),
  ];
  return candidates.find((p) => p && existsSync(p)) ?? null;
}

function resolveWorkerPath(): string {
  return join(__dirname, "onnx-inference.worker.cjs");
}

// --- Geometry helpers --------------------------------------------------------

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number;
  classLabel: VehicleClass;
}

function computeIoU(a: Box, b: Box): number {
  const ix1 = Math.max(a.x, b.x);
  const iy1 = Math.max(a.y, b.y);
  const ix2 = Math.min(a.x + a.w, b.x + b.w);
  const iy2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union === 0 ? 0 : inter / union;
}

const SOFT_NMS_SIGMA = 0.5;
const SOFT_NMS_SCORE_THRESHOLD = 0.15;

/** Global soft-NMS across all crops (Gaussian decay, removes seam duplicates). */
function globalNMS(boxes: Box[]): Box[] {
  const scored = boxes.map((b) => ({ ...b }));
  const keep: Box[] = [];
  while (scored.length > 0) {
    scored.sort((a, b) => b.confidence - a.confidence);
    const best = scored.shift()!;
    keep.push(best);
    for (const box of scored) {
      const iou = computeIoU(best, box);
      box.confidence *= Math.exp(-(iou * iou) / SOFT_NMS_SIGMA);
    }
    const survivors = scored.filter(
      (b) => b.confidence >= SOFT_NMS_SCORE_THRESHOLD,
    );
    scored.splice(0, scored.length, ...survivors);
  }
  return keep;
}

function inverseLetterbox(
  normCoord: number,
  pad: number,
  scale: number,
): number {
  return (normCoord * WINDOW_SIZE - pad) / scale;
}

function emptyCounts(): Record<VehicleClass, number> {
  return { car: 0, van: 0, truck: 0, bus: 0 };
}

// --- ONNX detector -------------------------------------------------------

/**
 * Real YOLOv8-ONNX detector. Spawns a persistent utilityProcess, slices the
 * RGBA mosaic into overlapping 640-pixel windows, runs inference,
 * maps boxes back onto the canvas, deduplicates via soft-NMS, clips to the
 * boundary polygon, and converts the centers to lon/lat.
 */
export class OnnxYoloDetector implements VehicleDetector {
  readonly modelName = "yolov26s_aerial_vehicles";
  private proc: UtilityProcess | null = null;
  private ready: Promise<void> | null = null;
  private readonly modelPath: string;
  private seq = 0;
  private readonly pending = new Map<
    string,
    { resolve: (r: WorkerResult) => void; reject: (e: Error) => void }
  >();

  constructor(modelPath: string) {
    this.modelPath = modelPath;
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

      proc.postMessage({ type: "init", modelPath: this.modelPath });
    });
    return this.ready;
  }

  private runWindow(
    pixels: Uint8ClampedArray,
    width: number,
    height: number,
    confidenceThreshold: number,
    metersPerModelPixel: number,
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
        metersPerModelPixel,
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

    const { rgba, width, height } = image;
    const crops = this.planCrops(width, height);

    // Ground resolution of the source capture (meters/pixel). Vehicle
    // size sanity-checking happens in the worker in real-world units so it
    // stays correct regardless of capture zoom — see VEHICLE_MIN_WIDTH_M.
    const [west, south, east, north] = image.bbox;
    const metersPerPixel =
      ((east - west) *
        111_320 *
        Math.cos(((north + south) / 2) * (Math.PI / 180))) /
      width;

    const allBoxes: Box[] = [];
    let totalInferenceMs = 0;

    // Windows sequentially (single-session worker); inference itself is the
    // bottleneck, not the JS slicing.
    for (const c of crops) {
      const cropBuf = this.extractCrop(rgba, width, c.cropX, c.cropY, c.w, c.h);
      const scale = Math.min(WINDOW_SIZE / c.w, WINDOW_SIZE / c.h);
      const res = await this.runWindow(
        cropBuf,
        c.w,
        c.h,
        parameters.detectionConfidence,
        metersPerPixel / scale,
      );
      if (res.error || !res.detections) continue;
      totalInferenceMs += res.inferenceMs ?? 0;

      const scaledW = Math.round(c.w * scale);
      const scaledH = Math.round(c.h * scale);
      const padLeft = Math.floor((WINDOW_SIZE - scaledW) / 2);
      const padTop = Math.floor((WINDOW_SIZE - scaledH) / 2);

      for (const d of res.detections) {
        const xPx = inverseLetterbox(d.x, padLeft, scale);
        const yPx = inverseLetterbox(d.y, padTop, scale);
        const wPx = (d.w * WINDOW_SIZE) / scale;
        const hPx = (d.h * WINDOW_SIZE) / scale;
        allBoxes.push({
          x: (c.cropX + xPx) / width,
          y: (c.cropY + yPx) / height,
          w: wPx / width,
          h: hPx / height,
          confidence: d.confidence,
          classLabel: d.classLabel,
        });
      }
    }

    const deduped = globalNMS(allBoxes);
    return this.finalize(
      deduped,
      image as AerialCapture,
      boundary,
      totalInferenceMs,
    );
  }

  /** Sliding-window plan with half-stride row jitter (from slidingWindowDetect.ts). */
  private planCrops(
    width: number,
    height: number,
  ): { cropX: number; cropY: number; w: number; h: number }[] {
    if (width <= WINDOW_SIZE && height <= WINDOW_SIZE) {
      return [{ cropX: 0, cropY: 0, w: width, h: height }];
    }
    const crops: { cropX: number; cropY: number; w: number; h: number }[] = [];
    let rowIdx = 0;
    for (let y = 0; y < height; y += STRIDE) {
      const xOffset = (rowIdx % 2) * (STRIDE / 2);
      rowIdx++;
      for (let x = xOffset; x < width; x += STRIDE) {
        crops.push({
          cropX: x,
          cropY: y,
          w: Math.min(WINDOW_SIZE, width - x),
          h: Math.min(WINDOW_SIZE, height - y),
        });
      }
      if (xOffset > 0) {
        crops.push({
          cropX: 0,
          cropY: y,
          w: Math.min(WINDOW_SIZE, width),
          h: Math.min(WINDOW_SIZE, height - y),
        });
      }
    }
    return crops;
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
    boxes: Box[],
    image: AerialCapture,
    boundary: BoundaryResult | undefined,
    inferenceMs: number,
  ): DetectionResult {
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
    return {
      vehicleCount,
      confidence: vehicleCount > 0 ? confSum / vehicleCount : 0,
      model: this.modelName,
      classCounts: counts,
      inferenceMs,
      boxes: outBoxes,
      evidence: {
        source: "YOLOv26 ONNX",
        retrievedAt: new Date().toISOString(),
        dataVersion: this.modelName,
        method: "sliding-window aerial object detection with soft-NMS",
        confidence: vehicleCount > 0 ? confSum / vehicleCount : 0,
        fallbackUsed: false,
        limitations: [
          "Accuracy depends on imagery resolution and capture date",
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
  const modelPath = resolveModelPath();
  if (modelPath) {
    try {
      return new OnnxYoloDetector(modelPath);
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
  return resolveModelPath() !== null;
}

export async function detectVehicles(
  image: AerialImage,
  boundary?: BoundaryResult,
  parameters: RiskParameters = DEFAULT_RISK_PARAMETERS,
): Promise<DetectionResult> {
  return getDetector().detect(image, boundary, parameters);
}
