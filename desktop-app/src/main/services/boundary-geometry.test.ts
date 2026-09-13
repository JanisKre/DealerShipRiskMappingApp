import { describe, expect, it } from "vitest";
import {
  approximatePolygonIoU,
  checkRing,
  convexHull,
  distanceToRingM,
  nonConvexHull,
  outlinePoints,
  type Point2D,
} from "./boundary-geometry";
import { polygon as turfPolygon } from "@turf/helpers";
import type { Polygon } from "@shared/types";

function ringArea(ring: Point2D[]): number {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(area / 2);
}

function segmentsCross(
  [ax, ay]: Point2D,
  [bx, by]: Point2D,
  [cx, cy]: Point2D,
  [dx, dy]: Point2D,
): boolean {
  const o = (p: Point2D, q: Point2D, r: Point2D): number =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const o1 = o([ax, ay], [bx, by], [cx, cy]);
  const o2 = o([ax, ay], [bx, by], [dx, dy]);
  const o3 = o([cx, cy], [dx, dy], [ax, ay]);
  const o4 = o([cx, cy], [dx, dy], [bx, by]);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function isSimplePolygon(ring: Point2D[]): boolean {
  const open = ring.slice(0, -1);
  for (let i = 0; i < open.length; i += 1) {
    for (let j = i + 1; j < open.length; j += 1) {
      if (j === i + 1 || (i === 0 && j === open.length - 1)) continue;
      if (
        segmentsCross(
          open[i],
          open[(i + 1) % open.length],
          open[j],
          open[(j + 1) % open.length],
        )
      )
        return false;
    }
  }
  return true;
}

function pointInRing([px, py]: Point2D, ring: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = yi > py !== yj > py;
    if (crosses && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function distanceToSegment(
  [px, py]: Point2D,
  [ax, ay]: Point2D,
  [bx, by]: Point2D,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(
    0,
    Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)),
  );
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Inside, or on/very near an edge — points exactly on the returned
 * boundary are the expected (and correct) outcome for a raster outline, and
 * plain ray-casting is unreliable exactly on axis-aligned edges. */
function pointInOrOnRing(p: Point2D, ring: Point2D[]): boolean {
  if (pointInRing(p, ring)) return true;
  for (let i = 0; i < ring.length - 1; i += 1) {
    if (distanceToSegment(p, ring[i], ring[i + 1]) < 1e-6) return true;
  }
  return false;
}

const square = (offsetM = 0): Polygon => {
  const d = offsetM / 111_320;
  return turfPolygon([
    [
      [10 + d, 51 + d],
      [10.001 + d, 51 + d],
      [10.001 + d, 51.001 + d],
      [10 + d, 51.001 + d],
      [10 + d, 51 + d],
    ],
  ]).geometry as Polygon;
};

describe("boundary geometry quality", () => {
  it("rejects open and self-intersecting rings", () => {
    expect(checkRing(square().coordinates[0] as [number, number][]).valid).toBe(
      true,
    );
    expect(
      checkRing([
        [10, 51],
        [10.001, 51.001],
        [10, 51.001],
        [10.001, 51],
        [10, 51],
      ]).valid,
    ).toBe(false);
  });

  it("calculates overlap and metric distances", () => {
    const a = square() as Polygon;
    const b = square(2) as Polygon;
    expect(approximatePolygonIoU(a, a)).toBeGreaterThan(0.95);
    expect(approximatePolygonIoU(a, b)).toBeGreaterThan(0.9);
    expect(
      distanceToRingM(
        [10.0005, 51.0005],
        a.coordinates[0] as [number, number][],
      ),
    ).toBeGreaterThan(30);
  });
});

/** Dense point fill of an axis-aligned rectangle, at `spacing` intervals. */
function fillRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  spacing = 2,
): Point2D[] {
  const points: Point2D[] = [];
  for (let x = x0; x <= x1; x += spacing) {
    for (let y = y0; y <= y1; y += spacing) {
      points.push([x, y]);
    }
  }
  return points;
}

describe("nonConvexHull", () => {
  // nonConvexHull expects an outline-ish point set (see its docstring) — a
  // dense area fill needs outlinePoints() first, exactly as
  // surface-boundary.service.ts does for the real paved-surface pixel mask.
  const STEP = 2;
  const outline = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    exclude: (p: Point2D) => boolean = () => false,
  ): Point2D[] =>
    outlinePoints(
      fillRect(x0, y0, x1, y1, STEP).filter((p) => !exclude(p)),
      STEP,
    );

  it("digs into an L-shaped point cloud instead of bridging the missing quadrant", () => {
    // An L-shape: a 100x100 block with the top-right 50x50 quadrant empty —
    // the paved-surface equivalent of the dealership screenshot, where a
    // convex hull bridges the missing corner with a straight edge and
    // swallows whatever sits in it (trees, a road, a neighbouring lot).
    const points = outline(0, 0, 100, 100, ([x, y]) => x > 50 && y > 50);

    const hull = convexHull(points);
    const concave = nonConvexHull(points);

    const hullArea = ringArea(hull);
    const concaveArea = ringArea(concave);
    const trueArea = 100 * 100 - 50 * 50;

    // The convex hull bridges the empty quadrant (~2500 extra sqm); the
    // concave hull should reclaim most of that back.
    expect(hullArea).toBeGreaterThan(trueArea * 1.15);
    expect(concaveArea).toBeLessThan(hullArea * 0.9);
    expect(concaveArea).toBeLessThan(trueArea * 1.15);

    // Every input point must remain inside (or on) the returned boundary.
    for (const p of points) {
      expect(pointInOrOnRing(p, concave)).toBe(true);
    }
    expect(isSimplePolygon(concave)).toBe(true);
  });

  it("leaves a genuinely convex point cloud unchanged", () => {
    const points = outline(0, 0, 60, 40);
    const hull = convexHull(points);
    const concave = nonConvexHull(points);

    expect(ringArea(concave)).toBeGreaterThan(ringArea(hull) * 0.97);
    expect(isSimplePolygon(concave)).toBe(true);
  });

  it("never self-intersects and always contains every input point", () => {
    // An irregular cross/plus shape — several concavities on adjacent edges.
    const points = outlinePoints(
      [...fillRect(20, 0, 40, 60, STEP), ...fillRect(0, 20, 60, 40, STEP)],
      STEP,
    );
    const concave = nonConvexHull(points, { minDigDistance: 2 });

    expect(isSimplePolygon(concave)).toBe(true);
    for (const p of points) {
      expect(pointInOrOnRing(p, concave)).toBe(true);
    }
    // The cross has real concave notches, so it should be noticeably
    // tighter than its convex hull.
    expect(ringArea(concave)).toBeLessThan(ringArea(convexHull(points)) * 0.9);
  });

  it("handles degenerate inputs without throwing", () => {
    expect(nonConvexHull([])).toEqual([]);
    expect(nonConvexHull([[0, 0]])).toEqual([[0, 0]]);
    expect(
      nonConvexHull([
        [0, 0],
        [1, 1],
        [2, 0],
      ]).length,
    ).toBeGreaterThan(0);
  });
});

describe("outlinePoints", () => {
  it("keeps only cells adjacent to an empty neighbor", () => {
    const solid = fillRect(0, 0, 20, 20, 2);
    const outline = outlinePoints(solid, 2);
    expect(outline.length).toBeLessThan(solid.length);
    // A deep-interior point (well away from every edge) must be dropped.
    expect(outline.some(([x, y]) => x === 10 && y === 10)).toBe(false);
    // A corner point must be kept.
    expect(outline.some(([x, y]) => x === 0 && y === 0)).toBe(true);
  });
});
