import { afterEach, describe, expect, it } from "vitest";
import i18n from "./i18n";
import {
  dateTime,
  duration,
  fmt,
  niceTicks,
  parseWhole,
  pct,
  ROUND_EPOCHS,
  share,
} from "./numbers";

afterEach(() => i18n.changeLanguage("de"));

describe("parseWhole", () => {
  const p = (t: string): number | null =>
    parseWhole(t, ROUND_EPOCHS.min, ROUND_EPOCHS.max);

  it("accepts whole numbers in range", () => {
    expect(p("15")).toBe(15);
    expect(p("3")).toBe(3);
    expect(p("120")).toBe(120);
    expect(p(" 20 ")).toBe(20);
  });

  it("refuses empty, out of range, decimals and exponents", () => {
    for (const t of ["", " ", "2", "121", "500", "-1", "1e2", "15.5", "abc"])
      expect(p(t)).toBeNull();
  });
});

describe("duration", () => {
  it("says minutes, then hours, never negative", async () => {
    await i18n.changeLanguage("de");
    expect(duration(30.5)).toBe("etwa 31 Minuten");
    expect(duration(1)).toBe("etwa 1 Minute");
    expect(duration(-12)).toBe("etwa 0 Minuten");
    expect(duration(188)).toBe("etwa 3 Stunden");
    expect(duration(150)).toBe("etwa 2,5 Stunden");
  });

  it("follows the interface language", async () => {
    await i18n.changeLanguage("en");
    expect(duration(150)).toBe("about 2.5 hours");
    await i18n.changeLanguage("fr");
    expect(duration(30)).toBe("environ 30 minutes");
    expect(duration(90)).toBe("environ 1,5 heure");
  });
});

describe("number formatting", () => {
  it("uses the interface language", async () => {
    await i18n.changeLanguage("de");
    expect(fmt(0.961, 3)).toBe("0,961");
    expect(fmt(1638)).toBe("1.638");
    expect(fmt(null)).toBe("–");
    await i18n.changeLanguage("en");
    expect(fmt(0.961, 3)).toBe("0.961");
    expect(pct(0.002)).toBe("+0.2%");
    expect(share(0.73)).toBe("73%");
  });

  it("signs a bias, but not zero", async () => {
    await i18n.changeLanguage("de");
    expect(pct(0.002).replace(/\s/g, " ")).toBe("+0,2 %");
    expect(pct(-0.031).replace(/\s/g, " ")).toBe("-3,1 %");
    expect(pct(0).replace(/\s/g, " ")).toBe("0,0 %");
  });

  it("formats studio timestamps and keeps what it cannot parse", async () => {
    await i18n.changeLanguage("en");
    expect(dateTime("2026-11-14T13:46:40")).toMatch(/Nov 14, 2026.*1:46/);
    expect(dateTime("garbage")).toBe("garbage");
    expect(dateTime(null)).toBe("–");
  });
});

describe("niceTicks", () => {
  it("steps evenly and shows every tick distinctly", () => {
    const { ticks, digits } = niceTicks(0.88, 0.98);
    expect(ticks).toEqual([0.85, 0.9, 0.95, 1]);
    expect(digits).toBe(2);
    expect(new Set(ticks.map((t) => t.toFixed(digits))).size).toBe(
      ticks.length,
    );
  });

  it("covers the range on a 1-2-5 step", () => {
    const { ticks, digits } = niceTicks(6.3, 11.8);
    expect(ticks[0]).toBeLessThanOrEqual(6.3);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(11.8);
    expect(digits).toBe(0);
  });

  it("gives a single value some room", () => {
    const { ticks } = niceTicks(0.5, 0.5);
    expect(ticks.length).toBeGreaterThan(1);
    expect(ticks[0]).toBeLessThan(0.5);
  });
});
