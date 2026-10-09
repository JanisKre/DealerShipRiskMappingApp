import { describe, expect, it } from "vitest";
import {
  LEGACY_VISDRONE_MANIFEST,
  parseVehicleModelManifest,
  type VehicleModelManifest,
} from "@shared/model-manifest";
import {
  boxOverlap,
  decodeYoloOutput,
  effectiveThreshold,
  hullSize,
  isPlausibleVehicleSize,
  letterbox,
  mosaicMetersPerPixel,
  nms,
  nmsOptionsFor,
  planCrops,
  resampleFactor,
  unletterbox,
  windowOffsets,
  type VehicleCandidate,
} from "./yolo";

const tile2lon = (x: number, z: number): number => (x / 2 ** z) * 360 - 180;

function cand(p: Partial<VehicleCandidate>): VehicleCandidate {
  return {
    cx: 100,
    cy: 100,
    w: 45,
    h: 19,
    angle: 0,
    score: 0.9,
    classId: 3,
    classLabel: "car",
    ...p,
  };
}

const OBB_MANIFEST: VehicleModelManifest = {
  schemaVersion: 1,
  name: "dealer_vehicles",
  version: "test",
  task: "obb",
  outputFormat: "raw",
  imgsz: 640,
  gsdM: 0.1,
  classes: { "0": "car", "1": "large vehicle" },
  vehicleClasses: { "0": "car", "1": "truck" },
  classOffsets: { "1": 0.1 },
  trainingData: [],
  limitations: [],
};

describe("mosaicMetersPerPixel", () => {
  // A 200 m request around 51°N at z20 snaps to whole tiles plus one margin
  // tile per side — the mosaic is wider than the requested bbox.
  const z = 20;
  const xMin = 547_000;
  const tiles = 11;
  const lonSpan = tile2lon(xMin + tiles, z) - tile2lon(xMin, z);
  const width = tiles * 256;
  const bboxWest = tile2lon(xMin + 1.3, z);
  const bboxEast = tile2lon(xMin + tiles - 1.4, z);
  const bbox: [number, number, number, number] = [
    bboxWest,
    50.99,
    bboxEast,
    51.01,
  ];

  it("matches the Web Mercator resolution of the zoom level", () => {
    const expected = (156_543.034 * Math.cos((51 * Math.PI) / 180)) / 2 ** z;
    expect(mosaicMetersPerPixel({ width, bbox, lonSpan })).toBeCloseTo(
      expected,
      4,
    );
  });

  it("is not fooled by the requested bbox being smaller than the mosaic", () => {
    const fromBbox = mosaicMetersPerPixel({ width, bbox });
    const fromMosaic = mosaicMetersPerPixel({ width, bbox, lonSpan });
    // The old bbox-based estimate under-reports resolution by ~25 % here,
    // which made the 1.2 m width filter reject ordinary cars.
    expect(fromBbox / fromMosaic).toBeLessThan(0.8);
  });

  it("halves resolution one zoom level down", () => {
    const z19Span = tile2lon(xMin / 2 + 6, 19) - tile2lon(xMin / 2, 19);
    const z19 = mosaicMetersPerPixel({
      width: 6 * 256,
      bbox,
      lonSpan: z19Span,
    });
    const z20 = mosaicMetersPerPixel({ width, bbox, lonSpan });
    expect(z19 / z20).toBeCloseTo(2, 2);
  });
});

describe("effectiveThreshold", () => {
  it("raises and lowers with the user setting", () => {
    expect(effectiveThreshold(0.4, 0.13)).toBeCloseTo(0.53);
    expect(effectiveThreshold(0.1, 0.13)).toBeCloseTo(0.23);
    expect(effectiveThreshold(0.4)).toBeGreaterThan(effectiveThreshold(0.2));
  });

  it("stays inside (0, 1)", () => {
    expect(effectiveThreshold(0.95, 0.2)).toBe(0.99);
    expect(effectiveThreshold(0, -0.1)).toBe(0.01);
  });
});

describe("isPlausibleVehicleSize", () => {
  it("accepts a 4.5 × 1.9 m car at 0.1 m/px", () => {
    expect(isPlausibleVehicleSize(45, 19, 0.1)).toBe(true);
  });
  it("rejects specks, building-sized blobs, and slivers", () => {
    expect(isPlausibleVehicleSize(8, 6, 0.1)).toBe(false);
    expect(isPlausibleVehicleSize(250, 60, 0.1)).toBe(false);
    expect(isPlausibleVehicleSize(130, 15, 0.1)).toBe(false);
  });
});

describe("letterbox", () => {
  it("copies a full-size crop 1:1 without padding", () => {
    const px = new Uint8Array(4 * 4 * 4).fill(255);
    const lb = letterbox(px, 4, 4, 4);
    expect(lb.scale).toBe(1);
    expect(lb.padLeft).toBe(0);
    expect(Array.from(lb.tensor).every((v) => v === 1)).toBe(true);
  });

  it("pads small crops instead of upscaling them", () => {
    const px = new Uint8Array(2 * 2 * 4).fill(0);
    const lb = letterbox(px, 2, 2, 8);
    expect(lb.scale).toBe(1);
    expect(lb.padLeft).toBe(3);
    expect(lb.padTop).toBe(3);
    expect(lb.tensor[0]).toBeCloseTo(114 / 255);
    expect(lb.tensor[3 * 8 + 3]).toBe(0);
  });

  it("downsamples oversize crops and undoes it in unletterbox", () => {
    const px = new Uint8Array(16 * 8 * 4).fill(10);
    const lb = letterbox(px, 16, 8, 8);
    expect(lb.scale).toBe(0.5);
    expect(lb.padTop).toBe(2);
    const back = unletterbox(cand({ cx: 4, cy: 4, w: 2, h: 1 }), lb);
    expect(back).toMatchObject({ cx: 8, cy: 4, w: 4, h: 2 });
  });
});

/** Builds a raw `[1, channels, n]` tensor from per-anchor rows. */
function rawTensor(rows: number[][]): { data: Float32Array; dims: number[] } {
  const channels = rows[0].length;
  const n = rows.length;
  const data = new Float32Array(channels * n);
  rows.forEach((r, i) => r.forEach((v, c) => (data[c * n + i] = v)));
  return { data, dims: [1, channels, n] };
}

describe("decodeYoloOutput", () => {
  const legacyScores = (cls: number, s: number): number[] =>
    Array.from({ length: 11 }, (_, i) => (i === cls ? s : 0.01));

  it("decodes the legacy VisDrone detect layout with per-class offsets", () => {
    const { data, dims } = rawTensor([
      [100, 100, 45, 19, ...legacyScores(3, 0.3)], // car, passes 0.25
      [200, 200, 45, 19, ...legacyScores(5, 0.3)], // truck needs 0.25 + 0.13
      [300, 300, 45, 19, ...legacyScores(0, 0.9)], // pedestrian, ignored
    ]);
    const out = decodeYoloOutput(data, dims, {
      manifest: LEGACY_VISDRONE_MANIFEST,
      baseThreshold: 0.25,
      metersPerModelPixel: 0.1,
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ cx: 100, classLabel: "car", angle: 0 });
  });

  it("gets stricter when the user raises the threshold", () => {
    const { data, dims } = rawTensor([
      [100, 100, 45, 19, ...legacyScores(3, 0.3)],
    ]);
    const opts = {
      manifest: LEGACY_VISDRONE_MANIFEST,
      metersPerModelPixel: 0.1,
    };
    expect(
      decodeYoloOutput(data, dims, { ...opts, baseThreshold: 0.2 }),
    ).toHaveLength(1);
    expect(
      decodeYoloOutput(data, dims, { ...opts, baseThreshold: 0.4 }),
    ).toHaveLength(0);
  });

  it("drops implausibly small boxes in real-world meters", () => {
    const { data, dims } = rawTensor([
      [100, 100, 45, 19, ...legacyScores(3, 0.9)],
    ]);
    // At 0.05 m/model-px the box is only 0.95 m wide.
    expect(
      decodeYoloOutput(data, dims, {
        manifest: LEGACY_VISDRONE_MANIFEST,
        baseThreshold: 0.2,
        metersPerModelPixel: 0.05,
      }),
    ).toHaveLength(0);
  });

  it("decodes the raw OBB layout with the angle as last channel", () => {
    const { data, dims } = rawTensor([
      [100, 100, 45, 19, 0.8, 0.1, 0.6],
      [300, 300, 120, 30, 0.1, 0.45, 0.2], // truck: 0.45 < 0.4 + 0.1
    ]);
    const out = decodeYoloOutput(data, dims, {
      manifest: OBB_MANIFEST,
      baseThreshold: 0.4,
      metersPerModelPixel: 0.1,
    });
    expect(out).toHaveLength(1);
    expect(out[0].angle).toBeCloseTo(0.6);
  });

  it("decodes end2end rows", () => {
    const manifest = { ...OBB_MANIFEST, outputFormat: "end2end" as const };
    const data = new Float32Array([
      100,
      100,
      45,
      19,
      0.8,
      0,
      0.3,
      0,
      0,
      0,
      0,
      0,
      0,
      0, // padding row
    ]);
    const out = decodeYoloOutput(data, [1, 2, 7], {
      manifest,
      baseThreshold: 0.3,
      metersPerModelPixel: 0.1,
    });
    expect(out).toEqual([
      expect.objectContaining({ cx: 100, angle: expect.closeTo(0.3) }),
    ]);

    const detect = { ...manifest, task: "detect" as const };
    const xyxy = new Float32Array([80, 90, 125, 109, 0.8, 0]);
    expect(
      decodeYoloOutput(xyxy, [1, 1, 6], {
        manifest: detect,
        baseThreshold: 0.3,
        metersPerModelPixel: 0.1,
      })[0],
    ).toMatchObject({ cx: 102.5, cy: 99.5, w: 45, h: 19 });
  });

  it("fails loudly when the model doesn't match its manifest", () => {
    const { data, dims } = rawTensor([[100, 100, 45, 19, 0.8, 0.1, 0.6]]);
    expect(() =>
      decodeYoloOutput(data, dims, {
        manifest: LEGACY_VISDRONE_MANIFEST,
        baseThreshold: 0.2,
        metersPerModelPixel: 0.1,
      }),
    ).toThrow(/classes/);
  });
});

describe("boxOverlap and nms", () => {
  it("computes rotated overlap", () => {
    const a = cand({ w: 10, h: 10 });
    expect(boxOverlap(a, a).iou).toBeCloseTo(1);
    // A square rotated 45° against itself overlaps by the regular octagon
    // with apothem s/2: area 2·tan(π/8)·s², so IoU = √2/2.
    const r = boxOverlap(a, { ...a, angle: Math.PI / 4 });
    const inter = 2 * Math.tan(Math.PI / 8);
    expect(r.iou).toBeCloseTo(inter / (2 - inter), 4);
    expect(r.ios).toBeCloseTo(inter, 4);
  });

  it("merges a seam duplicate cut off by a window edge", () => {
    const full = cand({ cx: 100, w: 45, score: 0.9 });
    const half = cand({ cx: 89, w: 23, score: 0.6 });
    const kept = nms([half, full], nmsOptionsFor("detect"));
    expect(kept).toEqual([full]);
  });

  it("keeps tightly parked neighbours in an angled row when boxes are oriented", () => {
    // Cars 4.5 × 1.9 m at 0.1 m/px, rotated 45°, 2.5 m apart side by side.
    const angle = Math.PI / 4;
    const step = 25;
    const row = [0, 1, 2].map((i) =>
      cand({
        cx: 200 - i * step * Math.sin(angle),
        cy: 200 + i * step * Math.cos(angle),
        angle,
        score: 0.9 - i * 0.1,
      }),
    );
    expect(nms(row, nmsOptionsFor("obb"))).toHaveLength(3);
  });

  it("hullSize grows for rotated boxes", () => {
    const h = hullSize({ w: 45, h: 19, angle: Math.PI / 2 });
    expect(h.w).toBeCloseTo(19);
    expect(h.h).toBeCloseTo(45);
  });
});

describe("window planning", () => {
  it("keeps every window full-size and covers the whole mosaic", () => {
    expect(windowOffsets(1000, 640, 320)).toEqual([0, 320, 360]);
    expect(windowOffsets(640, 640, 320)).toEqual([0]);
    expect(windowOffsets(300, 640, 320)).toEqual([0]);
    const crops = planCrops(1000, 700, 640, 320);
    expect(crops.every((c) => c.w === 640 && c.h === 640)).toBe(true);
    expect(Math.max(...crops.map((c) => c.cropX + c.w))).toBe(1000);
    expect(Math.max(...crops.map((c) => c.cropY + c.h))).toBe(700);
  });

  it("uses one padded window for small mosaics", () => {
    expect(planCrops(300, 200, 640, 320)).toEqual([
      { cropX: 0, cropY: 0, w: 300, h: 200 },
    ]);
  });
});

describe("resampleFactor", () => {
  it("upsamples zoom-19 imagery towards the training resolution, bounded", () => {
    expect(resampleFactor(0.188, 0.1)).toBeCloseTo(1.88);
    expect(resampleFactor(0.6, 0.1)).toBe(2.5);
    expect(resampleFactor(0.02, 0.1)).toBe(0.5);
  });
  it("leaves near-matching imagery alone", () => {
    expect(resampleFactor(0.098, 0.1)).toBe(1);
    expect(resampleFactor(0, 0.1)).toBe(1);
  });
});

describe("model manifest", () => {
  it("accepts a training-export manifest and rejects a broken one", () => {
    const json = JSON.parse(JSON.stringify(OBB_MANIFEST));
    expect(parseVehicleModelManifest(json)?.task).toBe("obb");
    expect(
      parseVehicleModelManifest({ ...json, vehicleClasses: {} }),
    ).toBeNull();
    expect(parseVehicleModelManifest({ ...json, gsdM: 5 })).toBeNull();
  });
});
