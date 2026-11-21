import { describe, expect, it } from "vitest";
import {
  CALIBRATION_MIN_LABELS,
  DEFAULT_THRESHOLD,
  calibrate,
  clearAnswer,
  engineKey,
  mergeAnswers,
  modelValue,
  protectionState,
  resolveAnswer,
  shownProbability,
  toRun,
  type SiteAnswer,
  type ThresholdTable,
} from "./site-questions";
import { answersFromSiteCheck } from "./site-check";

const person = (
  question: SiteAnswer["question"],
  value: string,
  source: "underwriter" | "dealer",
  at = "2026-11-20T10:00:00Z",
): SiteAnswer => ({ question, value, source, at });

const model = (
  question: SiteAnswer["question"],
  yes: number,
  at = "2026-11-21T10:00:00Z",
  engine: SiteAnswer["engine"] = "openai",
): SiteAnswer => ({
  question,
  value: yes >= 0.5 ? "yes" : "no",
  source: "model",
  at,
  engine,
  model: "gpt-6-luna",
  probabilities: { yes, no: 1 - yes },
  probabilityKind: "decision",
  imageCapturedAt: "2024-05-01",
  imageLabel: "Esri World Imagery",
});

describe("site answers", () => {
  it("keeps one answer per question, source and engine", () => {
    const merged = mergeAnswers(
      [person("hailNet", "no", "dealer"), model("hailNet", 0.9)],
      [
        person("hailNet", "yes", "dealer", "2026-11-22T00:00:00Z"),
        model("hailNet", 0.1, "2026-11-22T00:00:00Z"),
        model("hailNet", 0.7, "2026-11-22T00:00:00Z", "ollama"),
        // Not an answer this question can have: dropped.
        { ...person("hailNet", "most", "underwriter") },
      ],
    );
    expect(merged).toHaveLength(3);
    expect(merged.find((a) => a.source === "dealer")?.value).toBe("yes");
    expect(
      merged.filter((a) => a.engine === "openai")[0].probabilities?.yes,
    ).toBe(0.1);
    expect(
      clearAnswer(merged, "hailNet", "dealer").some(
        (a) => a.source === "dealer",
      ),
    ).toBe(false);
  });

  it("shows the underwriter before the dealer before the newest model answer", () => {
    const answers = [
      model("canopy", 0.95),
      person("canopy", "no", "dealer"),
      person("canopy", "unclear", "underwriter", "2026-01-01T00:00:00Z"),
    ];
    const resolved = resolveAnswer(answers, "canopy");
    expect(resolved).toMatchObject({
      value: "unclear",
      answer: { source: "underwriter" },
    });
    expect(resolved.others.map((a) => a.source)).toEqual(["dealer", "model"]);
    expect(resolveAnswer([], "canopy").value).toBe("unanswered");
    expect(resolveAnswer([model("canopy", 0.95)], "canopy").value).toBe("yes");
  });

  it("reads a probability against the measured threshold, else the wide default", () => {
    const a = model("hailNet", 0.7);
    expect(modelValue(a, undefined)).toBe("unclear");
    expect(modelValue(model("hailNet", DEFAULT_THRESHOLD.yes), undefined)).toBe(
      "yes",
    );
    expect(modelValue(model("hailNet", 0.15), undefined)).toBe("no");
    const table: ThresholdTable = {
      [engineKey("openai", "gpt-6-luna")]: {
        hailNet: { yes: 0.65, no: 0.3, n: 40, measuredAt: "2026-11-21" },
      },
    };
    expect(modelValue(a, table)).toBe("yes");
    // An answer in words keeps its word.
    expect(
      modelValue(
        {
          ...a,
          probabilities: undefined,
          probabilityKind: undefined,
          value: "no",
        },
        table,
      ),
    ).toBe("no");
  });

  it("shows a probability only once it is backed by a measurement", () => {
    const a = model("hailNet", 0.9);
    expect(shownProbability(a, undefined)).toBeNull();
    const table: ThresholdTable = {
      [engineKey("openai", "gpt-6-luna")]: {
        hailNet: { yes: 0.8, no: 0.2, n: 30 },
      },
    };
    expect(shownProbability(a, table)).toBe(0.9);
    // An unmeasured entry (no n) is a default, not a measurement.
    expect(
      shownProbability(a, {
        [engineKey("openai", "gpt-6-luna")]: { hailNet: { yes: 0.8, no: 0.2 } },
      }),
    ).toBeNull();
  });

  it("sums hail protection up in one word", () => {
    expect(protectionState(undefined)).toBe("unanswered");
    expect(
      protectionState([
        person("hailNet", "no", "underwriter"),
        person("canopy", "no", "underwriter"),
        person("parkingStructure", "no", "underwriter"),
      ]),
    ).toBe("notSeen");
    expect(
      protectionState([
        person("hailNet", "no", "underwriter"),
        model("parkingStructure", 0.97),
      ]),
    ).toBe("seen");
    expect(protectionState([person("hailNet", "no", "underwriter")])).toBe(
      "unclear",
    );
  });
});

describe("model runs", () => {
  it("turns every answer unclear on an image that cannot be judged", () => {
    const run = toRun({
      engine: "ollama",
      model: "d1:2b",
      imageCapturedAt: "2024-05-01",
      imageLabel: "Esri",
      imageUsable: 0.2,
      answers: {
        hailNet: { value: "yes", probabilities: { yes: 0.9, no: 0.1 } },
      },
    });
    expect(run.imageUsable).toBe(false);
    expect(run.answers[0]).toMatchObject({ value: "unclear" });
    expect(run.answers[0].probabilities).toBeUndefined();
  });

  it("keeps probabilities only for the question's options, clamped", () => {
    const run = toRun({
      engine: "google",
      model: "gemini-decision-1",
      imageCapturedAt: null,
      imageLabel: "Esri",
      imageUsable: 0.9,
      answers: {
        openAirShare: {
          value: "most",
          probabilities: { most: 1.2, few: -1, nonsense: 0.5 },
        },
      },
    });
    expect(run.answers[0]).toMatchObject({
      question: "openAirShare",
      value: "most",
      probabilities: { most: 1, few: 0 },
      probabilityKind: "decision",
    });
  });

  it("files the aerial image check's findings as answers without probabilities", () => {
    const answers = answersFromSiteCheck({
      checkedAt: "2026-11-21T00:00:00Z",
      model: "claude-fable-5-2",
      imageCapturedAt: "2024-05-01",
      imageLabel: "Esri",
      findings: {
        imageUsable: true,
        hailNet: "yes",
        canopy: "no",
        parkingStructure: "unclear",
        openAirShare: "few",
        note: "",
      },
    });
    expect(answers.map((a) => [a.question, a.value])).toEqual([
      ["hailNet", "yes"],
      ["canopy", "no"],
      ["parkingStructure", "unclear"],
      ["openAirShare", "few"],
    ]);
    expect(answers.every((a) => a.engine === "llm" && !a.probabilities)).toBe(
      true,
    );
  });
});

describe("comparison with labelled locations", () => {
  /** n locations: the model's probability and the underwriter's label. */
  function portfolio(pairs: Array<[number, boolean]>): Array<{
    siteAnswers: SiteAnswer[];
  }> {
    return pairs.map(([p, label]) => ({
      siteAnswers: [
        model("hailNet", p),
        person("hailNet", label ? "yes" : "no", "underwriter"),
      ],
    }));
  }

  it("needs enough labels of both kinds before it suggests thresholds", () => {
    const few = calibrate(
      portfolio([
        [0.9, true],
        [0.1, false],
      ]),
    );
    expect(few).toHaveLength(1);
    expect(few[0]).toMatchObject({ n: 2, positives: 1, suggested: null });
  });

  it("suggests the thresholds at which yes and no are right nine times in ten", () => {
    const pairs: Array<[number, boolean]> = [];
    for (let i = 0; i < 12; i++) pairs.push([0.85 + i * 0.01, true]);
    for (let i = 0; i < 12; i++) pairs.push([0.05 + i * 0.01, false]);
    // Two that a 0.5 cut would get wrong.
    pairs.push([0.55, false], [0.45, true]);
    const rows = calibrate(portfolio(pairs), new Date("2026-11-21T00:00:00Z"));
    expect(rows[0].n).toBeGreaterThanOrEqual(CALIBRATION_MIN_LABELS);
    const s = rows[0].suggested;
    expect(s).not.toBeNull();
    expect(s!.yes).toBeGreaterThan(s!.no);
    expect(s!.yes).toBeLessThanOrEqual(0.85);
    expect(s!.n).toBe(pairs.length);
    expect(rows[0].brier).toBeGreaterThan(0);
    expect(rows[0].brier).toBeLessThan(0.1);
  });

  it("ignores model answers without a decision probability", () => {
    const rows = calibrate([
      {
        siteAnswers: [
          {
            question: "hailNet",
            value: "yes",
            source: "model",
            at: "2026-11-21",
            engine: "llm",
            model: "x",
          },
          person("hailNet", "yes", "underwriter"),
        ],
      },
    ]);
    expect(rows).toEqual([]);
  });
});
