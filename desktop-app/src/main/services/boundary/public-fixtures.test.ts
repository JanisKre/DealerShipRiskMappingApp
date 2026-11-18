import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The public reference set (`resources/benchmarks/boundary-public-fixtures.json`)
 * and the roof test of the script that builds it. Version 1 of the set held
 * eight showroom roofs among its 17 "lots", because the script neither
 * excluded building-tagged ways nor measured the roof share
 * (docs/boundary-model.md, "Reference set v2").
 */

type Ring = Array<[number, number]>;

interface Fixture {
  id: string;
  areaSqm: number;
  roofShare?: number;
  holdout: boolean;
  state: string;
  reference: { type: "Polygon"; coordinates: Ring[] };
}

const file = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      "../../../../resources/benchmarks/boundary-public-fixtures.json",
    ),
    "utf8",
  ),
) as { dataset: string; samples: Fixture[] };

const M = 1 / 111_320;
/** A rectangle in metres around (10° E, 0° N), where 1° is 111,320 m both ways. */
const rect = (w: number, s: number, e: number, n: number): Ring => [
  [10 + w * M, s * M],
  [10 + e * M, s * M],
  [10 + e * M, n * M],
  [10 + w * M, n * M],
  [10 + w * M, s * M],
];

describe("roof test of the fixture builder", () => {
  it("measures how much of an outline lies under buildings", async () => {
    // A plain Node script without type declarations.
    const { roofShare } =
      (await import("../../../../scripts/build-public-boundary-fixtures.mjs")) as {
        roofShare: (ring: Ring, buildings: Ring[]) => number;
      };
    const lot = rect(0, 0, 100, 60);
    // The outline is the showroom itself.
    expect(roofShare(lot, [rect(-1, -1, 101, 61)])).toBe(1);
    // A lot with its showroom on a quarter of it.
    expect(roofShare(lot, [rect(0, 0, 50, 30)])).toBeCloseTo(0.25, 1);
    // Buildings elsewhere do not count.
    expect(roofShare(lot, [rect(200, 0, 260, 60)])).toBe(0);
    expect(roofShare(lot, [])).toBe(0);
  });
});

describe("public boundary fixtures", () => {
  it("is the roof-checked set", () => {
    expect(file.dataset).toBe("boundary-public-v2");
    expect(file.samples.length).toBeGreaterThanOrEqual(30);
  });

  it("holds no reference that is mostly roof", () => {
    for (const sample of file.samples) {
      expect(sample.roofShare, sample.id).toBeDefined();
      expect(sample.roofShare!, sample.id).toBeLessThanOrEqual(0.6);
    }
  });

  it("keeps whole regions out for the hold-out", () => {
    const states = (holdout: boolean): Set<string> =>
      new Set(
        file.samples.filter((s) => s.holdout === holdout).map((s) => s.state),
      );
    const tuning = states(false);
    const held = states(true);
    expect(held.size).toBeGreaterThan(0);
    for (const state of held) expect(tuning.has(state), state).toBe(false);
  });
});
