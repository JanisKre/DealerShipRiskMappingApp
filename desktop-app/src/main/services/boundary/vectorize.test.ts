import { describe, expect, it } from "vitest";
import { createGridSpec, maskAreaSqm, type GridSpec } from "./grid";
import { rasterizeMaskPolygon } from "./rasterize";
import {
  area2D,
  dominantAngleRad,
  maskToPolygon,
  maskToRings,
  regularizeRectilinear,
  simplifyRing,
} from "./vectorize";
import {
  checkRing,
  ringAreaSqm,
  unprojectPoint,
  type LonLat,
  type Point2D,
} from "../boundary-geometry";

const ORIGIN: LonLat = [13.4, 52.5];
const SPEC: GridSpec = createGridSpec(ORIGIN, 0.5, 400);

function rect(halfW: number, halfH: number, rotationDeg = 0): LonLat[] {
  const rad = (rotationDeg * Math.PI) / 180;
  const corners: Array<[number, number]> = [
    [-halfW, -halfH],
    [halfW, -halfH],
    [halfW, halfH],
    [-halfW, halfH],
  ];
  const ring = corners
    .map(([x, y]): [number, number] => [
      x * Math.cos(rad) - y * Math.sin(rad),
      x * Math.sin(rad) + y * Math.cos(rad),
    ])
    .map((c) => unprojectPoint(c, ORIGIN));
  ring.push(ring[0]);
  return ring;
}

function maskOf(rings: LonLat[][]): Uint8Array {
  const mask = new Uint8Array(SPEC.cols * SPEC.rows);
  for (const ring of rings) rasterizeMaskPolygon(SPEC, ring, mask);
  return mask;
}

const deg = (rad: number): number => (rad * 180) / Math.PI;

describe("maskToRings", () => {
  it("traces one closed ring around a filled rectangle", () => {
    const rings = maskToRings(SPEC, maskOf([rect(40, 25)]));
    expect(rings).toHaveLength(1);
    expect(rings[0][0]).toEqual(rings[0][rings[0].length - 1]);
  });

  it("returns the larger island first", () => {
    const mask = new Uint8Array(SPEC.cols * SPEC.rows);
    const small: LonLat[] = [
      [13.4, 52.5],
      [13.4, 52.5],
    ];
    void small;
    rasterizeMaskPolygon(SPEC, rect(40, 40), mask);
    // A separate small square 150 m east.
    const east = [
      [-150 + -8, -8],
      [-150 + 8, -8],
      [-150 + 8, 8],
      [-150 - 8, 8],
    ]
      .map((c) => unprojectPoint(c as [number, number], ORIGIN))
      .concat([unprojectPoint([-158, -8], ORIGIN)]);
    rasterizeMaskPolygon(SPEC, east as LonLat[], mask);

    const rings = maskToRings(SPEC, mask);
    expect(rings.length).toBeGreaterThanOrEqual(2);
    expect(Math.abs(area2D(rings[0]))).toBeGreaterThan(
      Math.abs(area2D(rings[1])),
    );
  });

  it("traces an inner ring for an enclosed hole", () => {
    const mask = maskOf([rect(60, 60)]);
    const hole = new Uint8Array(SPEC.cols * SPEC.rows);
    rasterizeMaskPolygon(SPEC, rect(15, 15), hole);
    for (let i = 0; i < mask.length; i += 1) if (hole[i]) mask[i] = 0;

    const rings = maskToRings(SPEC, mask);
    expect(rings.length).toBe(2);
  });

  it("returns nothing for an empty mask", () => {
    expect(maskToRings(SPEC, new Uint8Array(SPEC.cols * SPEC.rows))).toHaveLength(
      0,
    );
  });
});

describe("simplifyRing", () => {
  it("reduces a raster staircase to a handful of corners", () => {
    const traced = maskToRings(SPEC, maskOf([rect(40, 25)]))[0];
    expect(traced.length).toBeGreaterThan(100);
    const simplified = simplifyRing(traced, 2); // 2 cells = 1 m
    expect(simplified.length).toBeLessThanOrEqual(9);
    // Area must survive simplification.
    expect(Math.abs(area2D(simplified))).toBeCloseTo(
      Math.abs(area2D(traced)),
      -2,
    );
  });

  it("leaves an already-minimal ring alone", () => {
    const square: Point2D[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ];
    expect(simplifyRing(square, 1)).toEqual(square);
  });
});

describe("dominantAngleRad", () => {
  it("reports 0 for an axis-aligned rectangle", () => {
    const traced = maskToRings(SPEC, maskOf([rect(40, 25)]))[0];
    const angle = deg(dominantAngleRad(simplifyRing(traced, 2)));
    // Folded into [0,90), so 0 and 90 are the same answer.
    expect(Math.min(angle, 90 - angle)).toBeLessThan(2);
  });

  it("recovers a 30 degree rotation", () => {
    const traced = maskToRings(SPEC, maskOf([rect(50, 30, 30)]))[0];
    const angle = deg(dominantAngleRad(simplifyRing(traced, 2)));
    // Corner space runs rows southwards, so a +30 degrees rotation on the
    // ground appears as -30 degrees here, which folds to 60 in [0,90). The
    // angle only ever describes a grid, and it is consumed in the same frame
    // it is measured in.
    expect(Math.abs(angle - 60)).toBeLessThan(2.5);
  });

  it("describes the same grid whichever way the rectangle is rotated", () => {
    // 30 and 120 degrees are the same rectilinear grid.
    const a = deg(
      dominantAngleRad(simplifyRing(maskToRings(SPEC, maskOf([rect(50, 30, 30)]))[0], 2)),
    );
    const b = deg(
      dominantAngleRad(simplifyRing(maskToRings(SPEC, maskOf([rect(50, 30, 120)]))[0], 2)),
    );
    expect(Math.abs(a - b)).toBeLessThan(3);
  });

  it("is not swayed by many short jagged segments", () => {
    // Two long axis-aligned sides must outvote a noisy end.
    const ring: Point2D[] = [[0, 0], [200, 0], [200, 40]];
    for (let i = 0; i < 20; i += 1) {
      ring.push([200 - i * 2, 40 + (i % 2 === 0 ? 1 : -1)]);
    }
    ring.push([0, 40], [0, 0]);
    const angle = deg(dominantAngleRad(ring));
    expect(Math.min(angle, 90 - angle)).toBeLessThan(5);
  });
});

describe("regularizeRectilinear", () => {
  it("squares up a noisy axis-aligned rectangle", () => {
    const ring: Point2D[] = [
      [0, 0.3],
      [100, -0.2],
      [99.7, 50.4],
      [0.4, 49.8],
      [0, 0.3],
    ];
    const squared = regularizeRectilinear(ring, 0, 12);
    expect(squared).not.toBe(ring);
    for (let i = 0; i < squared.length - 1; i += 1) {
      const dx = Math.abs(squared[i + 1][0] - squared[i][0]);
      const dy = Math.abs(squared[i + 1][1] - squared[i][1]);
      // Every edge is now axis-parallel.
      expect(Math.min(dx, dy)).toBeLessThan(1e-6);
    }
    expect(Math.abs(area2D(squared))).toBeCloseTo(Math.abs(area2D(ring)), -2);
  });

  it("leaves a genuinely diagonal edge alone", () => {
    // A lot cut off by a railway keeps its diagonal.
    const ring: Point2D[] = [
      [0, 0],
      [100, 0],
      [100, 50],
      [50, 90],
      [0, 50],
      [0, 0],
    ];
    const squared = regularizeRectilinear(ring, 0, 12);
    const hasDiagonal = squared.some((_, i) => {
      if (i === squared.length - 1) return false;
      const dx = Math.abs(squared[i + 1][0] - squared[i][0]);
      const dy = Math.abs(squared[i + 1][1] - squared[i][1]);
      return dx > 1 && dy > 1;
    });
    expect(hasDiagonal).toBe(true);
  });

  it("refuses a result that would change the area materially", () => {
    const ring: Point2D[] = [
      [0, 0],
      [100, 0],
      [100, 50],
      [0, 50],
      [0, 0],
    ];
    // A 0% tolerance budget makes any change unacceptable.
    const out = regularizeRectilinear(ring, 0.6, 40, 0);
    expect(out).toBe(ring);
  });

  it("returns the input for a degenerate ring", () => {
    const tiny: Point2D[] = [
      [0, 0],
      [1, 0],
      [0, 0],
    ];
    expect(regularizeRectilinear(tiny, 0, 12)).toBe(tiny);
  });
});

describe("maskToPolygon", () => {
  it("produces a valid, closed, simple geographic ring", () => {
    const result = maskToPolygon(SPEC, maskOf([rect(40, 25)]));
    expect(result).not.toBeNull();
    const check = checkRing(result!.ring, { minAreaSqm: 1 });
    expect(check.valid).toBe(true);
    expect(check.reason).toBeUndefined();
  });

  it("preserves the site area through the whole chain", () => {
    const mask = maskOf([rect(40, 25)]);
    const rasterArea = maskAreaSqm(SPEC, mask);
    const result = maskToPolygon(SPEC, mask)!;
    const ringArea = ringAreaSqm(result.ring);
    expect(Math.abs(ringArea - rasterArea) / rasterArea).toBeLessThan(0.05);
  });

  it("turns a staircase into a handful of vertices", () => {
    const result = maskToPolygon(SPEC, maskOf([rect(40, 25)]))!;
    expect(result.ring.length).toBeLessThanOrEqual(10);
  });

  it("keeps an L-shaped site concave", () => {
    const l: LonLat[] = (
      [
        [-40, -40],
        [40, -40],
        [40, 0],
        [0, 0],
        [0, 40],
        [-40, 40],
      ] as Array<[number, number]>
    ).map((c) => unprojectPoint(c, ORIGIN));
    l.push(l[0]);
    const result = maskToPolygon(SPEC, maskOf([l]))!;
    // A convex hull would report ~6400 m²; the L is ~4800 m².
    const area = ringAreaSqm(result.ring);
    expect(area).toBeGreaterThan(4_300);
    expect(area).toBeLessThan(5_300);
  });

  it("returns null for an empty mask", () => {
    expect(
      maskToPolygon(SPEC, new Uint8Array(SPEC.cols * SPEC.rows)),
    ).toBeNull();
  });

  it("is deterministic", () => {
    const mask = maskOf([rect(37, 23, 18)]);
    expect(maskToPolygon(SPEC, mask)).toEqual(maskToPolygon(SPEC, mask));
  });
});
