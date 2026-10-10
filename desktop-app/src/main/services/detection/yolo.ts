import {
  VEHICLE_MAX_ASPECT_RATIO,
  VEHICLE_MAX_LENGTH_M,
  VEHICLE_MIN_WIDTH_M,
} from "@shared/constants";
import { DETECTION_MAX_RESOLUTION_M } from "@shared/imagery-sources";
import type { VehicleModelManifest } from "@shared/model-manifest";
import type { VehicleClass } from "@shared/types";

/**
 * Pure YOLO pre/post-processing shared by the inference worker and the
 * detection service. Kept free of Electron and onnxruntime so every step —
 * letterboxing, output decoding, size filtering, NMS, window planning — is
 * unit-testable without a model binary.
 */

/** One vehicle candidate in pixel space (model input or mosaic, see caller). */
export interface VehicleCandidate {
  cx: number;
  cy: number;
  w: number;
  h: number;
  /** Rotation in radians (0 for axis-aligned models). */
  angle: number;
  score: number;
  classId: number;
  classLabel: VehicleClass;
}

// --- Ground resolution -------------------------------------------------------

const METERS_PER_DEGREE = 111_320;

/**
 * Meters per pixel of a stitched tile mosaic. Must use the mosaic's own
 * longitude span: the requested bbox is smaller than the mosaic (tiles are
 * snapped to whole tiles plus a margin), and dividing the bbox width by the
 * mosaic width underestimates the resolution by up to ~2x.
 */
export function mosaicMetersPerPixel(image: {
  width: number;
  bbox: [number, number, number, number];
  lonSpan?: number;
}): number {
  const [west, south, east, north] = image.bbox;
  const lonSpan =
    typeof image.lonSpan === "number" && image.lonSpan > 0
      ? image.lonSpan
      : east - west;
  const lat = (north + south) / 2;
  return (
    (lonSpan * METERS_PER_DEGREE * Math.cos((lat * Math.PI) / 180)) /
    image.width
  );
}

// --- Thresholds and size plausibility ---------------------------------------

/**
 * The user's confidence setting is the base; per-class offsets only shift it.
 * Raising the setting therefore always makes detection stricter.
 */
export function effectiveThreshold(base: number, offset = 0): number {
  return Math.min(0.99, Math.max(0.01, base + offset));
}

/** Rejects noise, implausible blobs, and overly elongated shapes (real-world meters). */
export function isPlausibleVehicleSize(
  w: number,
  h: number,
  metersPerPixel: number,
): boolean {
  const shortSideM = Math.min(w, h) * metersPerPixel;
  const longSideM = Math.max(w, h) * metersPerPixel;
  return (
    shortSideM >= VEHICLE_MIN_WIDTH_M &&
    longSideM <= VEHICLE_MAX_LENGTH_M &&
    longSideM / shortSideM <= VEHICLE_MAX_ASPECT_RATIO
  );
}

// --- Letterbox ---------------------------------------------------------------

export interface Letterbox {
  tensor: Float32Array;
  scale: number;
  padLeft: number;
  padTop: number;
}

/** Ultralytics' letterbox fill value. */
const PAD_VALUE = 114 / 255;

/**
 * RGBA crop → CHW float tensor in [0, 1], centered on a gray canvas. Crops
 * are never upscaled: small crops are padded instead, because magnifying a
 * sliver of imagery makes the model hallucinate vehicles.
 */
export function letterbox(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  inputSize: number,
): Letterbox {
  const scale = Math.min(1, inputSize / width, inputSize / height);
  const scaledW = Math.round(width * scale);
  const scaledH = Math.round(height * scale);
  const padLeft = Math.floor((inputSize - scaledW) / 2);
  const padTop = Math.floor((inputSize - scaledH) / 2);
  const plane = inputSize * inputSize;
  const tensor = new Float32Array(3 * plane).fill(PAD_VALUE);

  for (let dy = 0; dy < scaledH; dy++) {
    for (let dx = 0; dx < scaledW; dx++) {
      const dst = (padTop + dy) * inputSize + (padLeft + dx);
      if (scale === 1) {
        const src = (dy * width + dx) * 4;
        tensor[dst] = pixels[src] / 255;
        tensor[plane + dst] = pixels[src + 1] / 255;
        tensor[2 * plane + dst] = pixels[src + 2] / 255;
        continue;
      }
      // Bilinear downsampling for crops larger than the model input.
      const srcX = dx / scale;
      const srcY = dy / scale;
      const x0 = Math.floor(srcX);
      const y0 = Math.floor(srcY);
      const x1 = Math.min(x0 + 1, width - 1);
      const y1 = Math.min(y0 + 1, height - 1);
      const wx = srcX - x0;
      const wy = srcY - y0;
      for (let c = 0; c < 3; c++) {
        const p00 = pixels[(y0 * width + x0) * 4 + c];
        const p10 = pixels[(y0 * width + x1) * 4 + c];
        const p01 = pixels[(y1 * width + x0) * 4 + c];
        const p11 = pixels[(y1 * width + x1) * 4 + c];
        tensor[c * plane + dst] =
          (p00 * (1 - wx) * (1 - wy) +
            p10 * wx * (1 - wy) +
            p01 * (1 - wx) * wy +
            p11 * wx * wy) /
          255;
      }
    }
  }
  return { tensor, scale, padLeft, padTop };
}

/** Maps a candidate from model-input pixels back into crop pixels. */
export function unletterbox(
  c: VehicleCandidate,
  lb: Pick<Letterbox, "scale" | "padLeft" | "padTop">,
): VehicleCandidate {
  return {
    ...c,
    cx: (c.cx - lb.padLeft) / lb.scale,
    cy: (c.cy - lb.padTop) / lb.scale,
    w: c.w / lb.scale,
    h: c.h / lb.scale,
  };
}

// --- Output decoding ---------------------------------------------------------

export interface DecodeOptions {
  manifest: VehicleModelManifest;
  /** User's base confidence threshold. */
  baseThreshold: number;
  /** Real-world meters per model-input pixel, for the size filter. */
  metersPerModelPixel: number;
}

/**
 * Decodes a YOLO output tensor into vehicle candidates in model-input pixels.
 * Supports Ultralytics' raw head output (detect and obb) and the NMS-free
 * end2end layout. Throws when the tensor shape doesn't match the manifest, so
 * a mismatched model fails loudly instead of producing silent garbage.
 */
export function decodeYoloOutput(
  data: Float32Array,
  dims: readonly number[],
  opts: DecodeOptions,
): VehicleCandidate[] {
  const { manifest } = opts;
  const obb = manifest.task === "obb";
  const classes = Object.entries(manifest.vehicleClasses).map(
    ([id, label]) => ({
      id: Number(id),
      label,
      threshold: effectiveThreshold(
        opts.baseThreshold,
        manifest.classOffsets[id] ?? 0,
      ),
    }),
  );
  const out: VehicleCandidate[] = [];
  const keep = (c: VehicleCandidate): void => {
    if (isPlausibleVehicleSize(c.w, c.h, opts.metersPerModelPixel)) out.push(c);
  };

  if (dims.length !== 3 || dims[0] !== 1) {
    throw new Error(`Unexpected model output shape [${dims.join(", ")}]`);
  }

  if (manifest.outputFormat === "end2end") {
    const [, n, k] = dims;
    if (k !== (obb ? 7 : 6)) {
      throw new Error(
        `end2end ${manifest.task} output needs ${obb ? 7 : 6} values per row, got ${k}`,
      );
    }
    for (let i = 0; i < n; i++) {
      const row = i * k;
      const score = data[row + 4];
      const classId = Math.round(data[row + 5]);
      const cls = classes.find((c) => c.id === classId);
      if (!cls || score < cls.threshold) continue;
      let cx: number, cy: number, w: number, h: number;
      if (obb) {
        [cx, cy, w, h] = [
          data[row],
          data[row + 1],
          data[row + 2],
          data[row + 3],
        ];
      } else {
        const [x1, y1, x2, y2] = [
          data[row],
          data[row + 1],
          data[row + 2],
          data[row + 3],
        ];
        [cx, cy, w, h] = [(x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1];
      }
      keep({
        cx,
        cy,
        w,
        h,
        angle: obb ? data[row + 6] : 0,
        score,
        classId,
        classLabel: cls.label,
      });
    }
    return out;
  }

  // raw: [1, channels, anchors]; channels = 4 box + nc scores (+1 angle for obb)
  const [, channels, n] = dims;
  const nc = channels - 4 - (obb ? 1 : 0);
  const expectedNc = Object.keys(manifest.classes).length;
  if (nc !== expectedNc) {
    throw new Error(
      `Model output has ${nc} classes, manifest lists ${expectedNc} (shape [${dims.join(", ")}])`,
    );
  }
  for (let i = 0; i < n; i++) {
    let best: (typeof classes)[number] | null = null;
    let bestScore = 0;
    for (const cls of classes) {
      const s = data[(4 + cls.id) * n + i];
      if (s > bestScore) {
        bestScore = s;
        best = cls;
      }
    }
    if (!best || bestScore < best.threshold) continue;
    keep({
      cx: data[i],
      cy: data[n + i],
      w: data[2 * n + i],
      h: data[3 * n + i],
      angle: obb ? data[(channels - 1) * n + i] : 0,
      score: bestScore,
      classId: best.id,
      classLabel: best.label,
    });
  }
  return out;
}

// --- Oriented-box geometry and NMS -----------------------------------------

type Pt = [number, number];

export function boxCorners(c: {
  cx: number;
  cy: number;
  w: number;
  h: number;
  angle: number;
}): Pt[] {
  const cos = Math.cos(c.angle);
  const sin = Math.sin(c.angle);
  const hw = c.w / 2;
  const hh = c.h / 2;
  return (
    [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ] as Pt[]
  ).map(([x, y]) => [c.cx + x * cos - y * sin, c.cy + x * sin + y * cos]);
}

/** Axis-aligned hull size of a (possibly rotated) box. */
export function hullSize(c: { w: number; h: number; angle: number }): {
  w: number;
  h: number;
} {
  const cos = Math.abs(Math.cos(c.angle));
  const sin = Math.abs(Math.sin(c.angle));
  return { w: c.w * cos + c.h * sin, h: c.w * sin + c.h * cos };
}

function polygonArea(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

/** Sutherland–Hodgman clip of `subject` by convex, counter-clockwise-agnostic `clip`. */
function clipConvex(subject: Pt[], clip: Pt[]): Pt[] {
  // Orientation of the clip polygon decides which side is "inside".
  let signed = 0;
  for (let i = 0; i < clip.length; i++) {
    const [x1, y1] = clip[i];
    const [x2, y2] = clip[(i + 1) % clip.length];
    signed += x1 * y2 - x2 * y1;
  }
  const orient = signed >= 0 ? 1 : -1;
  let output = subject;
  for (let i = 0; i < clip.length && output.length > 0; i++) {
    const [ax, ay] = clip[i];
    const [bx, by] = clip[(i + 1) % clip.length];
    const side = ([px, py]: Pt): number =>
      orient * ((bx - ax) * (py - ay) - (by - ay) * (px - ax));
    const input = output;
    output = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j];
      const q = input[(j + 1) % input.length];
      const sp = side(p);
      const sq = side(q);
      if (sp >= 0) output.push(p);
      if (sp >= 0 !== sq >= 0) {
        const t = sp / (sp - sq);
        output.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
      }
    }
  }
  return output;
}

/** IoU and intersection-over-smaller of two (possibly rotated) boxes. */
export function boxOverlap(
  a: VehicleCandidate,
  b: VehicleCandidate,
): { iou: number; ios: number } {
  // Cheap reject via axis-aligned hulls before polygon clipping.
  const ha = hullSize(a);
  const hb = hullSize(b);
  if (
    Math.abs(a.cx - b.cx) * 2 >= ha.w + hb.w ||
    Math.abs(a.cy - b.cy) * 2 >= ha.h + hb.h
  ) {
    return { iou: 0, ios: 0 };
  }
  const areaA = a.w * a.h;
  const areaB = b.w * b.h;
  const inter =
    a.angle === 0 && b.angle === 0
      ? Math.max(
          0,
          Math.min(a.cx + a.w / 2, b.cx + b.w / 2) -
            Math.max(a.cx - a.w / 2, b.cx - b.w / 2),
        ) *
        Math.max(
          0,
          Math.min(a.cy + a.h / 2, b.cy + b.h / 2) -
            Math.max(a.cy - a.h / 2, b.cy - b.h / 2),
        )
      : polygonArea(clipConvex(boxCorners(a), boxCorners(b)));
  const union = areaA + areaB - inter;
  const smaller = Math.min(areaA, areaB);
  return {
    iou: union > 0 ? inter / union : 0,
    ios: smaller > 0 ? inter / smaller : 0,
  };
}

export interface NmsOptions {
  iouThreshold: number;
  /** Also suppress when this share of the smaller box is covered (cut-off duplicates at window seams). */
  iosThreshold: number;
}

/** IoU thresholds per task: axis-aligned hulls of angled parking rows overlap more. */
export function nmsOptionsFor(task: VehicleModelManifest["task"]): NmsOptions {
  return task === "obb"
    ? { iouThreshold: 0.5, iosThreshold: 0.7 }
    : { iouThreshold: 0.6, iosThreshold: 0.8 };
}

/**
 * Class-agnostic hard NMS. Counting needs each vehicle exactly once; soft-NMS
 * only down-weights duplicates, so they survive a score floor and inflate counts.
 */
export function nms<T extends VehicleCandidate>(
  candidates: T[],
  opts: NmsOptions,
): T[] {
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const kept: T[] = [];
  for (const c of sorted) {
    const duplicate = kept.some((k) => {
      const { iou, ios } = boxOverlap(k, c);
      return iou >= opts.iouThreshold || ios >= opts.iosThreshold;
    });
    if (!duplicate) kept.push(c);
  }
  return kept;
}

// --- Sliding windows ---------------------------------------------------------

/** Start offsets along one axis; the last window is pulled back inside so every window is full-size. */
export function windowOffsets(
  length: number,
  window: number,
  stride: number,
): number[] {
  if (length <= window) return [0];
  const offsets: number[] = [];
  for (let o = 0; o + window < length; o += stride) offsets.push(o);
  offsets.push(length - window);
  return offsets;
}

export interface Crop {
  cropX: number;
  cropY: number;
  w: number;
  h: number;
}

export function planCrops(
  width: number,
  height: number,
  window: number,
  stride: number,
): Crop[] {
  const crops: Crop[] = [];
  for (const cropY of windowOffsets(height, window, stride)) {
    for (const cropX of windowOffsets(width, window, stride)) {
      crops.push({
        cropX,
        cropY,
        w: Math.min(window, width),
        h: Math.min(window, height),
      });
    }
  }
  return crops;
}

/**
 * Resampling factor that brings imagery to the model's training resolution.
 * Bounded so a bad resolution estimate can't blow up memory or shrink cars
 * to a few pixels; skipped when already within 5 %.
 */
export function resampleFactor(
  metersPerPixel: number,
  targetGsdM: number,
): number {
  if (!(metersPerPixel > 0) || !(targetGsdM > 0)) return 1;
  const factor = metersPerPixel / targetGsdM;
  if (Math.abs(factor - 1) < 0.05) return 1;
  return Math.min(2.5, Math.max(0.5, factor));
}

/**
 * Limitation for imagery coarser than the detector is trained on. Such scenes
 * stay blurry after resampling (and beyond the 2.5× cap, cars stay too small),
 * so the model under-counts; the result says so instead of failing silently.
 */
export function coarseImageryLimitations(resolutionM: number): string[] {
  if (!(resolutionM > DETECTION_MAX_RESOLUTION_M)) return [];
  return [
    `Imagery resolution ${resolutionM.toFixed(2)} m/px is coarser than the detector ` +
      `supports (≤ ${DETECTION_MAX_RESOLUTION_M} m/px); the vehicle count is likely too low`,
  ];
}
