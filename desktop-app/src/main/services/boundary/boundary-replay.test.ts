import { describe, expect, it } from "vitest";
import { ringAreaSqm, unprojectPoint, type LonLat } from "../boundary-geometry";
import { replayBoundarySamples, type ReplaySample } from "./boundary-replay";

const ANCHOR: LonLat = [9.7, 52.37];
const at = (east: number, north: number): LonLat =>
  unprojectPoint([east, north], ANCHOR);
function rect(w: number, s: number, e: number, n: number): LonLat[] {
  return [at(w, s), at(e, s), at(e, n), at(w, n), at(w, s)];
}
function cars(w: number, s: number, e: number, n: number): LonLat[] {
  const out: LonLat[] = [];
  for (let x = w + 2.5; x < e; x += 5) {
    for (let y = s + 2.5; y < n; y += 5) out.push(at(x, y));
  }
  return out;
}

const lot = rect(-40, -40, 40, 40);
const sample: ReplaySample = {
  id: "synthetic-1",
  holdout: true,
  anchor: ANCHOR,
  reference: { type: "Polygon", coordinates: [lot] },
  vehicles: cars(-35, -35, 35, 35),
  parcels: [{ ring: lot, areaSqm: ringAreaSqm(lot), state: "Niedersachsen" }],
};

describe("replayBoundarySamples", () => {
  it("replays frozen inputs deterministically and scores them", () => {
    const first = replayBoundarySamples([sample]);
    const second = replayBoundarySamples([sample]);
    expect(first.rows[0].stage).toBe(1);
    expect(first.rows[0].reviewReasons).toEqual([]);
    expect(first.all?.meanIoU).toBeGreaterThan(0.95);
    expect(first.holdout?.evaluatedSamples).toBe(1);
    expect(second.rows[0].polygon).toEqual(first.rows[0].polygon);
  });

  it("falls back to the circle and reports it without a reference", () => {
    const outcome = replayBoundarySamples([
      {
        id: "empty",
        anchor: ANCHOR,
        vehicles: null,
        parcels: [],
      },
    ]);
    expect(outcome.rows[0].stage).toBe(5);
    expect(outcome.rows[0].reviewReasons).toContain("synthetic");
    expect(outcome.all).toBeNull();
  });
});
