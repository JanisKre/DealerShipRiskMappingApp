import { describe, expect, it } from "vitest";
import {
  area,
  boxAtClick,
  boxFromDrag,
  circularMeanAxis,
  contains,
  fromCorners,
  hitTest,
  longAxis,
  resizeCorner,
  rotateBy,
  rotateTowards,
  toCorners,
  type Pt,
} from "./geometry";

const close = (a: number, b: number, eps = 1e-6): void =>
  expect(Math.abs(a - b)).toBeLessThan(eps);

describe("oriented boxes", () => {
  it("round-trips corners and oriented form", () => {
    const o = { cx: 100, cy: 200, w: 46, h: 19, angle: 0.4 };
    const back = fromCorners(toCorners(o));
    close(back.cx, 100);
    close(back.cy, 200);
    close(back.w, 46);
    close(back.h, 19);
    close(back.angle, 0.4);
  });

  it("reads the model's corner order (short side first) as the same long axis", () => {
    const model: Pt[] = [
      [351.57, 536.82],
      [343.98, 560.56],
      [298.15, 545.92],
      [305.74, 522.18],
    ];
    const o = fromCorners(model);
    expect(Math.max(o.w, o.h)).toBeGreaterThan(45);
    const axis = longAxis(o);
    close(axis, Math.atan2(536.82 - 522.18, 351.57 - 305.74), 0.05);
  });

  it("finds the smallest box under a point", () => {
    const big = boxFromDrag([0, 0], [200, 200]);
    const car = toCorners({ cx: 50, cy: 50, w: 46, h: 19, angle: 0.3 });
    expect(hitTest([{ corners: big }, { corners: car }], [50, 50])).toBe(1);
    expect(hitTest([{ corners: big }, { corners: car }], [150, 150])).toBe(0);
    expect(hitTest([{ corners: car }], [300, 300])).toBeNull();
  });

  it("tests containment for both windings", () => {
    const box = boxFromDrag([10, 10], [30, 20]);
    expect(contains(box, [20, 15])).toBe(true);
    expect(contains([...box].reverse(), [20, 15])).toBe(true);
    expect(contains(box, [31, 15])).toBe(false);
  });

  it("keeps the opposite corner fixed when resizing a rotated box", () => {
    const corners = toCorners({ cx: 100, cy: 100, w: 40, h: 20, angle: 0.5 });
    const resized = resizeCorner(corners, 2, [140, 140]);
    close(resized[0][0], corners[0][0], 1e-6);
    close(resized[0][1], corners[0][1], 1e-6);
    close(fromCorners(resized).angle, 0.5);
    expect(area(resized)).toBeGreaterThan(area(corners));
  });

  it("never collapses a box below 4 px", () => {
    const corners = boxFromDrag([0, 0], [40, 20]);
    const o = fromCorners(resizeCorner(corners, 2, [0, 0]));
    expect(o.w).toBeGreaterThanOrEqual(4);
    expect(o.h).toBeGreaterThanOrEqual(4);
  });

  it("rotates about the centre", () => {
    const corners = boxFromDrag([0, 0], [40, 20]);
    const turned = fromCorners(rotateBy(corners, Math.PI / 2));
    close(turned.cx, 20);
    close(turned.cy, 10);
    close(turned.angle, Math.PI / 2);
  });

  it("turns the top edge towards the rotation handle", () => {
    const corners = boxFromDrag([0, 0], [40, 20]);
    const o = fromCorners(rotateTowards(corners, [20, -50]));
    close(o.angle, 0);
    const right = fromCorners(rotateTowards(corners, [100, 10]));
    close(right.angle, Math.PI / 2);
  });
});

describe("click to add", () => {
  it("orients a new box like its neighbours and sizes it like them", () => {
    const row = [0, 1, 2].map((i) => ({
      corners: toCorners({ cx: 100 + i * 25, cy: 100, w: 20, h: 48, angle: 0 }),
    }));
    const added = fromCorners(boxAtClick([175, 100], row));
    close(longAxis(added), Math.PI / 2, 1e-6);
    close(Math.max(added.w, added.h), 48);
    close(Math.min(added.w, added.h), 20);
  });

  it("falls back to the default car size without neighbours", () => {
    const o = fromCorners(boxAtClick([300, 300], []));
    close(o.w, 46);
    close(o.h, 19);
    close(o.angle, 0);
  });

  it("averages axes across the 0/180° wrap", () => {
    const mean = circularMeanAxis([0.05, Math.PI - 0.05]);
    expect(Math.min(mean, Math.PI - mean)).toBeLessThan(1e-9);
  });
});
