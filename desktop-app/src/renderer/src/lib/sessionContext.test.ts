import { describe, expect, it } from "vitest";
import type { AnalyzedDealership } from "@shared/types";
import {
  CONTEXT_MAX_LOCATIONS,
  buildSessionContext,
  fitContext,
} from "./sessionContext";

function site(
  id: string,
  eal: number,
  extra: Partial<AnalyzedDealership> = {},
): AnalyzedDealership {
  return {
    id,
    name: `Autohaus ${id}`,
    address: `Industriestraße 1, 0123${id.length} Dresden`,
    lat: 51 + Number(id.replace(/\D/g, "") || 0) * 0.5,
    lon: 13,
    hailZone: 4,
    detection: { vehicleCount: 40, confidence: 0.8, model: "test" },
    risk: {
      overallScore: 50,
      perils: [],
      eal,
      exposureEur: 1_000_000,
      computedAt: "2026-11-11T00:00:00Z",
    },
    ...extra,
  } as AnalyzedDealership;
}

describe("buildSessionContext", () => {
  it("lists locations highest hail EAL first with their key fields", () => {
    const text = buildSessionContext([
      site("a", 100, { insured: true }),
      site("b", 900, { insured: false, notes: "secret note" }),
    ]);
    const lines = text.split("\n").filter((l) => l.startsWith("- Autohaus"));
    expect(lines[0]).toMatch(/^- Autohaus b \| 01231 Dresden \| prospect/);
    expect(lines[0]).toMatch(/hail zone 4 \(postcode\)/);
    expect(lines[0]).toMatch(/vehicles 40 \(detected\)/);
    expect(lines[0]).toMatch(/hail EAL 900 €/);
    expect(lines[1]).toMatch(/Autohaus a .*\| insured/);
    expect(text).toMatch(/Portfolio: 2 locations \(1 insured, 1 prospects/);
  });

  it("never includes underwriting notes or the street", () => {
    const text = buildSessionContext([site("a", 1, { notes: "secret note" })]);
    expect(text).not.toContain("secret note");
    expect(text).not.toContain("Industriestraße");
  });

  it("marks the selected location", () => {
    const text = buildSessionContext([site("a", 1), site("b", 2)], {
      selectedId: "a",
    });
    expect(text).toContain("Selected on the map: Autohaus a.");
    expect(text).toMatch(/- Autohaus a .*\| SELECTED/);
  });

  it("summarises locations beyond the list but keeps the selected one", () => {
    const many = Array.from({ length: CONTEXT_MAX_LOCATIONS + 5 }, (_, i) =>
      site(`s${i}`, 1000 - i),
    );
    const last = many[many.length - 1];
    const text = buildSessionContext(many, { selectedId: last.id });
    expect(text).toContain(`(top ${CONTEXT_MAX_LOCATIONS} of ${many.length})`);
    expect(text).toContain(`- ${last.name} |`);
    expect(text).toMatch(/… 4 more locations/);
  });

  it("says so when the portfolio is empty", () => {
    expect(buildSessionContext([])).toMatch(/empty/);
  });
});

describe("fitContext", () => {
  it("cuts whole lines to stay under the limit", () => {
    const text = Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n");
    const fitted = fitContext(text, 100);
    expect(fitted.length).toBeLessThanOrEqual(100);
    expect(fitted).toMatch(/list truncated/);
    expect(
      fitted
        .split("\n")
        .slice(0, -1)
        .every((l) => /^line \d+$/.test(l)),
    ).toBe(true);
  });
});
