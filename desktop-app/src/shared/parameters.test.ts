import { describe, expect, it } from "vitest";
import { DEFAULT_RISK_PARAMETERS, normalizeRiskParameters } from "./parameters";

describe("risk parameter normalization", () => {
  it("fills missing legacy values from defaults", () => {
    const result = normalizeRiskParameters({
      vehicleValueCarEur: 42_000,
    });

    expect(result.vehicleValueCarEur).toBe(42_000);
    expect(result.floodDamageHq100).toBe(
      DEFAULT_RISK_PARAMETERS.floodDamageHq100,
    );
  });

  it("does not mutate the input patch", () => {
    const patch = { vehicleValueCarEur: 42_000 };
    normalizeRiskParameters(patch);
    expect(patch).toEqual({ vehicleValueCarEur: 42_000 });
  });

  it("rejects invalid values instead of silently accepting them", () => {
    expect(() => normalizeRiskParameters({ vehicleValueCarEur: -1 })).toThrow();
  });
});
