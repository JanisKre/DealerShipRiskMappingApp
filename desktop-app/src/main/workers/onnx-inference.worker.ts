import * as ort from "onnxruntime-node";
import type { VehicleModelManifest } from "@shared/model-manifest";
import {
  decodeYoloOutput,
  letterbox,
  nms,
  nmsOptionsFor,
  unletterbox,
  type VehicleCandidate,
} from "../services/detection/yolo";

/**
 * ONNX inference in an Electron utilityProcess (its own Node process, keeping
 * the native onnxruntime-node out of the renderer and main threads).
 * Communication runs over `process.parentPort`:
 *   → Init:    { type: 'init', modelPath, manifest }
 *   → Request: { type: 'infer', id, pixels, width, height, confidenceThreshold, metersPerPixel }
 *   ← Ready:   { type: 'ready' }  |  { type: 'error', error }
 *   ← Result:  { type: 'result', id, detections, inferenceMs }
 * Result detections are in crop pixels (letterbox already undone).
 */

interface InferRequest {
  type: "infer";
  id: string;
  /** RGBA crop, at most `manifest.imgsz` on each side. */
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  /** User's base confidence threshold; per-class offsets come from the manifest. */
  confidenceThreshold: number;
  /** Ground resolution of the crop (m/px), for the real-world size filter. */
  metersPerPixel: number;
}

type IncomingMessage =
  | { type: "init"; modelPath: string; manifest: VehicleModelManifest }
  | InferRequest;

let session: ort.InferenceSession | null = null;
let manifest: VehicleModelManifest | null = null;

// utilityProcess exposes the channel as process.parentPort
const port = process.parentPort;

async function loadSession(
  modelPath: string,
  m: VehicleModelManifest,
): Promise<void> {
  session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ["cpu"],
    graphOptimizationLevel: "all",
    enableCpuMemArena: true,
  });
  manifest = m;
  port.postMessage({ type: "ready" });
}

function runInference(req: InferRequest): void {
  if (!session || !manifest) {
    port.postMessage({
      type: "result",
      id: req.id,
      error: "Session not ready",
    });
    return;
  }
  const m = manifest;
  const t0 = performance.now();
  const lb = letterbox(req.pixels, req.width, req.height, m.imgsz);
  const inputTensor = new ort.Tensor("float32", lb.tensor, [
    1,
    3,
    m.imgsz,
    m.imgsz,
  ]);

  session
    .run({ [session.inputNames[0]]: inputTensor })
    .then((results) => {
      const output = results[session!.outputNames[0]];
      const candidates = decodeYoloOutput(
        output.data as Float32Array,
        output.dims,
        {
          manifest: m,
          baseThreshold: req.confidenceThreshold,
          metersPerModelPixel: req.metersPerPixel / lb.scale,
        },
      );
      const detections: VehicleCandidate[] = nms(
        candidates,
        nmsOptionsFor(m.task),
      ).map((c) => unletterbox(c, lb));
      port.postMessage({
        type: "result",
        id: req.id,
        detections,
        inferenceMs: performance.now() - t0,
      });
    })
    .catch((err: unknown) => {
      port.postMessage({ type: "result", id: req.id, error: String(err) });
    });
}

port.on("message", (e: { data: IncomingMessage }) => {
  const msg = e.data;
  if (msg.type === "init") {
    loadSession(msg.modelPath, msg.manifest).catch((err: unknown) => {
      port.postMessage({
        type: "error",
        error: `Model load failed: ${String(err)}`,
      });
    });
  } else if (msg.type === "infer") {
    runInference(msg);
  }
});
