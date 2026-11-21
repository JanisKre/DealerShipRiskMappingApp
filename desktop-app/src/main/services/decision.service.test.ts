import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "@shared/types";

const mocks = vi.hoisted(() => ({
  settings: { language: "en" } as Settings,
  openAiKey: null as string | null,
  decisionKeys: {} as Record<string, string | null>,
  llmAnswer: {} as Record<string, string>,
  logged: [] as Array<{ provider: string; baseUrl: string; error?: unknown }>,
}));

vi.mock("./settings.service", () => ({
  getSettings: () => mocks.settings,
  getLlmApiKey: (provider: string) =>
    provider === "openai" ? mocks.openAiKey : null,
  getDecisionApiKey: (kind: string) => mocks.decisionKeys[kind] ?? null,
}));
vi.mock("./ai-log.service", () => ({
  recordAiCall: (call: {
    provider: string;
    baseUrl: string;
    error?: unknown;
  }) => mocks.logged.push(call),
}));
vi.mock("./llm-agents.service", () => ({
  completeJson: vi.fn(async () => mocks.llmAnswer),
}));
vi.mock("./site-check.service", () => ({
  encodeAerialImage: async () => ({ mediaType: "image/jpeg", base64: "AAAA" }),
  provenance: () => ({
    imageCapturedAt: "2024-05-01",
    imageLabel: "Esri World Imagery",
  }),
}));
vi.mock("./tiles.service", () => ({
  aerialImageForBoundary: async () => ({}),
}));

import {
  answerSiteQuestions,
  currentEngine,
  engineTarget,
  googleRequest,
  localDecisionModels,
  openAiRequest,
  questionsFor,
  readJevAnswers,
  readOpenAiAnswers,
  systemOneRequest,
  testDecisionEngine,
} from "./decision.service";
import { LLM_NOT_CONFIGURED } from "@shared/llm-config";

const fetchMock = vi.fn<typeof fetch>();
const image = { mediaType: "image/jpeg" as const, base64: "AAAA" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** The body of the n-th request. */
function sent(n = 0): Record<string, unknown> {
  return JSON.parse(String(fetchMock.mock.calls[n][1]?.body)) as Record<
    string,
    unknown
  >;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  mocks.settings = { language: "en" };
  mocks.openAiKey = null;
  mocks.decisionKeys = {};
  mocks.llmAnswer = {};
  mocks.logged = [];
});
afterEach(() => vi.unstubAllGlobals());

describe("questions", () => {
  it("asks about the boundary only when it is drawn on the image", () => {
    const ids = (outlined: boolean): string[] =>
      questionsFor(outlined).map((q) => q.id);
    expect(ids(true)).toContain("boundaryFits");
    expect(ids(false)).not.toContain("boundaryFits");
    expect(ids(false)[0]).toBe("imageUsable");
  });
});

describe("request formats", () => {
  const questions = questionsFor(true);

  it("builds an OpenAI Decisions request with predicates and one choice", () => {
    const body = openAiRequest("gpt-6-luna", image, questions, true) as {
      input: Array<{ content: Array<{ type: string; image_url?: string }> }>;
      questions: Array<{ type: string; name: string; choices?: unknown[] }>;
    };
    expect(body.input[0].content[1]).toMatchObject({
      type: "input_image",
      image_url: "data:image/jpeg;base64,AAAA",
    });
    expect(body.questions.find((q) => q.name === "hailNet")?.type).toBe(
      "predicate",
    );
    const share = body.questions.find((q) => q.name === "openAirShare");
    expect(share?.type).toBe("choice");
    expect(share?.choices).toHaveLength(3);
  });

  it("builds a Gemini request with noul and choice questions", () => {
    const body = googleRequest(
      "gemini-decision-1",
      image,
      questions,
      false,
    ) as {
      input: Array<{ type: string; data?: string }>;
      questions: Record<string, { type: string; criteria?: object }>;
    };
    expect(body.input[1]).toEqual({
      type: "image",
      data: "AAAA",
      mime_type: "image/jpeg",
    });
    expect(body.questions.hailNet.type).toBe("noul");
    expect(Object.keys(body.questions.openAirShare.criteria ?? {})).toEqual([
      "few",
      "aboutHalf",
      "most",
    ]);
  });

  it("passes the image as a named asset to SystemOne and as a list to Ollama", () => {
    const assets = systemOneRequest(
      "jev-latest",
      image,
      questions,
      true,
      "assets",
      "asset-1",
    ) as {
      state: { image: string };
      assets: Record<string, { data_base64: string; format: string }>;
    };
    expect(assets.state.image).toBe("asset-1");
    expect(assets.assets["asset-1"]).toMatchObject({
      type: "image",
      format: "jpg",
      data_base64: "AAAA",
    });
    const list = systemOneRequest(
      "d1:2b",
      image,
      questions,
      true,
      "images",
    ) as {
      images: string[];
      assets?: unknown;
    };
    expect(list.images).toEqual(["AAAA"]);
    expect(list.assets).toBeUndefined();
  });
});

describe("answer formats", () => {
  const questions = questionsFor(false);

  it("reads OpenAI answers and leaves a refused question unanswered", () => {
    const result = readOpenAiAnswers(
      {
        answers: [
          { type: "predicate", name: "imageUsable", probability: 0.97 },
          { type: "predicate", name: "hailNet", probability: 0.91 },
          { type: "refusal", name: "canopy" },
          {
            type: "choice",
            name: "openAirShare",
            choice: "most",
            probabilities: [
              { value: "most", probability: 0.8 },
              { value: "few", probability: 0.2 },
            ],
          },
        ],
      },
      questions,
    );
    expect(result.imageUsable).toBe(0.97);
    expect(result.answers.hailNet).toEqual({
      probabilities: { yes: 0.91, no: expect.closeTo(0.09, 5) },
      value: "yes",
    });
    expect(result.answers.canopy).toBeUndefined();
    expect(result.answers.openAirShare).toEqual({
      probabilities: { most: 0.8, few: 0.2 },
      value: "most",
    });
  });

  it("reads SystemOne answers keyed by question", () => {
    const result = readJevAnswers(
      {
        answers: {
          hailNet: { type: "noul", noul: 0.12 },
          openAirShare: {
            type: "choice",
            choice: "aboutHalf",
            probabilities: { aboutHalf: 0.7, most: 0.3 },
          },
        },
      },
      questions,
    );
    expect(result.answers.hailNet?.value).toBe("no");
    expect(result.answers.openAirShare?.value).toBe("aboutHalf");
    expect(result.imageUsable).toBeNull();
  });

  it("rejects an answer that is not one", () => {
    expect(() => readJevAnswers({ answers: "yes" }, questions)).toThrow();
  });
});

describe("engines", () => {
  it("needs a key for OpenAI and Google and a model for Ollama", () => {
    expect(() => engineTarget("openai")).toThrow(LLM_NOT_CONFIGURED);
    expect(() => engineTarget("google")).toThrow(LLM_NOT_CONFIGURED);
    expect(() => engineTarget("ollama")).toThrow(LLM_NOT_CONFIGURED);
    expect(() => engineTarget("systemone")).toThrow(LLM_NOT_CONFIGURED);
  });

  it("sends no key to a local Ollama and refuses one on another computer", () => {
    mocks.openAiKey = "sk-test";
    mocks.settings = {
      language: "en",
      decisions: { engine: "ollama", ollamaModel: "d1:2b" },
    };
    const target = engineTarget("ollama");
    expect(target.url).toBe("http://localhost:11434/v1/systemone");
    expect(target.headers).not.toHaveProperty("Authorization");
    mocks.settings = {
      language: "en",
      decisions: {
        engine: "ollama",
        ollamaModel: "d1:2b",
        ollamaBaseUrl: "http://10.0.0.5:11434",
      },
    };
    expect(() => engineTarget("ollama")).toThrow(/this computer/);
  });

  it("uses a self-hosted SystemOne server without a key, and TypeSafe only with one", () => {
    mocks.settings = {
      language: "en",
      decisions: {
        engine: "systemone",
        systemoneBaseUrl: "http://localhost:30000",
        systemoneModel: "Cloudflare/clef",
      },
    };
    const target = engineTarget("systemone");
    expect(target).toMatchObject({
      url: "http://localhost:30000/v1/systemone",
      model: "Cloudflare/clef",
    });
    expect(target.headers["TypeSafe-Danger-Zone-Images"]).toBe("true");
    expect(target.headers).not.toHaveProperty("Authorization");
    mocks.settings = { language: "en", decisions: { engine: "systemone" } };
    mocks.decisionKeys = { systemone: "ts-key" };
    expect(engineTarget("systemone").headers.Authorization).toBe(
      "Bearer ts-key",
    );
  });

  it("follows the AI provider when automatic", () => {
    mocks.settings = {
      language: "en",
      llm: { provider: "openai", model: "gpt-6.2-sol" },
    };
    mocks.openAiKey = "sk-test";
    expect(currentEngine()).toBe("openai");
    mocks.settings = {
      language: "en",
      llm: { provider: "claude", model: "claude-fable-5-2" },
    };
    expect(currentEngine()).toBe("llm");
    mocks.settings = { language: "en" };
    expect(() => currentEngine()).toThrow(LLM_NOT_CONFIGURED);
  });
});

describe("answering a location", () => {
  it("asks OpenAI, records the call and returns answers with their provenance", async () => {
    mocks.openAiKey = "sk-test";
    mocks.settings = { language: "en", decisions: { engine: "openai" } };
    fetchMock.mockResolvedValueOnce(
      json({
        answers: [
          { type: "predicate", name: "imageUsable", probability: 0.99 },
          { type: "predicate", name: "hailNet", probability: 0.93 },
        ],
      }),
    );
    const run = await answerSiteQuestions(48.1, 11.5, undefined);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://api.openai.com/v1/decisions",
    );
    expect(sent().model).toBe("gpt-6-luna");
    expect(run).toMatchObject({
      engine: "openai",
      model: "gpt-6-luna",
      imageUsable: true,
      imageCapturedAt: "2024-05-01",
    });
    expect(run.answers).toEqual([
      expect.objectContaining({
        question: "hailNet",
        source: "model",
        probabilityKind: "decision",
        probabilities: { yes: 0.93, no: expect.closeTo(0.07, 5) },
      }),
    ]);
    expect(mocks.logged).toHaveLength(1);
    expect(mocks.logged[0].provider).toBe("decisions:openai");
  });

  it("asks a local open model through Ollama", async () => {
    mocks.settings = {
      language: "en",
      decisions: { engine: "ollama", ollamaModel: "clef-flash" },
    };
    fetchMock.mockResolvedValueOnce(
      json({
        model: "clef-flash",
        answers: {
          imageUsable: { type: "noul", noul: 0.9 },
          canopy: { type: "noul", noul: 0.04 },
        },
        usage: { output_tokens: 0 },
      }),
    );
    const run = await answerSiteQuestions(48.1, 11.5, undefined);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "http://localhost:11434/v1/systemone",
    );
    expect(sent().images).toEqual(["AAAA"]);
    expect(run.answers[0]).toMatchObject({ question: "canopy", value: "no" });
  });

  it("falls back to the AI model, without probabilities", async () => {
    mocks.settings = {
      language: "en",
      llm: { provider: "claude", model: "claude-fable-5-2" },
    };
    mocks.llmAnswer = { imageUsable: "yes", hailNet: "yes", canopy: "maybe" };
    const run = await answerSiteQuestions(48.1, 11.5, undefined);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(run.engine).toBe("llm");
    expect(run.answers).toEqual([
      expect.objectContaining({ question: "hailNet", value: "yes" }),
      // Not an answer the question allows.
      expect.objectContaining({ question: "canopy", value: "unclear" }),
    ]);
    expect(run.answers[0].probabilities).toBeUndefined();
  });

  it("reports a refused request with its status and logs it", async () => {
    mocks.decisionKeys = { google: "g-key" };
    mocks.settings = { language: "en", decisions: { engine: "google" } };
    fetchMock.mockResolvedValueOnce(json({ error: { code: "safety" } }, 400));
    await expect(answerSiteQuestions(48.1, 11.5, undefined)).rejects.toThrow(
      /Decisions 400/,
    );
    expect(mocks.logged[0].error).toBeDefined();
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<
      string,
      string
    >;
    expect(headers["x-goog-api-key"]).toBe("g-key");
  });
});

describe("settings helpers", () => {
  it("tests an engine with one obvious question", async () => {
    mocks.settings = {
      language: "en",
      decisions: { engine: "ollama", ollamaModel: "d1:2b" },
    };
    fetchMock.mockResolvedValueOnce(
      json({ answers: { test: { type: "noul", noul: 0.98 } } }),
    );
    expect(await testDecisionEngine("ollama")).toEqual({
      ok: true,
      engine: "ollama",
      model: "d1:2b",
      probability: 0.98,
    });
    // A refused connection is tried once more, then reported.
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    expect(await testDecisionEngine("ollama")).toMatchObject({
      ok: false,
      error: "fetch failed",
    });
  });

  it("lists the models installed in Ollama, and says when it is not running", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ models: [{ name: "d1:2b" }, { name: "clef-flash:latest" }] }),
    );
    expect(await localDecisionModels()).toEqual({
      reachable: true,
      installed: ["d1:2b", "clef-flash:latest"],
    });
    fetchMock.mockRejectedValueOnce(new TypeError("connect ECONNREFUSED"));
    expect(await localDecisionModels()).toEqual({
      reachable: false,
      installed: [],
    });
  });
});
