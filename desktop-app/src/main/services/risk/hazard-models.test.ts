import { describe, expect, it } from "vitest";
import type { PerilScore } from "@shared/types";
import { primaryHailScore } from "./hazard-models";

const peril = (name: PerilScore["peril"], score: number): PerilScore => ({
  peril: name,
  score,
  hazardValue: score,
  unit: "test",
});

describe("primaryHailScore", () => {
  it("uses hail as the dealership primary score", () => {
    expect(
      primaryHailScore([
        peril("wind", 95),
        peril("flood", 80),
        peril("hail", 35),
      ]),
    ).toBe(35);
  });

  it("falls back to zero when hail is unavailable", () => {
    expect(primaryHailScore([peril("wind", 95)])).toBe(0);
  });
});
