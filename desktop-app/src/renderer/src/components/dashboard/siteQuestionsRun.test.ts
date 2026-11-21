import { describe, expect, it } from "vitest";
import type { AnalyzedDealership } from "@shared/types";
import { siteRunCandidates } from "./siteQuestionsRun";

const loc = (
  id: string,
  eal: number | null,
  engines: string[] = [],
): AnalyzedDealership =>
  ({
    id,
    name: id,
    lat: 50,
    lon: 10,
    risk: eal == null ? undefined : { overallScore: 1, perils: [], eal },
    siteAnswers: engines.map((engine) => ({
      question: "hailNet",
      value: "yes",
      source: "model",
      at: "2026-11-21",
      engine,
    })),
  }) as AnalyzedDealership;

describe("site question run", () => {
  it("takes analysed locations this engine has not answered, highest EAL first", () => {
    expect(
      siteRunCandidates(
        [
          loc("low", 100),
          loc("pending", null),
          loc("high", 9000),
          loc("done", 5000, ["openai"]),
          loc("other", 3000, ["llm"]),
        ],
        "openai",
      ),
    ).toEqual(["high", "other", "low"]);
  });
});
