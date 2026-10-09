import { describe, expect, it } from "vitest";
import { DEFAULT_RISK_PARAMETERS, normalizeRiskParameters } from "./parameters";
import { RiskParametersSchema } from "./types";

describe("risk parameter normalization", () => {
  it("fills missing legacy values from defaults", () => {
    const result = normalizeRiskParameters({
      vehicleValueCarEur: 42_000,
    });

    expect(result.vehicleValueCarEur).toBe(42_000);
    expect(result.hailFrequencyZone4).toBe(
      DEFAULT_RISK_PARAMETERS.hailFrequencyZone4,
    );
  });

  it("does not mutate the input patch", () => {
    const patch = { vehicleValueCarEur: 42_000 };
    normalizeRiskParameters(patch);
    expect(patch).toEqual({ vehicleValueCarEur: 42_000 });
  });

  it("rejects invalid values instead of silently accepting them", () => {
    expect(() => normalizeRiskParameters({ vehicleValueCarEur: -1 })).toThrow();
    expect(() =>
      normalizeRiskParameters({ hailSeverityLargeEur: -100 }),
    ).toThrow();
    expect(() => normalizeRiskParameters({ alertHailZone: 7 })).toThrow();
  });

  it("loads parameters saved before the hail EAL (screening-0.4.0)", () => {
    // A stored session: every field of that release, none of the hail EAL ones.
    const {
      hailFrequencyZone1: _1,
      hailFrequencyZone2: _2,
      hailFrequencyZone3: _3,
      hailFrequencyZone4: _4,
      hailFrequencyZone5: _5,
      hailFrequencyZone6: _6,
      hailShareSmall: _s,
      hailShareMedium: _m,
      hailShareLarge: _l,
      hailSeveritySmallEur: _ss,
      hailSeverityMediumEur: _sm,
      hailSeverityLargeEur: _sl,
      alertHailZone: _z,
      ...rest
    } = DEFAULT_RISK_PARAMETERS;
    const legacy = {
      ...rest,
      hailDamageFraction: 0.15,
      floodDamageHq100: 0.15,
      alertExtremeScore: 75,
    };

    const parsed = RiskParametersSchema.parse(legacy);

    expect(parsed).toEqual(DEFAULT_RISK_PARAMETERS);
    expect(parsed).not.toHaveProperty("hailDamageFraction");
    expect(parsed).not.toHaveProperty("alertExtremeScore");
  });
});
