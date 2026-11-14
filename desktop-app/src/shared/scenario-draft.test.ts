import { describe, expect, it } from "vitest";
import { normaliseScenarioDraft, scenarioFromDraft } from "./scenario-draft";

describe("scenario draft", () => {
  it("normalises places, width and intensity", () => {
    expect(
      normaliseScenarioDraft(
        {
          places: [" München ", "münchen", "Augsburg", "", "Ulm"],
          widthKm: 250,
          intensityLevel: "extreme",
          name: null,
        },
        "Szenario",
      ),
    ).toEqual({
      places: ["München", "Augsburg", "Ulm"],
      widthKm: 100,
      intensityLevel: "EXTREME",
      name: "Szenario",
    });
    const defaults = normaliseScenarioDraft(
      { places: ["A-Stadt", "B-Dorf"], intensityLevel: "brutal" },
      "x",
    );
    expect(defaults).toMatchObject({ widthKm: 10, intensityLevel: "HIGH" });
  });

  it("needs a start and an end", () => {
    expect(() =>
      normaliseScenarioDraft({ places: ["München", "münchen"] }, "x"),
    ).toThrow(/fewer than two places/);
  });

  it("builds the corridor from geocoded places or names the missing ones", () => {
    const draft = normaliseScenarioDraft(
      { places: ["München", "Augsburg"], widthKm: 12, name: "Zug" },
      "x",
    );
    const base = { id: "s1", modelVersion: "scenario-screening-0.2.0" };
    expect(
      scenarioFromDraft(
        draft,
        [
          { lat: 48.14, lon: 11.58 },
          { lat: 48.37, lon: 10.9 },
        ],
        base,
      ),
    ).toEqual({
      scenario: {
        id: "s1",
        name: "Zug",
        pathCoordinates: [
          [11.58, 48.14],
          [10.9, 48.37],
        ],
        widthKm: 12,
        intensityLevel: "HIGH",
        returnPeriodYears: 100,
        exposureMultiplier: 1,
        modelVersion: "scenario-screening-0.2.0",
      },
    });
    expect(
      scenarioFromDraft(draft, [{ lat: 48.14, lon: 11.58 }, null], base),
    ).toEqual({ missing: ["Augsburg"] });
  });
});
