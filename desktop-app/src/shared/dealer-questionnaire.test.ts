import { describe, expect, it } from "vitest";
import type { AnalyzedDealership } from "./types";
import { QUESTION_IDS, buildQuestionnaire } from "./dealer-questionnaire";
import de from "../renderer/src/locales/de.json";
import en from "../renderer/src/locales/en.json";
import fr from "../renderer/src/locales/fr.json";

const now = new Date("2026-11-14T00:00:00Z");

function site(patch: Partial<AnalyzedDealership> = {}): AnalyzedDealership {
  return {
    id: "a",
    name: "Autohaus A",
    lat: 50,
    lon: 10,
    hailZone: 2,
    detection: { vehicleCount: 80, confidence: 0.8, model: "yolo" },
    risk: {
      overallScore: 30,
      perils: [],
      eal: 1_000,
      computedAt: "2026-06-01T10:00:00Z",
    },
    ...patch,
  } as AnalyzedDealership;
}

describe("dealer questionnaire", () => {
  it("asks the basic questions for an unremarkable site", () => {
    expect(buildQuestionnaire(site(), now).map((q) => q.id)).toEqual([
      "hailProtection",
      "coveredSpaces",
      "outdoorAtNight",
      "pastLosses",
    ]);
  });

  it("adds questions for what is uncertain at the site", () => {
    const flagged = site({
      hailZone: 5,
      boundary: {
        source: "synthetic",
        polygon: { type: "Polygon", coordinates: [] },
        areaSqm: 1_000,
        confidence: 0.2,
      },
      detection: {
        vehicleCount: 80,
        confidence: 0.8,
        model: "yolo",
        imagery: {
          chosen: {
            id: "esri:z19",
            kind: "esri",
            label: "Esri",
            capturedAt: "2021-04-01",
            dateSource: "esri-metadata",
            resolutionM: 0.3,
            zoom: 19,
            attribution: "",
          },
          alternatives: [],
        },
      },
    } as unknown as Partial<AnalyzedDealership>);
    const questions = buildQuestionnaire(flagged, now);
    expect(questions.map((q) => q.id)).toEqual([
      "hailProtection",
      "coveredSpaces",
      "outdoorAtNight",
      "seasonalPeak",
      "hailWarning",
      "lotExtent",
      "siteChanges",
      "pastLosses",
    ]);
    expect(questions.find((q) => q.id === "siteChanges")?.values).toEqual({
      year: "2021",
    });
  });

  it("asks for the average stock when no count exists, not after a review", () => {
    const noCount = site({ detection: undefined });
    expect(buildQuestionnaire(noCount, now).map((q) => q.id)).toContain(
      "averageStock",
    );
    const reviewed = site({
      detection: {
        vehicleCount: 80,
        manualVehicleCount: 75,
        confidence: 0.8,
        model: "area-estimate",
      },
    } as unknown as Partial<AnalyzedDealership>);
    expect(buildQuestionnaire(reviewed, now).map((q) => q.id)).not.toContain(
      "averageStock",
    );
  });

  it("has a text for every question in every language", () => {
    for (const locale of [de, en, fr]) {
      for (const id of QUESTION_IDS)
        expect(locale.questionnaire.q[id]).toBeTruthy();
    }
  });
});
