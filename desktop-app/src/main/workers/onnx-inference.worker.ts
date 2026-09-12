import * as ort from "onnxruntime-node";

/**
 * ONNX inference in an Electron utilityProcess (its own Node process, keeping
 * the native onnxruntime-node out of the renderer and main threads).
 *
 * Ported from the original `server/workers/inferenceWorker.ts`. Communication
 * runs over `process.parentPort` (utilityProcess) instead of worker_threads:
 *   → Init:    { type: 'init', modelPath }
 *   → Request: { type: 'infer', id, pixelBuffer, width, height, confidenceThreshold }
 *   ← Ready:   { type: 'ready' }  |  { type: 'error', error }
 *   ← Result:  { type: 'result', id, detections, inferenceMs }
 */

const MODEL_INPUT = 640;
const NUM_DETS = 8400;
const CAR_CLASSES = [3, 4, 5, 8] as const;
const CLASS_LABEL_MAP: Record<number, "car" | "van" | "bus" | "truck"> = {
  3: "car",
  4: "van",
  5: "truck",
  8: "bus",
};
// Per-class thresholds: trucks/buses are large and score high, cars/vans
// need lower thresholds so small vehicles don't get missed.
const CLASS_THRESHOLDS: Record<number, number> = {
  3: 0.2,
  4: 0.22,
  5: 0.35,
  8: 0.28,
};

interface Detection {
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number;
  classId: number;
  classLabel: "car" | "van" | "bus" | "truck";
}

interface InferRequest {
  type: "infer";
  id: string;
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  confidenceThreshold: number;
}

type IncomingMessage = { type: "init"; modelPath: string } | InferRequest;

let session: ort.InferenceSession | null = null;

// utilityProcess exponiert den Kanal als process.parentPort
const port = process.parentPort;

function preprocessImage(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Float32Array {
  const scale = Math.min(MODEL_INPUT / width, MODEL_INPUT / height);
  const scaledW = Math.round(width * scale);
  const scaledH = Math.round(height * scale);
  const padLeft = Math.floor((MODEL_INPUT - scaledW) / 2);
  const padTop = Math.floor((MODEL_INPUT - scaledH) / 2);
  const FILL = 128 / 255;
  const tensor = new Float32Array(1 * 3 * MODEL_INPUT * MODEL_INPUT).fill(FILL);
  for (let c = 0; c < 3; c++) {
    for (let dy = 0; dy < scaledH; dy++) {
      for (let dx = 0; dx < scaledW; dx++) {
        const srcX = dx / scale;
        const srcY = dy / scale;
        const x0 = Math.floor(srcX);
        const y0 = Math.floor(srcY);
        const x1 = Math.min(x0 + 1, width - 1);
        const y1 = Math.min(y0 + 1, height - 1);
        const wx = srcX - x0;
        const wy = srcY - y0;
        const p00 = pixels[(y0 * width + x0) * 4 + c] / 255;
        const p10 = pixels[(y0 * width + x1) * 4 + c] / 255;
        const p01 = pixels[(y1 * width + x0) * 4 + c] / 255;
        const p11 = pixels[(y1 * width + x1) * 4 + c] / 255;
        tensor[
          c * MODEL_INPUT * MODEL_INPUT +
            (padTop + dy) * MODEL_INPUT +
            (padLeft + dx)
        ] =
          p00 * (1 - wx) * (1 - wy) +
          p10 * wx * (1 - wy) +
          p01 * (1 - wx) * wy +
          p11 * wx * wy;
      }
    }
  }
  return tensor;
}

function softNms(
  dets: Detection[],
  sigma = 0.5,
  scoreThreshold = 0.12,
): Detection[] {
  const boxes = dets.map((d) => ({ ...d }));
  boxes.sort((a, b) => b.confidence - a.confidence);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const ix1 = Math.max(a.x, b.x);
      const iy1 = Math.max(a.y, b.y);
      const ix2 = Math.min(a.x + a.w, b.x + b.w);
      const iy2 = Math.min(a.y + a.h, b.y + b.h);
      const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
      const union = a.w * a.h + b.w * b.h - inter;
      const iou = union > 0 ? inter / union : 0;
      boxes[j].confidence *= Math.exp(-(iou * iou) / sigma);
    }
  }
  return boxes.filter((d) => d.confidence > scoreThreshold);
}

async function loadSession(modelPath: string): Promise<void> {
  session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ["cpu"],
    graphOptimizationLevel: "all",
    enableCpuMemArena: true,
  });
  port.postMessage({ type: "ready" });
}

function runInference(req: InferRequest): void {
  if (!session) {
    port.postMessage({
      type: "result",
      id: req.id,
      error: "Session not ready",
    });
    return;
  }
  const t0 = performance.now();
  const pixels = req.pixels;
  const raw = preprocessImage(pixels, req.width, req.height);
  const inputTensor = new ort.Tensor("float32", raw, [
    1,
    3,
    MODEL_INPUT,
    MODEL_INPUT,
  ]);
  const feeds: Record<string, ort.Tensor> = {
    [session.inputNames[0]]: inputTensor,
  };

  session
    .run(feeds)
    .then((results) => {
      const output = results[session!.outputNames[0]].data as Float32Array;
      const detections: Detection[] = [];
      for (let i = 0; i < NUM_DETS; i++) {
        let maxConf = 0;
        let maxClass = -1;
        for (const cls of CAR_CLASSES) {
          const conf = output[(4 + cls) * NUM_DETS + i];
          if (conf > maxConf) {
            maxConf = conf;
            maxClass = cls;
          }
        }
        if (maxClass === -1) continue;
        const classThreshold = Math.min(
          CLASS_THRESHOLDS[maxClass] ?? req.confidenceThreshold,
          req.confidenceThreshold,
        );
        if (maxConf < classThreshold) continue;
        const cx = output[0 * NUM_DETS + i];
        const cy = output[1 * NUM_DETS + i];
        const w = output[2 * NUM_DETS + i];
        const h = output[3 * NUM_DETS + i];
        // Rauschen (zu klein), unplausible Blobs und zu langgestreckte Formen verwerfen
        const shortSide = Math.min(w, h);
        const longSide = Math.max(w, h);
        if (shortSide < 7 || longSide > 130 || longSide / shortSide > 5)
          continue;
        detections.push({
          x: (cx - w / 2) / MODEL_INPUT,
          y: (cy - h / 2) / MODEL_INPUT,
          w: w / MODEL_INPUT,
          h: h / MODEL_INPUT,
          confidence: maxConf,
          classId: maxClass,
          classLabel: CLASS_LABEL_MAP[maxClass],
        });
      }
      port.postMessage({
        type: "result",
        id: req.id,
        detections: softNms(detections),
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
    loadSession(msg.modelPath).catch((err: unknown) => {
      port.postMessage({
        type: "error",
        error: `Model load failed: ${String(err)}`,
      });
    });
  } else if (msg.type === "infer") {
    runInference(msg);
  }
});
