import { describe, expect, it } from "vitest";
import {
  classDamageFromParameters,
  computeHailEventImpact,
  distanceToRingsKm,
  replayFrame,
  shiftCells,
  upperBoundByTime,
  type HailEventCell,
} from "./hail-events";

const MIN = 60_000;

/** A square cell about 2.2 km across, centred on (lat, lon). */
function cell(
  t: number,
  track: number,
  lat: number,
  lon: number,
  c: HailEventCell["c"] = "hail",
): HailEventCell {
  const h = 0.01;
  return {
    t,
    track,
    c,
    d: 60,
    p: [lon, lat],
    b: [lon - h, lat - h, lon + h, lat + h],
    r: [
      [lon - h, lat - h, lon + h, lat - h, lon + h, lat + h, lon - h, lat + h],
    ],
  };
}

const damage = classDamageFromParameters({
  scenarioDamageLow: 0.05,
  scenarioDamageMedium: 0.15,
  scenarioDamageHigh: 0.3,
});

describe("hail event impact", () => {
  // A track moving east along 50° N, one step every 5 minutes.
  const cells = [
    cell(0, 0, 50, 8.0, "mixed"),
    cell(5 * MIN, 0, 50, 8.05, "hail"),
    cell(10 * MIN, 0, 50, 8.1, "large"),
  ];
  const sites = [
    { id: "east", lat: 50, lon: 8.1, exposureEur: 1_000_000 },
    { id: "west", lat: 50, lon: 8.0, exposureEur: 2_000_000 },
    { id: "far", lat: 51, lon: 8.0, exposureEur: 5_000_000 },
  ];

  it("finds the sites a cell passes, in the order the storm reaches them", () => {
    const impact = computeHailEventImpact(cells, sites, damage, 1);
    expect(impact.hits.map((h) => h.id)).toEqual(["west", "east"]);
    expect(impact.hits[0]).toMatchObject({
      firstAt: 0,
      hailClass: "mixed",
      distanceKm: 0,
    });
    // The east site is reached by the large-hail step only.
    expect(impact.hits[1]).toMatchObject({
      firstAt: 10 * MIN,
      hailClass: "large",
    });
    expect(impact.hits[1].lossEur).toBe(300_000);
    expect(impact.totalExposureEur).toBe(3_000_000);
    expect(impact.totalLossEur).toBe(100_000 + 300_000);
  });

  it("keeps the worst class that reached a site", () => {
    // Radius 7 km: the large-hail step (edge 6.4 km east) reaches the west site too.
    const impact = computeHailEventImpact(cells, sites, damage, 7);
    expect(impact.hits.find((h) => h.id === "west")?.hailClass).toBe("large");
  });

  it("is deterministic and ignores sites without coordinates", () => {
    const withNaN = [
      ...sites,
      { id: "nan", lat: Number.NaN, lon: 8, exposureEur: 1 },
    ];
    expect(computeHailEventImpact(cells, withNaN, damage, 1)).toEqual(
      computeHailEventImpact(cells, withNaN, damage, 1),
    );
    expect(computeHailEventImpact([], sites, damage).hits).toEqual([]);
  });

  it("moves the event on the ground when shifted", () => {
    // 111.32 km north: the storm now passes over the far site instead.
    const shifted = shiftCells(cells, { eastKm: 0, northKm: 111.32 }, 50);
    expect(shifted[0].p[1]).toBeCloseTo(51, 6);
    expect(shifted[0].r[0][1]).toBeCloseTo(50.99, 6);
    const impact = computeHailEventImpact(shifted, sites, damage, 1);
    expect(impact.hits.map((h) => h.id)).toEqual(["far"]);
    // A zero shift returns the same cells.
    expect(shiftCells(cells, { eastKm: 0, northKm: 0 }, 50)).toEqual(cells);
  });

  it("measures the distance to an outline on the ground", () => {
    // 0.02° of latitude north of the cell edge ≈ 2.2 km.
    expect(distanceToRingsKm(50.03, 8, cells[0].r)).toBeCloseTo(2.23, 1);
    expect(distanceToRingsKm(50, 8, cells[0].r)).toBe(0);
  });
});

describe("replay frames", () => {
  const cells = [
    cell(0, 0, 50, 8.0),
    cell(0, 1, 49, 9.0),
    cell(5 * MIN, 0, 50, 8.1),
    cell(20 * MIN, 1, 49, 9.5),
  ];

  it("finds the steps up to a time", () => {
    expect(upperBoundByTime(cells, -1)).toBe(0);
    expect(upperBoundByTime(cells, 0)).toBe(2);
    expect(upperBoundByTime(cells, 6 * MIN)).toBe(3);
    expect(upperBoundByTime(cells, 99 * MIN)).toBe(4);
  });

  it("glides a cell towards its next step", () => {
    const frame = replayFrame(cells, 2.5 * MIN);
    const track0 = frame.find((f) => f.cell.track === 0)!;
    expect(track0.cell.t).toBe(0);
    expect(track0.dLon).toBeCloseTo(0.05, 6);
    expect(track0.dLat).toBe(0);
  });

  it("drops a track whose last step is too old", () => {
    // Neither track has a step within 5 min of 11 min: nothing is live.
    const frame = replayFrame(cells, 11 * MIN);
    expect(frame.map((f) => f.cell.track)).toEqual([]);
    expect(replayFrame(cells, 20 * MIN).map((f) => f.cell.track)).toEqual([1]);
  });
});
