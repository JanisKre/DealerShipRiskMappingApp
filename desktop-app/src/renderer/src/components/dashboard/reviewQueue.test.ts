import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import type { AnalyzedDealership } from "@shared/types";
import { DEFAULT_RISK_PARAMETERS } from "@shared/parameters";
import {
  buildReviewQueue,
  isReviewCurrent,
  nextInReview,
  reviewReasons,
} from "./reviewQueue";

const t = ((key: string) => key) as unknown as TFunction;

function site(
  id: string,
  patch: Partial<AnalyzedDealership> = {},
): AnalyzedDealership {
  return {
    id,
    name: `Autohaus ${id}`,
    lat: 51 + Number.parseInt(id, 36) * 0.5,
    lon: 10,
    risk: {
      overallScore: 30,
      perils: [{ peril: "hail", score: 30, hazardValue: 0, unit: "score" }],
      eal: 1_000,
      computedAt: "2026-11-13T00:00:00Z",
    },
    ...patch,
  } as AnalyzedDealership;
}

const boundary = {
  source: "alkis" as const,
  polygon: { type: "Polygon" as const, coordinates: [] },
  areaSqm: 1_000,
  confidence: 0.4,
  reviewRequired: true,
};

describe("review queue", () => {
  it("names the open points of a location", () => {
    expect(
      reviewReasons(t, site("a"), [site("a")], DEFAULT_RISK_PARAMETERS),
    ).toEqual([]);
    const flagged = site("b", {
      boundary,
      detection: {
        vehicleCount: 3,
        confidence: 0.8,
        model: "yolo",
        imagery: {
          chosen: {
            id: "esri:z19",
            kind: "esri",
            label: "Esri",
            capturedAt: "2015-05-01",
            dateSource: "esri-metadata",
            resolutionM: 0.3,
            zoom: 19,
            attribution: "Esri",
          },
          alternatives: [],
          reason: "test",
        },
      } as unknown as AnalyzedDealership["detection"],
    });
    expect(
      reviewReasons(t, flagged, [flagged], DEFAULT_RISK_PARAMETERS),
    ).toEqual(["boundary", "imagery"]);
  });

  it("drops reviewed locations until their result changes", () => {
    const reviewed = site("c", {
      boundary,
      history: [
        { at: "2026-11-01T00:00:00Z", kind: "analyzed" },
        { at: "2026-11-02T00:00:00Z", kind: "reviewed" },
        {
          at: "2026-11-03T00:00:00Z",
          kind: "businessTypeChanged",
          value: "new",
        },
      ],
    });
    expect(isReviewCurrent(reviewed)).toBe(true);
    const reanalyzed = {
      ...reviewed,
      history: [
        ...(reviewed.history ?? []),
        { at: "2026-11-04T00:00:00Z", kind: "analyzed" as const },
      ],
    };
    expect(isReviewCurrent(reanalyzed)).toBe(false);
    expect(isReviewCurrent(site("d"))).toBe(false);
  });

  it("orders the queue by hail EAL and skips done locations", () => {
    const low = site("e", { boundary });
    const high = site("f", {
      boundary,
      risk: { ...site("f").risk!, eal: 9_000 },
    });
    const done = site("g", {
      boundary,
      history: [{ at: "2026-11-02T00:00:00Z", kind: "reviewed" }],
    });
    const clean = site("h");
    const all = [low, high, done, clean];
    expect(buildReviewQueue(t, all, DEFAULT_RISK_PARAMETERS)).toEqual([
      "f",
      "e",
    ]);
  });

  it("finds the next open stop of a run", () => {
    const open = new Set(["b", "d"]);
    expect(nextInReview(["a", "b", "c", "d"], "a", (id) => open.has(id))).toBe(
      "b",
    );
    expect(nextInReview(["a", "b", "c", "d"], "b", (id) => open.has(id))).toBe(
      "d",
    );
    expect(
      nextInReview(["a", "b", "c", "d"], "d", (id) => open.has(id)),
    ).toBeNull();
  });
});
