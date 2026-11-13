import { afterEach, describe, expect, it } from "vitest";
import i18n from "i18next";
import { eur, eurCompact, num, pct } from "./format";

const original = i18n.language;
function setLanguage(language: string): void {
  // The formatters only read `i18n.language`; no full init needed.
  (i18n as { language: string }).language = language;
}
afterEach(() => setLanguage(original));

describe("format", () => {
  it("uses German notation by default", () => {
    setLanguage("");
    expect(num(50_613)).toBe("50.613");
    expect(eur(1_265_325_000).replace(/\s/gu, " ")).toBe("1.265.325.000 €");
    expect(pct(0.15).replace(/\s/gu, " ")).toBe("15 %");
  });

  it("follows the UI language", () => {
    setLanguage("en");
    expect(num(50_613)).toBe("50,613");
    expect(eur(30_000)).toBe("€30,000");
    expect(num(0.01, 2)).toBe("0.01");
    setLanguage("fr");
    expect(num(44_000).replace(/\s/gu, " ")).toBe("44 000");
    setLanguage("de");
    expect(num(0.01, 2)).toBe("0,01");
  });

  it("shortens large amounts for chart labels", () => {
    setLanguage("de");
    expect(eurCompact(337_950_000).replace(/\s/gu, " ")).toBe("338 Mio. €");
    setLanguage("en");
    expect(eurCompact(144_800_000)).toBe("€144.8M");
  });

  it("shows a dash for missing values", () => {
    expect(eur(null)).toBe("–");
    expect(eurCompact(undefined)).toBe("–");
    expect(num(undefined)).toBe("–");
    expect(pct(null)).toBe("–");
  });
});
