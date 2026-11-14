import { describe, expect, it } from "vitest";
import type { AnalyzedDealership } from "./types";
import { diffPortfolios, portfolioDiffFacts } from "./portfolio-diff";

function site(
  id: string,
  name: string,
  vehicles: number,
  eal: number,
  hailZone = 3,
): AnalyzedDealership {
  return {
    id,
    name,
    hailZone,
    detection: { vehicleCount: vehicles, confidence: 0.8, model: "yolo" },
    risk: {
      overallScore: 30,
      perils: [],
      eal,
      computedAt: "2026-11-13T00:00:00Z",
    },
  } as unknown as AnalyzedDealership;
}

describe("portfolio diff", () => {
  it("matches by id, then by name, and lists removed locations", () => {
    const baseline = [
      site("1", "Autohaus Nord", 100, 5_000),
      site("old-2", "Autohaus Süd", 50, 2_000),
      site("3", "Autohaus West", 20, 800),
    ];
    const current = [
      site("1", "Autohaus Nord", 120, 6_000),
      site("new-2", "autohaus  süd", 50, 2_000),
      site("4", "Autohaus Ost", 10, 400, 5),
    ];
    const diff = diffPortfolios(current, baseline);

    expect(diff.rows.map((r) => [r.name, r.status])).toEqual([
      ["Autohaus Nord", "changed"],
      ["autohaus  süd", "unchanged"],
      ["Autohaus Ost", "added"],
      ["Autohaus West", "removed"],
    ]);
    expect(diff.rows[0].vehicles).toEqual({ from: 100, to: 120, delta: 20 });
    expect(diff.rows[3].eal).toEqual({ from: 800, to: null, delta: -800 });
    expect(diff.totals).toEqual({
      added: 1,
      removed: 1,
      changed: 1,
      unchanged: 1,
      vehicleDelta: 20 + 10 - 20,
      ealDelta: 1_000 + 400 - 800,
    });
  });

  it("counts a hail zone change as a change and ignores EAL rounding", () => {
    const diff = diffPortfolios(
      [site("1", "A", 10, 100.4, 4), site("2", "B", 10, 100.4)],
      [site("1", "A", 10, 100, 3), site("2", "B", 10, 100)],
    );
    expect(diff.rows.map((r) => r.status)).toEqual(["changed", "unchanged"]);
  });

  it("does not match one baseline location twice", () => {
    const diff = diffPortfolios(
      [site("1", "Autohaus", 10, 100), site("2", "Autohaus", 10, 100)],
      [site("1", "Autohaus", 10, 100)],
    );
    expect(diff.rows.map((r) => r.status)).toEqual(["unchanged", "added"]);
  });

  it("writes facts with totals and the largest changes first", () => {
    const diff = diffPortfolios(
      [site("1", "Klein", 10, 110), site("2", "Groß", 10, 9_000)],
      [site("1", "Klein", 10, 100), site("2", "Groß", 10, 1_000)],
    );
    const facts = portfolioDiffFacts(diff, "Stand 13.11.");
    expect(facts).toContain("Baseline: Stand 13.11.");
    expect(facts).toContain("Total hail EAL change (EUR): 8010");
    expect(facts.indexOf("Groß")).toBeLessThan(facts.indexOf("Klein"));
  });
});
