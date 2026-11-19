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

  it("prefers the declared value over the lot-area estimate", () => {
    expect(
      estimatedExposureEur(
        { vehicleCount: 2_896, confidence: 0.1, model: "stub-area-heuristic" },
        2_500_000,
      ),
    ).toBe(2_500_000);
  });

  it("keeps the area estimate when no value was declared", () => {
    expect(
      estimatedExposureEur(
        { vehicleCount: 40, confidence: 0.1, model: "stub-area-heuristic" },
        0,
      ),
    ).toBe(40 * 25_000);
  });

  it("prefers a model count over the declared value", () => {
    expect(
      estimatedExposureEur(
        { vehicleCount: 108, confidence: 0.8, model: "dealer_vehicles" },
        2_500_000,
      ),
    ).toBe(108 * 25_000);
  });
});
