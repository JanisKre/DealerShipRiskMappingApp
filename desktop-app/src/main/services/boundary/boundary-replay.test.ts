import { describe, expect, it } from "vitest";
import { ringAreaSqm, unprojectPoint, type LonLat } from "../boundary-geometry";
import {
  replayBoundarySamples,
  replayDiagnostics,
  storeVegetation,
  type ReplaySample,
} from "./boundary-replay";

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

  it("counts buildings the outline cuts and where the vehicles stand", () => {
    // The result is the western half of the reference; a building stands
    // across its eastern edge; twenty vehicles on each half, ten beyond.
    const reference = { type: "Polygon" as const, coordinates: [lot] };
    const result = {
      type: "Polygon" as const,
      coordinates: [rect(-60, -40, 0, 40)],
    };
    const building = rect(-10, -10, 10, 10);
    const vehicles = [
      ...cars(-30, -25, -20, 25),
      ...cars(20, -25, 30, 25),
      ...cars(-55, -25, -45, 0),
    ];
    const { diagnostics, cutPerSample } = replayDiagnostics(
      [{ reference, vehicles, buildings: [building] }],
      [result],
    );
    expect(cutPerSample).toEqual([1]);
    expect(diagnostics).toEqual({
      samples: 1,
      fallbackSamples: 0,
      cutBuildings: 1,
      samplesWithCutBuildings: 1,
      vehicleSamples: 1,
      referenceVehicles: 40,
      referenceVehiclesInside: 20,
      resultVehicles: 30,
      foreignVehicles: 10,
    });
  });

  it("does not count buildings under the fallback circle as cut", () => {
    const circle = { type: "Polygon" as const, coordinates: [lot] };
    const building = rect(30, -10, 50, 10);
    const { diagnostics, cutPerSample } = replayDiagnostics(
      [{ vehicles: null, buildings: [building] }],
      [circle],
      [true],
    );
    expect(cutPerSample).toEqual([0]);
    expect(diagnostics.fallbackSamples).toBe(1);
    expect(diagnostics.cutBuildings).toBe(0);
  });

  it("reports the diagnostics of a replay and no cut building on a plain lot", () => {
    const outcome = replayBoundarySamples([
      { ...sample, buildings: [rect(-10, -10, 10, 10)] },
    ]);
    expect(outcome.rows[0].cutBuildings).toBe(0);
    expect(outcome.diagnostics.cutBuildings).toBe(0);
    expect(outcome.diagnostics.referenceVehiclesInside).toBe(
      outcome.diagnostics.referenceVehicles,
    );
    expect(outcome.diagnostics.foreignVehicles).toBe(0);
  });

  it("replays a vegetation raster stored as text like the raster itself", () => {
    // The whole image is grass: the stored and the live raster must lead to
    // the same result.
    const cells = new Uint8Array(200 * 200).fill(1);
    const [west, south] = at(-100, -100);
    const [east, north] = at(100, 100);
    const mask = { west, south, east, north, width: 200, height: 200, cells };
    const stored = storeVegetation(mask);
    expect(typeof stored.cells).toBe("string");
    const live = replayBoundarySamples([{ ...sample, vegetation: mask }]);
    const replayed = replayBoundarySamples([{ ...sample, vegetation: stored }]);
    expect(JSON.parse(JSON.stringify(stored)).cells).toBe(stored.cells);
    expect(replayed.rows[0].polygon).toEqual(live.rows[0].polygon);
    expect(replayed.rows[0].trace).toEqual(live.rows[0].trace);
  });
});
