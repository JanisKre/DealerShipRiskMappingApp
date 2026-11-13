import { describe, expect, it } from "vitest";
import {
  formatParameterValue,
  parameterInputError,
  parseLocaleNumber,
  zonesWithFallingFrequency,
} from "./parameterInput";

describe("parseLocaleNumber", () => {
  it("reads German thousands separators and the decimal comma", () => {
    expect(parseLocaleNumber("30.000", "de")).toBe(30_000);
    expect(parseLocaleNumber("1.000.000", "de")).toBe(1_000_000);
    expect(parseLocaleNumber("25.000,5", "de")).toBe(25_000.5);
    expect(parseLocaleNumber("0,15", "de")).toBe(0.15);
    expect(parseLocaleNumber(" 30000 ", "de")).toBe(30_000);
    expect(parseLocaleNumber("1,000", "de")).toBe(1);
  });

  it("keeps a lone point that isn't grouping as the decimal mark", () => {
    expect(parseLocaleNumber("0.15", "de")).toBe(0.15);
    expect(parseLocaleNumber("0.025", "de")).toBe(0.025);
    expect(parseLocaleNumber("1.5", "de")).toBe(1.5);
  });

  it("reads English grouping and decimals", () => {
    expect(parseLocaleNumber("30,000", "en")).toBe(30_000);
    expect(parseLocaleNumber("25,000.5", "en")).toBe(25_000.5);
    expect(parseLocaleNumber("0.15", "en")).toBe(0.15);
    expect(parseLocaleNumber("1.500", "en")).toBe(1.5);
  });

  it("reads French space grouping", () => {
    expect(parseLocaleNumber("30\u202f000", "fr")).toBe(30_000);
    expect(parseLocaleNumber("30 000,5", "fr")).toBe(30_000.5);
    expect(parseLocaleNumber("0,15", "fr")).toBe(0.15);
  });

  it("rejects text, exponents and mixed-up separators", () => {
    for (const raw of ["", "abc", "1e3", "1.234.5", "1,2,3", "12a", "--1"])
      expect(parseLocaleNumber(raw, "de")).toBeNaN();
    expect(parseLocaleNumber("-5", "de")).toBe(-5);
  });

  it("round-trips the formatted value", () => {
    for (const locale of ["de", "en", "fr"])
      for (const value of [0, 0.15, 25_000, 50_000_000, 1234.5, 0.0025])
        expect(
          parseLocaleNumber(formatParameterValue(value, locale), locale),
        ).toBe(value);
    expect(formatParameterValue(25_000, "de")).toBe("25.000");
    expect(formatParameterValue(0.15, "de")).toBe("0,15");
  });
});

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

  it("reads the value in the UI language", () => {
    const eur = { min: 0, max: 1_000_000 };
    expect(parameterInputError("30.000", eur, "de")).toBeNull();
    expect(parameterInputError("0,15", fraction, "de")).toBeNull();
    expect(parameterInputError("99999999999", eur, "de")).toBe("outOfRange");
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
