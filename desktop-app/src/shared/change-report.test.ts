import { describe, expect, it } from "vitest";
import type { AnalyzedDealership } from "./types";
import type { ImageryCandidate, ImagerySelection } from "./imagery-sources";
import type { RadarHailResult } from "./radar-hail";
import {
  buildChangeReport,
  changeReportCounts,
  changeReportFacts,
  lastAnalyzedOn,
  newerImageryThan,
} from "./change-report";

function candidate(
  id: string,
  capturedAt: string | null,
  resolutionM: number,
  kind: ImageryCandidate["kind"] = "state-dop",
): ImageryCandidate {
  return {
    id,
    kind,
    label: id,
    capturedAt,
    dateSource: "bkg-flight-index",
    resolutionM,
    zoom: 19,
    attribution: "",
  };
}

function selection(candidates: ImageryCandidate[]): ImagerySelection {
  return {
    mode: "auto",
    chosen: candidates[0],
    reason: "newest",
    candidates,
    toleranceDays: 183,
    resolvedAt: "2026-11-14T00:00:00Z",
  } as ImagerySelection;
}

function radar(
  days: Array<[string, "large" | "hail" | "mixed"]>,
): RadarHailResult {
  return {
    days: days.map(([date, hailClass]) => ({
      date,
      hailClass,
      firstAt: `${date}T14:00:00Z`,
      lastAt: `${date}T14:30:00Z`,
      distanceKm: 0,
      maxDbz: 60,
      steps: 3,
    })),
    archiveFrom: "2026-05-01",
    archiveTo: "2026-11-14",
    steps: 100,
    radiusKm: 1,
    synced: true,
    syncing: false,
  } as unknown as RadarHailResult;
}

function site(
  id: string,
  eal: number,
  countedOn: string | null = "2024-05-01",
): AnalyzedDealership {
  return {
    id,
    name: `Autohaus ${id}`,
    history: [{ at: "2026-06-01T10:00:00Z", kind: "analyzed" }],
    detection: {
      vehicleCount: 10,
      confidence: 0.8,
      model: "yolo",
      imagery: countedOn
        ? { chosen: candidate("dop:BY", countedOn, 0.2), alternatives: [] }
        : undefined,
    },
    risk: {
      overallScore: 30,
      perils: [],
      eal,
      computedAt: "2026-06-01T10:00:00Z",
    },
  } as unknown as AnalyzedDealership;
}

describe("change report", () => {
  it("dates the last analysis from the history, else the risk timestamp", () => {
    expect(lastAnalyzedOn(site("a", 1))).toBe("2026-06-01");
    const noHistory = { ...site("a", 1), history: [] };
    expect(lastAnalyzedOn(noHistory)).toBe("2026-06-01");
    expect(lastAnalyzedOn({ ...noHistory, risk: undefined })).toBeNull();
  });

  it("only counts newer images sharp enough for vehicle detection", () => {
    const counted = { capturedAt: "2024-05-01" };
    expect(
      newerImageryThan(
        counted,
        selection([
          candidate("esri:z19", "2026-03-01", 0.3, "esri"),
          candidate("wayback", "2026-04-01", 0.1, "esri-wayback"),
          candidate("dop:old", "2023-01-01", 0.2),
          candidate("dop:new", "2025-08-01", 0.2),
          candidate("undated", null, 0.1),
        ]),
      ),
    ).toEqual({ label: "dop:new", capturedAt: "2025-08-01" });
    expect(newerImageryThan(undefined, selection([]))).toBeNull();
    expect(newerImageryThan(counted, null)).toBeNull();
  });

  it("lists hail after the analysis first and skips unchanged locations", () => {
    const rows = buildChangeReport([
      {
        dealership: site("quiet", 9_000),
        imagery: selection([candidate("dop:BY", "2024-05-01", 0.2)]),
        radar: radar([["2026-05-20", "large"]]),
        openReviewPoints: 0,
      },
      {
        dealership: site("image", 5_000),
        imagery: selection([candidate("dop:BY", "2025-07-01", 0.2)]),
        radar: radar([]),
        openReviewPoints: 0,
      },
      {
        dealership: site("hail", 100),
        imagery: null,
        radar: radar([
          ["2026-07-02", "hail"],
          ["2026-08-15", "large"],
        ]),
        openReviewPoints: 2,
      },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["hail", "image"]);
    expect(rows[0]).toMatchObject({
      kinds: ["radarHail", "openReview"],
      hailDays: [
        { date: "2026-08-15", hailClass: "large" },
        { date: "2026-07-02", hailClass: "hail" },
      ],
      openReviewPoints: 2,
    });
    expect(rows[1].newerImagery).toEqual({
      label: "dop:BY",
      capturedAt: "2025-07-01",
      previousCapturedAt: "2024-05-01",
    });
    expect(changeReportCounts(rows)).toEqual({
      locations: 2,
      radarHail: 1,
      newerImagery: 1,
      openReview: 1,
    });
    const facts = changeReportFacts(rows, 3);
    expect(facts).toContain("Locations checked: 3");
    expect(facts).toContain("radar hail on 2026-08-15 (large)");
    expect(facts).toContain("newer image dop:BY from 2025-07-01");
  });
});
