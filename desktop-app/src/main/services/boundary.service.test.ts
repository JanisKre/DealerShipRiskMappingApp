import { describe, expect, it } from "vitest";
import {
  SYNTHETIC_BOUNDARY_RADIUS_M,
  syntheticFallbackBoundary,
} from "./boundary.service";

describe("synthetic fallback boundary", () => {
  it("creates an octagon with the calibrated radius", () => {
    const boundary = syntheticFallbackBoundary(51, 10);
    const ring = boundary.polygon.coordinates[0];

    expect(boundary.source).toBe("synthetic");
    expect(ring).toHaveLength(9); // eight vertices plus the closing point
    expect(ring[0]).toEqual(ring.at(-1));
    expect(boundary.areaSqm).toBeGreaterThan(20_000);
    expect(SYNTHETIC_BOUNDARY_RADIUS_M).toBe(100);
  });
});
