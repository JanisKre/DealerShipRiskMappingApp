/**
 * Calibration of the fallback circle radius on the public boundary fixtures
 * (`resources/benchmarks/boundary-public-fixtures.json`). Deterministic and
 * offline; it pins the shipped constant so a fixture or geometry change
 * cannot drift it silently.
 *
 * The radius was chosen in November 2026 on version 1 of the set, where the
 * octagon held the whole reference on 16 of 17 sites (target from QA: 90 %).
 * Eight of those references were showroom roofs, which are small. On
 * version 2 (76 lots) the same radius holds 66 of 76 (87 %); 90 % would
 * need 190 m. The default is unchanged — a larger octagon also takes in
 * more of the neighbours — and this test records what it reaches
 * (docs/boundary-model.md, "Fallback circle").
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import { point as turfPoint } from "@turf/helpers";
import type { Polygon } from "@shared/types";
import { DEFAULT_RISK_PARAMETERS } from "@shared/parameters";
import {
  SYNTHETIC_BOUNDARY_RADIUS_M,
  syntheticFallbackBoundary,
  syntheticRadiusToCover,
} from "./synthetic";

interface Fixture {
  id: string;
  lat: number;
  lon: number;
  reference: Polygon;
}

const fixtures = (
  JSON.parse(
    readFileSync(
      resolve(
        __dirname,
        "../../../../resources/benchmarks/boundary-public-fixtures.json",
      ),
      "utf8",
    ),
  ) as { samples: Fixture[] }
).samples;

/** Share of the fixtures the shipped radius holds whole (66 of 76). */
const REACHED_SHARE = 0.85;
/** The share QA asked for; reached from `TARGET_RADIUS_M`. */
const TARGET_SHARE = 0.9;
const TARGET_RADIUS_M = 190;
/** The radius is chosen in steps of this size. */
const STEP_M = 10;

const needed = fixtures.map((f) => ({
  id: f.id,
  radiusM: syntheticRadiusToCover(f.lat, f.lon, f.reference.coordinates.flat()),
}));

const coveredShare = (radiusM: number): number =>
  needed.filter((n) => n.radiusM <= radiusM).length / needed.length;

describe("fallback circle calibration", () => {
  it("holds the whole reference lot on at least 85% of the fixtures", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(30);
    expect(coveredShare(SYNTHETIC_BOUNDARY_RADIUS_M)).toBeGreaterThanOrEqual(
      REACHED_SHARE,
    );
    expect(SYNTHETIC_BOUNDARY_RADIUS_M % STEP_M).toBe(0);
  });

  it("would need 190 m to hold 90% of them", () => {
    expect(coveredShare(SYNTHETIC_BOUNDARY_RADIUS_M)).toBeLessThan(
      TARGET_SHARE,
    );
    expect(coveredShare(TARGET_RADIUS_M)).toBeGreaterThanOrEqual(TARGET_SHARE);
    expect(coveredShare(TARGET_RADIUS_M - STEP_M)).toBeLessThan(TARGET_SHARE);
  });

  it("is the default of the radius parameter", () => {
    expect(DEFAULT_RISK_PARAMETERS.syntheticBoundaryRadiusM).toBe(
      SYNTHETIC_BOUNDARY_RADIUS_M,
    );
  });

  it("agrees with the octagon that is actually drawn", () => {
    for (const f of fixtures) {
      const radiusM = needed.find((n) => n.id === f.id)!.radiusM;
      const vertices = f.reference.coordinates.flat();
      const holdsAll = (r: number): boolean => {
        const octagon = syntheticFallbackBoundary(f.lat, f.lon, r).polygon;
        return vertices.every((v) =>
          booleanPointInPolygon(turfPoint(v), octagon as never),
        );
      };
      expect(holdsAll(radiusM * 1.01), f.id).toBe(true);
      expect(holdsAll(radiusM * 0.99), f.id).toBe(false);
    }
  });
});
