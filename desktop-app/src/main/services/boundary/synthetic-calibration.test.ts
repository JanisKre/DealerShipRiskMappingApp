/**
 * Calibration of the fallback circle radius on the public boundary fixtures
 * (`resources/benchmarks/boundary-public-fixtures.json`, 17 OSM car-dealer
 * areas). Target from QA: the octagon around the point holds the whole lot
 * on at least 90% of the sample. Deterministic and offline; it pins the
 * shipped constant so a fixture or geometry change cannot drift it silently.
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

const TARGET_SHARE = 0.9;
/** The radius is chosen in steps of this size. */
const STEP_M = 10;

const needed = fixtures.map((f) => ({
  id: f.id,
  radiusM: syntheticRadiusToCover(f.lat, f.lon, f.reference.coordinates.flat()),
}));

const coveredShare = (radiusM: number): number =>
  needed.filter((n) => n.radiusM <= radiusM).length / needed.length;

describe("fallback circle calibration", () => {
  it("holds the whole reference lot on at least 90% of the fixtures", () => {
    expect(fixtures).toHaveLength(17);
    expect(coveredShare(SYNTHETIC_BOUNDARY_RADIUS_M)).toBeGreaterThanOrEqual(
      TARGET_SHARE,
    );
  });

  it("is the smallest radius step that reaches the target", () => {
    expect(coveredShare(SYNTHETIC_BOUNDARY_RADIUS_M - STEP_M)).toBeLessThan(
      TARGET_SHARE,
    );
    expect(SYNTHETIC_BOUNDARY_RADIUS_M % STEP_M).toBe(0);
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
