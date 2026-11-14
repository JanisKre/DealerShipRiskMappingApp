import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "@shared/types";
import type { ReviewPlanItem } from "@shared/review-plan";

const mocks = vi.hoisted(() => ({
  settings: { language: "de" } as Settings,
}));

vi.mock("./settings.service", () => ({
  getSettings: () => mocks.settings,
  getLlmApiKey: () => "sk-test",
}));

import { explainSystemPrompt, proposeReviewOrder } from "./llm-agents.service";

const fetchMock = vi.fn<typeof fetch>();

function reply(content: unknown): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content:
              typeof content === "string" ? content : JSON.stringify(content),
          },
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function sentMessages(call: number): Array<{ role: string; content: string }> {
  return (
    JSON.parse(String(fetchMock.mock.calls[call][1]?.body)) as {
      messages: Array<{ role: string; content: string }>;
    }
  ).messages;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  mocks.settings = {
    language: "de",
    llm: { provider: "openai", model: "gpt-4.1-mini" },
  };
});
afterEach(() => vi.unstubAllGlobals());

describe("explanations", () => {
  it("fences the facts, forbids invented figures and uses the app language", () => {
    for (const topic of ["comparison", "changes", "questionnaire"] as const) {
      const prompt = explainSystemPrompt(topic);
      expect(prompt).toContain("German");
      expect(prompt).toMatch(/never compute, estimate or invent figures/);
      expect(prompt).toContain("<facts>");
    }
    expect(explainSystemPrompt("questionnaire")).toMatch(
      /Do not add, drop or merge questions/,
    );
  });
});

describe("review order", () => {
  const item = (id: string, ealRank: number): ReviewPlanItem => ({
    id,
    reasons: ["boundary"],
    hailZone: 4,
    ealRank,
    imageryAgeYears: 3,
    boundarySource: "osm",
    boundaryConfidence: 0.3,
    vehicleSource: "estimated",
  });
  const items = [item("a", 1), item("b", 2), item("c", 3)];

  it("merges the proposal into the fixed queue and cleans the notes", async () => {
    fetchMock.mockResolvedValueOnce(
      reply({
        order: ["c", "zzz", "a"],
        notes: [
          { id: "c", text: "Sehr altes Luftbild in Zone 4." },
          { id: "a", text: "EAL 50.000 € prüfen" },
        ],
      }),
    );
    const plan = await proposeReviewOrder(items);
    expect(plan.order).toEqual(["c", "a", "b"]);
    expect(plan.notes).toEqual({ c: "Sehr altes Luftbild in Zone 4." });
    const [system, user] = sentMessages(0);
    expect(system.content).toContain("German");
    expect(user.content).toContain("<queue>");
  });

  it("asks once for a correction, then gives up", async () => {
    fetchMock
      .mockResolvedValueOnce(reply("keine Ahnung"))
      .mockResolvedValueOnce(reply({ order: ["b", "a", "c"] }));
    expect((await proposeReviewOrder(items)).order).toEqual(["b", "a", "c"]);
    expect(sentMessages(1).at(-1)?.content).toMatch(/rejected/);

    fetchMock
      .mockResolvedValueOnce(reply("nope"))
      .mockResolvedValueOnce(reply({ wrong: true }));
    await expect(proposeReviewOrder(items)).rejects.toThrow(
      /could not be used/,
    );
  });
});
