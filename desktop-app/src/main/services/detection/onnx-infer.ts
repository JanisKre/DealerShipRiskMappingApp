import type * as ort from "onnxruntime-node";
import type { VehicleModelManifest } from "@shared/model-manifest";
import {
  decodeYoloOutput,
  letterbox,
  nms,
  nmsOptionsFor,
  unletterbox,
  type VehicleCandidate,
} from "./yolo";

/** One inference window, as the detector sends it to the worker. */
export interface InferWindow {
  /** RGBA crop, at most `manifest.imgsz` on each side. */
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  /** User's base confidence threshold; per-class offsets come from the manifest. */
  confidenceThreshold: number;
  /** Ground resolution of the crop (m/px), for the real-world size filter. */
  metersPerPixel: number;
}

/**
 * Runs the model on one window: letterbox, inference, decoding, NMS, and back
 * to crop pixels. Shared by the utilityProcess worker and the boundary
 * benchmark, which runs it in-process under plain Node.
 */
export async function inferWindow(
  runtime: typeof ort,
  session: ort.InferenceSession,
  manifest: VehicleModelManifest,
  request: InferWindow,
): Promise<VehicleCandidate[]> {
  const lb = letterbox(
    request.pixels,
    request.width,
    request.height,
    manifest.imgsz,
  );
  const input = new runtime.Tensor("float32", lb.tensor, [
    1,
    3,
    manifest.imgsz,
    manifest.imgsz,
  ]);
  const results = await session.run({ [session.inputNames[0]]: input });
  const output = results[session.outputNames[0]];
  const candidates = decodeYoloOutput(
    output.data as Float32Array,
    output.dims,
    {
      manifest,
      baseThreshold: request.confidenceThreshold,
      metersPerModelPixel: request.metersPerPixel / lb.scale,
    },
  );
  return nms(candidates, nmsOptionsFor(manifest.task)).map((c) =>
    unletterbox(c, lb),
  );
}
