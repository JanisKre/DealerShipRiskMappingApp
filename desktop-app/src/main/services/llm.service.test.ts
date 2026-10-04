import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "@shared/types";

const mocks = vi.hoisted(() => ({
  settings: { language: "en" } as Settings,
  apiKey: null as string | null,
}));

vi.mock("./settings.service", () => ({
  getSettings: () => mocks.settings,
  getLlmApiKey: () => mocks.apiKey,
}));

import { HttpRequestError } from "./http.service";
import {
  classifyLlmError,
  detectLocalRuntimes,
  listLlmModels,
  testLlmConnection,
} from "./llm.service";

const fetchMock = vi.fn<typeof fetch>();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("LLM setup helpers", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    mocks.settings = { language: "en" };
    mocks.apiKey = null;
  });

  afterEach(() => vi.unstubAllGlobals());

  it("reports not_configured on first start without sending a request", async () => {
    const result = await testLlmConnection();
    expect(result).toMatchObject({ ok: false, code: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports ok for a working endpoint (same streaming path as the chat)", async () => {
    mocks.settings = {
      language: "en",
      llm: { provider: "openai", model: "gpt-4.1-mini" },
    };
    mocks.apiKey = "sk-test";
    fetchMock.mockResolvedValueOnce(
      new Response(
        'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n',
        { status: 200 },
      ),
    );

    const result = await testLlmConnection();

    expect(result).toMatchObject({ ok: true, code: "ok" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer sk-test",
    );
  });

  it("classifies provider failures", () => {
    expect(classifyLlmError(new Error('LLM 401: {"error":"bad key"}'))).toBe(
      "auth",
    );
    expect(classifyLlmError(new Error("Claude 403: forbidden"))).toBe("auth");
    expect(classifyLlmError(new Error("LLM 404: model not found"))).toBe(
      "not_found",
    );
    expect(
      classifyLlmError(new Error('LLM 400: {"error":"model "x" not found"}')),
    ).toBe("not_found");
    expect(classifyLlmError(new Error("LLM 500: boom"))).toBe("error");
    expect(classifyLlmError(new TypeError("fetch failed"))).toBe("unreachable");
    expect(
      classifyLlmError(new HttpRequestError("timed out", { timedOut: true })),
    ).toBe("unreachable");
  });

  it("never sends a key to the local provider and stays on loopback", async () => {
    mocks.settings = {
      language: "en",
      llm: { provider: "local", model: "llama3.2" },
    };
    mocks.apiKey = "sk-cloud-key";
    fetchMock.mockResolvedValueOnce(
      json({ data: [{ id: "qwen3:8b" }, { id: "llama3.2" }] }),
    );

    await expect(listLlmModels()).resolves.toEqual({
      models: [{ id: "llama3.2" }, { id: "qwen3:8b" }],
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:11434/v1/models");
    expect(init?.headers).toEqual({});
  });

  it("refuses a local provider URL that points to another machine", async () => {
    mocks.settings = {
      language: "en",
      llm: {
        provider: "local",
        model: "llama3.2",
        baseUrl: "http://192.168.1.20:11434/v1",
      },
    };
    await expect(listLlmModels()).rejects.toThrow(/localhost/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lists models before one is chosen and hides non-chat OpenAI models", async () => {
    mocks.settings = { language: "en", llm: { provider: "openai", model: "" } };
    mocks.apiKey = "sk-test";
    fetchMock.mockResolvedValueOnce(
      json({
        data: [
          { id: "gpt-4.1-mini" },
          { id: "text-embedding-3-small" },
          { id: "whisper-1" },
          { id: "gpt-4.1" },
        ],
      }),
    );

    await expect(listLlmModels()).resolves.toEqual({
      models: [{ id: "gpt-4.1" }, { id: "gpt-4.1-mini" }],
    });
  });

  it("reads the Anthropic model list with display names", async () => {
    mocks.settings = { language: "en", llm: { provider: "claude", model: "" } };
    mocks.apiKey = "sk-ant";
    fetchMock.mockResolvedValueOnce(
      json({ data: [{ id: "claude-x", display_name: "Claude X" }] }),
    );

    await expect(listLlmModels()).resolves.toEqual({
      models: [{ id: "claude-x", label: "Claude X" }],
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/models?limit=100");
    expect((init?.headers as Record<string, string>)["x-api-key"]).toBe(
      "sk-ant",
    );
  });

  it("lists newest models first when the endpoint reports creation dates", async () => {
    mocks.settings = {
      language: "en",
      llm: { provider: "custom", model: "", baseUrl: "https://llm.example/v1" },
    };
    fetchMock.mockResolvedValueOnce(
      json({
        data: [
          { id: "old", created: 100 },
          { id: "new", created: 300 },
          { id: "mid", created: 200 },
        ],
      }),
    );

    await expect(listLlmModels()).resolves.toEqual({
      models: [{ id: "new" }, { id: "mid" }, { id: "old" }],
    });
  });

  it("detects which local runtimes are running", async () => {
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.startsWith("http://localhost:1234/"))
        return Promise.resolve(json({ data: [{ id: "a" }, { id: "b" }] }));
      return Promise.reject(new TypeError("fetch failed"));
    });

    const status = await detectLocalRuntimes();

    expect(status).toEqual([
      {
        runtime: "ollama",
        baseUrl: "http://localhost:11434/v1",
        reachable: false,
      },
      {
        runtime: "lmstudio",
        baseUrl: "http://localhost:1234/v1",
        reachable: true,
        modelCount: 2,
      },
      {
        runtime: "llamacpp",
        baseUrl: "http://localhost:8080/v1",
        reachable: false,
      },
    ]);
    expect(
      fetchMock.mock.calls.every(([u]) =>
        String(u).startsWith("http://localhost:"),
      ),
    ).toBe(true);
  });
});
