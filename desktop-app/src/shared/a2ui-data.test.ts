import { describe, expect, it } from "vitest";
import type { AnalyzedDealership } from "./types";
import {
  DRM_DASHBOARD_CATALOG_ID,
  type A2uiFilter,
  type A2uiSurface,
} from "./a2ui";
import {
  emptySelection,
  evaluateCall,
  filterValues,
  niceTicks,
  NONE_KEY,
  OTHER_KEY,
  sharedFilter,
} from "./a2ui-data";

function site(
  id: string,
  zone: number | undefined,
  eal: number,
  extra: Partial<AnalyzedDealership> = {},
): AnalyzedDealership {
  return {
    id,
    name: `Autohaus ${id}`,
    lat: 51,
    lon: 13,
    ...(zone ? { hailZone: zone } : {}),
    detection: { vehicleCount: eal / 10, confidence: 0.8, model: "yolo" },
    risk: {
      overallScore: 30,
      perils: [],
      eal,
      exposureEur: eal * 100,
      computedAt: "2026-11-13T00:00:00Z",
    },
    ...extra,
  } as AnalyzedDealership;
}

const portfolio = [
  site("A", 5, 900, { insured: true, salesPartner: "Nord" }),
  site("B", 4, 500, { insured: true, salesPartner: "nord " }),
  site("C", 2, 300, { salesPartner: "Süd" }),
  site("D", undefined, 100, { boundary: { reviewRequired: true } as never }),
];

describe("A2UI dashboard functions", () => {
  it("aggregates a measure over a filtered selection", () => {
    expect(
      evaluateCall(
        {
          "@call": "aggregate",
          args: { measure: "eal", filter: { minHailZone: 4 } },
        },
        portfolio,
      ),
    ).toEqual({ kind: "value", measure: "eal", value: 1400, count: 2 });
    // Sales partner matches case- and space-insensitively.
    expect(
      evaluateCall(
        {
          "@call": "aggregate",
          args: { measure: "count", filter: { salesPartner: "NORD" } },
        },
        portfolio,
      ),
    ).toMatchObject({ value: 2 });
    expect(
      evaluateCall(
        {
          "@call": "aggregate",
          args: { measure: "count", filter: { business: "new" } },
        },
        portfolio,
      ),
    ).toMatchObject({ value: 2 });
    expect(
      evaluateCall(
        {
          "@call": "aggregate",
          args: { measure: "vehicles", filter: { boundaryReview: true } },
        },
        portfolio,
      ),
    ).toMatchObject({ value: 10, count: 1 });
  });

  it("ranks locations with their ids", () => {
    const result = evaluateCall(
      { "@call": "ranking", args: { measure: "eal", limit: 2 } },
      portfolio,
    );
    expect(result).toMatchObject({
      kind: "series",
      by: "location",
      count: 4,
      points: [
        { key: "Autohaus A", id: "A", value: 900 },
        { key: "Autohaus B", id: "B", value: 500 },
      ],
    });
  });

  it("groups by hail zone in zone order (estimated zones included)", () => {
    const result = evaluateCall(
      {
        "@call": "breakdown",
        args: { measure: "count", by: "hailZone", limit: 10 },
      },
      portfolio,
    );
    expect(result.kind === "series" && result.points.map((p) => p.key)).toEqual(
      ["2", "3", "4", "5"],
    );
    // A location without any zone information lands in its own group, last.
    const bare = { ...site("E", undefined, 50), risk: undefined };
    const withBare = evaluateCall(
      {
        "@call": "breakdown",
        args: { measure: "count", by: "hailZone", limit: 10 },
      },
      [...portfolio, bare],
    );
    expect(withBare.kind === "series" && withBare.points.at(-1)?.key).toBe(
      NONE_KEY,
    );
  });

  it("collects groups beyond the limit as others", () => {
    const result = evaluateCall(
      {
        "@call": "breakdown",
        args: { measure: "eal", by: "salesPartner", limit: 2 },
      },
      portfolio,
    );
    expect(result.kind === "series" && result.points).toEqual([
      { key: "Nord", value: 900 },
      { key: OTHER_KEY, value: 900 },
    ]);
  });

  it("lists table rows sorted by the requested measure", () => {
    const result = evaluateCall(
      {
        "@call": "locations",
        args: { sortBy: "exposure", limit: 3, filter: { maxHailZone: 4 } },
      },
      portfolio,
    );
    expect(
      result.kind === "rows" &&
        result.rows.map((r) => [r.id, r.hailZone, r.business]),
    ).toEqual([
      ["B", 4, "existing"],
      ["C", 2, "new"],
      ["D", 3, "new"],
    ]);
  });

  it("offers the distinct filter values, most frequent first", () => {
    expect(filterValues(portfolio, "salesPartner")).toEqual(["Nord", "Süd"]);
  });
});

describe("presentation helpers", () => {
  it("finds the selection all components share, regardless of key order", () => {
    expect(
      sharedFilter([
        { args: { filter: { minHailZone: 2, business: "existing" } } },
        { args: { filter: { business: "existing", minHailZone: 2 } } },
      ]),
    ).toEqual({ filter: { minHailZone: 2, business: "existing" } });
    expect(sharedFilter([{ args: {} }, { args: {} }])).toEqual({
      filter: undefined,
    });
    expect(
      sharedFilter([{ args: { filter: { minHailZone: 2 } } }, { args: {} }]),
    ).toBeUndefined();
    expect(sharedFilter([])).toBeUndefined();
  });

  it("notices a selection no location matches", () => {
    const surface = (filter?: A2uiFilter): A2uiSurface => ({
      surfaceId: "dashboard",
      catalogId: DRM_DASHBOARD_CATALOG_ID,
      title: "Zone",
      components: [
        {
          id: "count",
          component: "KpiCard" as const,
          title: "Standorte",
          value: {
            "@call": "aggregate" as const,
            args: { measure: "count" as const, ...(filter ? { filter } : {}) },
          },
        },
      ],
    });
    expect(emptySelection(surface({ minHailZone: 6 }), portfolio)).toBe(true);
    expect(emptySelection(surface({ minHailZone: 4 }), portfolio)).toBe(false);
    expect(emptySelection(surface(), portfolio)).toBe(false);
    // No mapped location at all is not a selection problem.
    expect(emptySelection(surface({ minHailZone: 6 }), [])).toBe(false);
  });

  it("puts axes on round steps", () => {
    expect(niceTicks(36_858)).toEqual([0, 10_000, 20_000, 30_000, 40_000]);
    expect(niceTicks(2_000)).toEqual([0, 500, 1_000, 1_500, 2_000]);
    expect(niceTicks(22_150_000)).toEqual([
      0, 10_000_000, 20_000_000, 30_000_000,
    ]);
    expect(niceTicks(0)).toEqual([0, 1]);
  });
});
