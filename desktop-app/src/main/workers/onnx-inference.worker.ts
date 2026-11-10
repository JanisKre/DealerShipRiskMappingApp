import * as ort from "onnxruntime-node";
import type { VehicleModelManifest } from "@shared/model-manifest";
import {
  inferWindow,
  type InferWindow,
} from "../services/detection/onnx-infer";

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

interface InferRequest extends InferWindow {
  type: "infer";
  id: string;
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
  const t0 = performance.now();
  inferWindow(ort, session, manifest, req)
    .then((detections) => {
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
