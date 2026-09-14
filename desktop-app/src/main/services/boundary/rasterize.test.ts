import { describe, expect, it } from "vitest";
import {
  cellIndex,
  createGridSpec,
  maskAreaSqm,
  type GridSpec,
} from "./grid";
import {
  dilate,
  erode,
  polygonRasterIoU,
  rasterizeBarrier,
  rasterizeDisk,
  rasterizeMaskPolygon,
  rasterizePolygon,
  rasterizePolyline,
} from "./rasterize";
import { unprojectPoint, type LonLat } from "../boundary-geometry";
import type { Polygon } from "@shared/types";

const ORIGIN: LonLat = [13.4, 52.5];
const SPEC: GridSpec = createGridSpec(ORIGIN, 0.5, 400);

/** Builds a ring from metric offsets (east, north) about the grid origin. */
function ringFromMetres(points: Array<[number, number]>): LonLat[] {
  const ring = points.map((p) => unprojectPoint(p, ORIGIN));
  ring.push(ring[0]);
  return ring;
}

function rect(halfWidth: number, halfHeight: number, rotationDeg = 0): LonLat[] {
  const rad = (rotationDeg * Math.PI) / 180;
  const corners: Array<[number, number]> = [
    [-halfWidth, -halfHeight],
    [halfWidth, -halfHeight],
    [halfWidth, halfHeight],
    [-halfWidth, halfHeight],
  ];
  return ringFromMetres(
    corners.map(([x, y]) => [
      x * Math.cos(rad) - y * Math.sin(rad),
      x * Math.sin(rad) + y * Math.cos(rad),
    ]),
  );
}

function maskFor(ring: LonLat[], spec = SPEC): Uint8Array {
  const mask = new Uint8Array(spec.cols * spec.rows);
  rasterizeMaskPolygon(spec, ring, mask);
  return mask;
}

describe("rasterizePolygon", () => {
  it("fills an axis-aligned rectangle to its true area", () => {
    // 100 m x 50 m = 5000 m².
    const area = maskAreaSqm(SPEC, maskFor(rect(50, 25)));
    expect(area).toBeGreaterThan(5000 * 0.99);
    expect(area).toBeLessThan(5000 * 1.01);
  });

  it("preserves area when the rectangle is rotated", () => {
    const area = maskAreaSqm(SPEC, maskFor(rect(50, 25, 30)));
    expect(area).toBeGreaterThan(5000 * 0.98);
    expect(area).toBeLessThan(5000 * 1.02);
  });

  it("leaves the notch of a concave L-shape empty", () => {
    // L occupying the lower-left, with the upper-right quadrant cut out.
    const l = ringFromMetres([
      [-40, -40],
      [40, -40],
      [40, 0],
      [0, 0],
      [0, 40],
      [-40, 40],
    ]);
    const mask = maskFor(l);
    const at = (x: number, y: number): number => {
      const half = (SPEC.cols * SPEC.resolutionM) / 2;
      const col = Math.floor((x + half) / SPEC.resolutionM);
      const row = Math.floor((half - y) / SPEC.resolutionM);
      return mask[cellIndex(SPEC, col, row)];
    };
    expect(at(-20, -20)).toBe(1); // inside the foot
    expect(at(-20, 20)).toBe(1); // inside the upright
    expect(at(20, 20)).toBe(0); // the notch
  });

  it("accumulates weight rather than overwriting it", () => {
    const score = new Float32Array(SPEC.cols * SPEC.rows);
    rasterizePolygon(SPEC, rect(20, 20), score, 0.5);
    rasterizePolygon(SPEC, rect(20, 20), score, 0.5);
    expect(score[cellIndex(SPEC, 400, 400)]).toBeCloseTo(1, 5);
  });

  it("clips a ring that extends past the grid instead of wrapping", () => {
    const huge = rect(5000, 5000);
    const mask = maskFor(huge);
    // Every cell set, none lost.
    expect(mask.every((v) => v === 1)).toBe(true);
  });

  it("ignores degenerate rings", () => {
    const score = new Float32Array(SPEC.cols * SPEC.rows);
    expect(rasterizePolygon(SPEC, [[13.4, 52.5]], score, 1)).toBe(0);
  });
});

describe("rasterizePolyline", () => {
  it("buffers a straight line to width x length", () => {
    const line = [
      unprojectPoint([-50, 0], ORIGIN),
      unprojectPoint([50, 0], ORIGIN),
    ];
    const score = new Float32Array(SPEC.cols * SPEC.rows);
    const cells = rasterizePolyline(SPEC, line, 3, score, -1.5);
    const area = cells * SPEC.resolutionM * SPEC.resolutionM;
    // 100 m long, 6 m wide, plus the two semicircular caps (~28 m²).
    expect(area).toBeGreaterThan(600);
    expect(area).toBeLessThan(660);
  });

  it("writes overlapping segments once so corners do not double-score", () => {
    const doubledBack = [
      unprojectPoint([-20, 0], ORIGIN),
      unprojectPoint([20, 0], ORIGIN),
      unprojectPoint([-20, 0], ORIGIN),
    ];
    const score = new Float32Array(SPEC.cols * SPEC.rows);
    rasterizePolyline(SPEC, doubledBack, 2, score, -1);
    expect(score[cellIndex(SPEC, 400, 400)]).toBeCloseTo(-1, 5);
  });
});

describe("rasterizeDisk", () => {
  it("covers roughly pi r^2 with a flat falloff", () => {
    const score = new Float32Array(SPEC.cols * SPEC.rows);
    const cells = rasterizeDisk(SPEC, ORIGIN, 6, score, 1);
    const area = cells * SPEC.resolutionM * SPEC.resolutionM;
    expect(area).toBeGreaterThan(Math.PI * 36 * 0.95);
    expect(area).toBeLessThan(Math.PI * 36 * 1.05);
  });

  it("gauss falloff peaks at the centre and stays inside the radius", () => {
    const score = new Float32Array(SPEC.cols * SPEC.rows);
    rasterizeDisk(SPEC, ORIGIN, 6, score, 1, "gauss");
    const centre = score[cellIndex(SPEC, 400, 400)];
    const edge = score[cellIndex(SPEC, 411, 400)]; // ~5.5 m out
    expect(centre).toBeGreaterThan(edge);
    expect(edge).toBeGreaterThan(0);
    // 8 m out is beyond the 6 m radius.
    expect(score[cellIndex(SPEC, 416, 400)]).toBe(0);
  });
});

describe("rasterizeBarrier", () => {
  it("confines a 4-connected flood fill inside a closed square", () => {
    // This is the property the whole barrier mechanism rests on: region
    // growing is 4-connected, so a one-cell barrier must be watertight.
    const blocked = new Uint8Array(SPEC.cols * SPEC.rows);
    rasterizeBarrier(SPEC, rect(20, 20), blocked);

    const seen = new Uint8Array(SPEC.cols * SPEC.rows);
    const start = cellIndex(SPEC, 400, 400);
    expect(blocked[start]).toBe(0);
    const queue = [start];
    seen[start] = 1;
    let escaped = false;
    while (queue.length > 0) {
      const index = queue.pop()!;
      const col = index % SPEC.cols;
      const row = Math.floor(index / SPEC.cols);
      if (col === 0 || row === 0 || col === SPEC.cols - 1 || row === SPEC.rows - 1) {
        escaped = true;
        break;
      }
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const next = cellIndex(SPEC, col + dc, row + dr);
        if (seen[next] || blocked[next]) continue;
        seen[next] = 1;
        queue.push(next);
      }
    }
    expect(escaped).toBe(false);
  });

  it("stays watertight for a diagonal barrier", () => {
    // A Bresenham line would step diagonally here and leak through the corner.
    const blocked = new Uint8Array(SPEC.cols * SPEC.rows);
    rasterizeBarrier(SPEC, rect(20, 20, 37), blocked);

    const seen = new Uint8Array(SPEC.cols * SPEC.rows);
    const start = cellIndex(SPEC, 400, 400);
    const queue = [start];
    seen[start] = 1;
    let escaped = false;
    while (queue.length > 0 && !escaped) {
      const index = queue.pop()!;
      const col = index % SPEC.cols;
      const row = Math.floor(index / SPEC.cols);
      if (col === 0 || row === 0 || col === SPEC.cols - 1 || row === SPEC.rows - 1) {
        escaped = true;
        break;
      }
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const next = cellIndex(SPEC, col + dc, row + dr);
        if (seen[next] || blocked[next]) continue;
        seen[next] = 1;
        queue.push(next);
      }
    }
    expect(escaped).toBe(false);
  });

  it("marks each cell once and reports the count", () => {
    const blocked = new Uint8Array(SPEC.cols * SPEC.rows);
    const first = rasterizeBarrier(SPEC, rect(20, 20), blocked);
    const second = rasterizeBarrier(SPEC, rect(20, 20), blocked);
    expect(first).toBeGreaterThan(0);
    expect(second).toBe(0);
  });
});

describe("dilate / erode", () => {
  it("dilation grows a rectangle and erosion shrinks it back", () => {
    const mask = maskFor(rect(20, 20));
    const grown = dilate(SPEC, mask, 4);
    const shrunk = erode(SPEC, grown, 4);
    expect(maskAreaSqm(SPEC, grown)).toBeGreaterThan(maskAreaSqm(SPEC, mask));
    // Closing a solid shape returns (approximately) the original.
    expect(maskAreaSqm(SPEC, shrunk)).toBeCloseTo(maskAreaSqm(SPEC, mask), -1);
  });

  it("a zero radius is a copy, not an alias", () => {
    const mask = maskFor(rect(10, 10));
    const copy = dilate(SPEC, mask, 0);
    copy[0] = 1;
    expect(mask[0]).toBe(0);
  });

  it("closing bridges a narrow gap between two blobs", () => {
    const mask = new Uint8Array(SPEC.cols * SPEC.rows);
    rasterizeMaskPolygon(SPEC, rect(10, 20), mask);
    const right = ringFromMetres([
      [12, -20],
      [32, -20],
      [32, 20],
      [12, 20],
    ]);
    rasterizeMaskPolygon(SPEC, right, mask);
    const closed = erode(SPEC, dilate(SPEC, mask, 4), 4);
    expect(maskAreaSqm(SPEC, closed)).toBeGreaterThan(maskAreaSqm(SPEC, mask));
  });
});

describe("polygonRasterIoU", () => {
  const poly = (ring: LonLat[]): Polygon => ({
    type: "Polygon",
    coordinates: [ring],
  });

  it("is 1 for a polygon against itself", () => {
    const p = poly(rect(30, 30));
    expect(polygonRasterIoU(p, p)).toBeCloseTo(1, 2);
  });

  it("is 0 for disjoint polygons", () => {
    const a = poly(rect(10, 10));
    const b = poly(
      ringFromMetres([
        [100, 100],
        [120, 100],
        [120, 120],
        [100, 120],
      ]),
    );
    expect(polygonRasterIoU(a, b)).toBe(0);
  });

  it("reports 1/3 for a square overlapping half of an equal square", () => {
    const a = poly(rect(20, 20));
    const b = poly(
      ringFromMetres([
        [0, -20],
        [40, -20],
        [40, 20],
        [0, 20],
      ]),
    );
    expect(polygonRasterIoU(a, b)).toBeCloseTo(1 / 3, 2);
  });

  it("resolves a 2 m offset that a 200x200 sample grid would blur away", () => {
    const a = poly(rect(100, 100));
    const b = poly(
      ringFromMetres([
        [-98, -100],
        [102, -100],
        [102, 100],
        [-98, 100],
      ]),
    );
    const iou = polygonRasterIoU(a, b, 0.5);
    // 200 m wide squares offset by 2 m: intersection 198/202 of the union.
    expect(iou).toBeGreaterThan(0.97);
    expect(iou).toBeLessThan(0.99);
  });

  it("returns 0 for a degenerate ring instead of throwing", () => {
    const degenerate = { type: "Polygon" as const, coordinates: [[[13.4, 52.5]]] };
    expect(
      polygonRasterIoU(degenerate as never, poly(rect(10, 10))),
    ).toBe(0);
  });
});
