import { describe, expect, it } from "vitest";
import {
  DecisionSettingsSchema,
  isLocalDecisionModel,
  isLocalEngine,
  resolveEngine,
  validateDecisionEndpoint,
  validateOllamaOrigin,
} from "./decision-engines";

describe("decision engines", () => {
  it("accepts HTTPS servers and HTTP on this computer only", () => {
    expect(validateDecisionEndpoint("https://api.typesafe.ai/")).toEqual({
      ok: true,
      url: "https://api.typesafe.ai",
    });
    expect(validateDecisionEndpoint("http://localhost:30000")).toMatchObject({
      ok: true,
    });
    expect(validateDecisionEndpoint("http://example.com")).toEqual({
      ok: false,
      problem: "insecure",
    });
    expect(validateDecisionEndpoint("https://user:pw@api.typesafe.ai")).toEqual(
      { ok: false, problem: "credentials" },
    );
    expect(validateDecisionEndpoint("file:///etc/passwd")).toEqual({
      ok: false,
      problem: "scheme",
    });
  });

  it("keeps Ollama on this computer", () => {
    expect(validateOllamaOrigin("http://127.0.0.1:11434/v1")).toEqual({
      ok: true,
      url: "http://127.0.0.1:11434",
    });
    expect(validateOllamaOrigin("https://ollama.example.com")).toEqual({
      ok: false,
      problem: "insecure",
    });
  });

  it("follows the AI provider when set to automatic", () => {
    const base = { decisions: undefined, hasOpenAiKey: false };
    expect(resolveEngine({ ...base, llmProvider: null })).toBeNull();
    expect(
      resolveEngine({ ...base, llmProvider: "openai", hasOpenAiKey: true }),
    ).toBe("openai");
    // A Claude user gets the AI model as fallback, no other vendor.
    expect(resolveEngine({ ...base, llmProvider: "claude" })).toBe("llm");
    // A local setup stays local.
    expect(resolveEngine({ ...base, llmProvider: "local" })).toBe("llm");
    expect(
      resolveEngine({
        ...base,
        llmProvider: "local",
        decisions: { engine: "auto", ollamaModel: "d1:2b" },
      }),
    ).toBe("ollama");
    expect(
      resolveEngine({
        ...base,
        llmProvider: "openai",
        hasOpenAiKey: true,
        decisions: { engine: "google" },
      }),
    ).toBe("google");
  });

  it("says when the image stays here", () => {
    expect(isLocalEngine("ollama", { llmProvider: null })).toBe(true);
    expect(isLocalEngine("openai", { llmProvider: "openai" })).toBe(false);
    expect(isLocalEngine("llm", { llmProvider: "local" })).toBe(true);
    expect(
      isLocalEngine("systemone", {
        llmProvider: null,
        systemoneBaseUrl: "http://localhost:8000",
      }),
    ).toBe(true);
    expect(
      isLocalEngine("systemone", {
        llmProvider: null,
        systemoneBaseUrl: "https://api.typesafe.ai",
      }),
    ).toBe(false);
  });

  it("offers only listed open models for download and rejects odd model names", () => {
    expect(isLocalDecisionModel("d1:2b")).toBe(true);
    expect(isLocalDecisionModel("llama3")).toBe(false);
    expect(
      DecisionSettingsSchema.safeParse({
        engine: "ollama",
        ollamaModel: "d1:2b",
      }).success,
    ).toBe(true);
    expect(
      DecisionSettingsSchema.safeParse({ ollamaModel: "../../etc" }).success,
    ).toBe(false);
  });
});
