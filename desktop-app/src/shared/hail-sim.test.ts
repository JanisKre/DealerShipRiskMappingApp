import { describe, expect, it } from "vitest";
import {
  classDamageFromParameters,
  computeHailEventImpact,
} from "./hail-events";
import {
  GERMANY_BBOX,
  generateOutbreak,
  generateStorm,
  groundKm,
  headingOf,
  move,
  rng,
  stormAlongPath,
} from "./hail-sim";

const T0 = Date.UTC(2026, 6, 4, 13);
const damage = classDamageFromParameters({
  scenarioDamageLow: 0.05,
  scenarioDamageMedium: 0.15,
  scenarioDamageHigh: 0.3,
});

describe("hail storm generator", () => {
  it("is deterministic for a seed", () => {
    const a = generateOutbreak({
      seed: 42,
      storms: 4,
      strength: "severe",
      heading: "sw-ne",
      t0: T0,
    });
    const b = generateOutbreak({
      seed: 42,
      storms: 4,
      strength: "severe",
      heading: "sw-ne",
      t0: T0,
    });
    const c = generateOutbreak({
      seed: 43,
      storms: 4,
      strength: "severe",
      heading: "sw-ne",
      t0: T0,
    });
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("moves a storm along its heading at its speed, peaking mid-life", () => {
    const cells = generateStorm(
      {
        start: [9, 48.5],
        headingDeg: 60,
        speedKmh: 48,
        durationMin: 60,
        strength: "severe",
        t0: T0,
        track: 0,
      },
      rng(1),
    );
    expect(cells).toHaveLength(13);
    expect(cells[1].t - cells[0].t).toBe(5 * 60 * 1000);
    // 48 km/h ± 10 % for an hour: about 48 km, heading roughly north-east.
    const km = groundKm(cells[0].p, cells.at(-1)!.p);
    expect(km).toBeGreaterThan(38);
    expect(km).toBeLessThan(58);
    expect(headingOf(cells[0].p, cells.at(-1)!.p)).toBeGreaterThan(35);
    expect(headingOf(cells[0].p, cells.at(-1)!.p)).toBeLessThan(85);
    expect(cells[0].c).toBe("mixed");
    expect(cells[6].c).toBe("large");
    // Moderate storms never reach large hail.
    const moderate = generateStorm(
      {
        start: [9, 48.5],
        headingDeg: 60,
        speedKmh: 48,
        durationMin: 60,
        strength: "moderate",
        t0: T0,
        track: 0,
      },
      rng(1),
    );
    expect(moderate.some((c) => c.c === "large")).toBe(false);
  });

  it("starts random storms inside Germany and aimed storms over their target", () => {
    const random = generateOutbreak({
      seed: 7,
      storms: 12,
      strength: "severe",
      heading: "sw-ne",
      t0: T0,
    });
    for (let track = 0; track < 12; track++) {
      const first = random.find((c) => c.track === track)!;
      expect(first.p[0]).toBeGreaterThanOrEqual(GERMANY_BBOX[0]);
      expect(first.p[0]).toBeLessThanOrEqual(GERMANY_BBOX[2]);
      expect(first.p[1]).toBeGreaterThanOrEqual(GERMANY_BBOX[1]);
      expect(first.p[1]).toBeLessThanOrEqual(GERMANY_BBOX[3]);
    }
    // Aimed at three dealerships: every one is reached.
    const targets: Array<[number, number]> = [
      [9.2, 48.5],
      [11.6, 48.1],
      [13.4, 52.5],
    ];
    for (const seed of [1, 2, 3, 4, 5]) {
      const cells = generateOutbreak({
        seed,
        storms: 3,
        strength: "severe",
        heading: "w-e",
        t0: T0,
        targets,
      });
      const impact = computeHailEventImpact(
        cells,
        targets.map(([lon, lat], i) => ({
          id: String(i),
          lat,
          lon,
          exposureEur: 1,
        })),
        damage,
        0,
      );
      expect(impact.hits.map((h) => h.id).sort()).toEqual(["0", "1", "2"]);
    }
  });

  it("follows a drawn path from end to end", () => {
    const path: Array<[number, number]> = [
      [9, 48.5],
      [9.5, 48.6],
      move(9.5, 48.6, 90, 30),
    ];
    const cells = stormAlongPath(path, 60, "extreme", T0, 3);
    expect(groundKm(cells[0].p, path[0])).toBeLessThan(0.01);
    expect(groundKm(cells.at(-1)!.p, path[2])).toBeLessThan(0.01);
    // The whole path hails.
    expect(cells.every((c) => c.c !== "mixed")).toBe(true);
    expect(stormAlongPath([[9, 48]], 60, "severe", T0, 1)).toEqual([]);
  });
});
