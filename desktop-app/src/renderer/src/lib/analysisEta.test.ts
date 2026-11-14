import { describe, expect, it } from "vitest";
import { etaRangeMinutes } from "./analysisEta";

describe("etaRangeMinutes", () => {
  it("waits for a few results", () => {
    expect(etaRangeMinutes(2, 50, 20_000)).toBeNull();
  });

  it("gives a coarse range that stays put while the pace wobbles", () => {
    // 8 s per site, 485 to go ≈ 65 min.
    const a = etaRangeMinutes(15, 500, 15 * 8_000);
    const b = etaRangeMinutes(16, 500, 16 * 8_600);
    expect(a).toEqual([45, 90]);
    expect(b).toEqual([45, 90]);
  });

  it("uses minutes for short runs", () => {
    expect(etaRangeMinutes(10, 20, 10 * 30_000)).toEqual([3, 7]);
  });
});
