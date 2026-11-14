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

import {
  explainSystemPrompt,
  planChatTools,
  proposeReviewOrder,
  suggestColumnMapping,
} from "./llm-agents.service";
import { portfolioChatSystemPrompt } from "./llm.service";

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

describe("column mapping", () => {
  const columns = [
    { name: "Firma", hint: "text" as const, field: "name" as const },
    { name: "Wert in Euro", hint: "amount" as const, field: null },
    { name: "Vermittler", hint: "text" as const, field: null },
  ];

  it("sends names and hints only and keeps applicable suggestions", async () => {
    fetchMock.mockResolvedValueOnce(
      reply({
        mapping: [
          { column: "Wert in Euro", field: "assetValue" },
          { column: "Vermittler", field: "salesPartner" },
          { column: "Firma", field: "group" },
        ],
      }),
    );
    expect(await suggestColumnMapping(columns)).toEqual({
      assetValue: "Wert in Euro",
      salesPartner: "Vermittler",
    });
    const user = sentMessages(0)[1].content;
    expect(user).toContain('"hint":"amount"');
    expect(user).not.toMatch(/\d{3}/);
  });

  it("does not ask when every column is used", async () => {
    expect(await suggestColumnMapping([columns[0]])).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("chat lookups", () => {
  const locations = [
    { id: "a", name: "Autohaus Nord" },
    { id: "b", name: "Autohaus Süd" },
  ];

  it("returns cleaned calls and marks the selected location", async () => {
    fetchMock.mockResolvedValueOnce(
      reply({
        calls: [
          { tool: "radarHail", locationId: "b" },
          { tool: "shell", locationId: "b" },
          { tool: "evidence", locationId: "nope" },
        ],
      }),
    );
    expect(await planChatTools("Hagel bei Süd?", locations, "b")).toEqual([
      { tool: "radarHail", locationId: "b" },
    ]);
    expect(sentMessages(0)[1].content).toContain("b\tAutohaus Süd\tSELECTED");
  });

  it("falls back to no lookups on any failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(await planChatTools("x", locations, null)).toEqual([]);
  });

  it("fences the lookup results in the chat prompt", () => {
    const prompt = portfolioChatSystemPrompt("ctx", "German", "[radarHail] A");
    expect(prompt).toContain(
      "<lookup_results>\n[radarHail] A\n</lookup_results>",
    );
    expect(portfolioChatSystemPrompt("ctx", "German")).not.toContain(
      "lookup_results",
    );
  });
});
