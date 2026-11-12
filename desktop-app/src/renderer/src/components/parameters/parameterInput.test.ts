import { describe, expect, it } from "vitest";
import {
  parameterInputError,
  zonesWithFallingFrequency,
} from "./parameterInput";

describe("parameterInputError", () => {
  const fraction = { min: 0, max: 1 };

  it("rejects an empty field instead of reading it as 0", () => {
    expect(parameterInputError("", { min: 0 })).toBe("empty");
    expect(parameterInputError("   ", { min: 0 })).toBe("empty");
  });

  it("accepts values inside the range, including the bounds", () => {
    expect(parameterInputError("0", fraction)).toBeNull();
    expect(parameterInputError("0.15", fraction)).toBeNull();
    expect(parameterInputError("1", fraction)).toBeNull();
  });

  it("rejects values outside the range", () => {
    expect(parameterInputError("-5", { min: 0.1 })).toBe("outOfRange");
    expect(parameterInputError("1.5", fraction)).toBe("outOfRange");
  });

  it("rejects non-numbers", () => {
    expect(parameterInputError("abc", fraction)).toBe("notANumber");
  });

  it("requires whole numbers where the field asks for them", () => {
    const zone = { min: 1, max: 6, integer: true };
    expect(parameterInputError("4.5", zone)).toBe("notInteger");
    expect(parameterInputError("5", zone)).toBeNull();
    expect(parameterInputError("7", zone)).toBe("outOfRange");
  });
});

describe("zonesWithFallingFrequency", () => {
  it("lists zones whose λ is below the zone underneath", () => {
    expect(zonesWithFallingFrequency([0.01, 0.02, 0, 0.07, 0.1, 0.15])).toEqual(
      [3],
    );
  });

  it("is empty for non-decreasing frequencies", () => {
    expect(
      zonesWithFallingFrequency([0.01, 0.02, 0.04, 0.07, 0.1, 0.15]),
    ).toEqual([]);
    expect(zonesWithFallingFrequency([0.02, 0.02, 0.02])).toEqual([]);
  });
});
