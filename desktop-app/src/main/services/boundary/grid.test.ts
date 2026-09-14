import { describe, expect, it } from "vitest";
import {
  cellIndex,
  cellToLonLat,
  createGrid,
  createGridSpec,
  lonLatToCell,
  maskAreaSqm,
  rasterCoverage,
  rasterIoU,
} from "./grid";
import type { LonLat } from "../boundary-geometry";

const ORIGIN: LonLat = [13.4, 52.5];

describe("evidence grid", () => {
  it("sizes a 400 m / 0.5 m grid as 800 x 800", () => {
    const spec = createGridSpec(ORIGIN, 0.5, 400);
    expect(spec.cols).toBe(800);
    expect(spec.rows).toBe(800);
  });

  it("allocates score and blocked planes of matching length", () => {
    const grid = createGrid(ORIGIN, 1, 100);
    expect(grid.score).toHaveLength(100 * 100);
    expect(grid.blocked).toHaveLength(100 * 100);
  });

  it("rejects a non-positive resolution or extent", () => {
    expect(() => createGridSpec(ORIGIN, 0, 400)).toThrow();
    expect(() => createGridSpec(ORIGIN, 0.5, 0)).toThrow();
  });

  it("round-trips cell -> lon/lat -> cell across the grid", () => {
    const spec = createGridSpec(ORIGIN, 0.5, 400);
    for (const [col, row] of [
      [0, 0],
      [399, 399],
      [400, 400],
      [799, 799],
      [0, 799],
      [799, 0],
    ]) {
      const point = cellToLonLat(spec, col, row);
      expect(lonLatToCell(spec, point)).toEqual({ col, row });
    }
  });

  it("puts the origin at the grid centre", () => {
    const spec = createGridSpec(ORIGIN, 0.5, 400);
    expect(lonLatToCell(spec, ORIGIN)).toEqual({ col: 400, row: 400 });
  });

  it("row 0 is north of the last row", () => {
    const spec = createGridSpec(ORIGIN, 0.5, 400);
    expect(cellToLonLat(spec, 400, 0)[1]).toBeGreaterThan(
      cellToLonLat(spec, 400, spec.rows - 1)[1],
    );
  });

  it("returns null outside the grid instead of clamping", () => {
    const spec = createGridSpec(ORIGIN, 0.5, 400);
    // ~1 km east, well beyond the 200 m half-span.
    expect(lonLatToCell(spec, [ORIGIN[0] + 0.015, ORIGIN[1]])).toBeNull();
    expect(lonLatToCell(spec, [ORIGIN[0], ORIGIN[1] + 0.01])).toBeNull();
  });

  it("computes mask area from the cell size", () => {
    const spec = createGridSpec(ORIGIN, 0.5, 400);
    const mask = new Uint8Array(spec.cols * spec.rows).fill(1);
    expect(maskAreaSqm(spec, mask)).toBeCloseTo(160_000, 0);
    const single = new Uint8Array(spec.cols * spec.rows);
    single[cellIndex(spec, 10, 10)] = 1;
    expect(maskAreaSqm(spec, single)).toBeCloseTo(0.25, 6);
  });

  describe("rasterIoU", () => {
    it("is 1 for identical masks and 0 for disjoint ones", () => {
      const a = Uint8Array.from([1, 1, 0, 0]);
      const b = Uint8Array.from([0, 0, 1, 1]);
      expect(rasterIoU(a, a)).toBe(1);
      expect(rasterIoU(a, b)).toBe(0);
    });

    it("is 1/3 for masks overlapping in half their cells", () => {
      // |A|=2, |B|=2, intersection 1, union 3.
      const a = Uint8Array.from([1, 1, 0, 0]);
      const b = Uint8Array.from([0, 1, 1, 0]);
      expect(rasterIoU(a, b)).toBeCloseTo(1 / 3, 10);
    });

    it("is 0 when both masks are empty rather than NaN", () => {
      expect(rasterIoU(new Uint8Array(4), new Uint8Array(4))).toBe(0);
    });

    it("refuses mismatched masks", () => {
      expect(() => rasterIoU(new Uint8Array(4), new Uint8Array(9))).toThrow();
    });
  });

  describe("rasterCoverage", () => {
    it("measures how much of the reference the prediction covers", () => {
      const reference = Uint8Array.from([1, 1, 1, 1]);
      const predicted = Uint8Array.from([1, 1, 0, 0]);
      expect(rasterCoverage(reference, predicted)).toBe(0.5);
      // Asymmetric: a prediction that swallows everything covers it fully.
      expect(rasterCoverage(predicted, reference)).toBe(1);
    });
  });
});
