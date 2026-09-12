import { describe, expect, it } from "vitest";
import { estimatedExposureEur } from "./exposure";

describe("estimatedExposureEur", () => {
  it("values legacy vehicle classes using the unified car value", () => {
    expect(
      estimatedExposureEur(
        {
          vehicleCount: 4,
          confidence: 0.9,
          model: "legacy",
          classCounts: { car: 1, van: 1, truck: 1, bus: 1 },
        },
        0,
      ),
    ).toBe(4 * 25_000);
  });

  it("prefers a human-adjusted vehicle count for exposure", () => {
    expect(
      estimatedExposureEur(
        {
          vehicleCount: 4,
          manualVehicleCount: 10,
          confidence: 0.9,
          model: "legacy",
        },
        0,
      ),
    ).toBe(10 * 25_000);
  });
});
