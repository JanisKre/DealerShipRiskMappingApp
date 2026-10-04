import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OllamaPullChunk } from "@shared/ipc-schema";
import type { Settings } from "@shared/types";

const mocks = vi.hoisted(() => ({
  settings: { language: "en" } as Settings,
}));

vi.mock("./settings.service", () => ({ getSettings: () => mocks.settings }));

import {
  OllamaUnreachableError,
  parsePullEvent,
  pullOllamaModel,
} from "./ollama.service";

const MODEL = "hf.co/owner/Model-GGUF:Q4_K_M";
const fetchMock = vi.fn<typeof fetch>();

function ndjson(lines: unknown[]): Response {
  const body = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  return new Response(body, { status: 200 });
}

describe("Ollama pull", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    mocks.settings = { language: "en" };
  });

  afterEach(() => vi.unstubAllGlobals());

  it("streams progress and finishes on success", async () => {
    fetchMock.mockResolvedValueOnce(
      ndjson([
        { status: "pulling manifest" },
        { status: "pulling abc", total: 100, completed: 50 },
        { status: "success" },
      ]),
    );
    const chunks: OllamaPullChunk[] = [];

    await pullOllamaModel(
      MODEL,
      (c) => chunks.push(c),
      new AbortController().signal,
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:11434/api/pull");
    expect(JSON.parse(String(init?.body))).toEqual({
      model: MODEL,
      stream: true,
    });
    expect(chunks.at(-1)).toEqual({ type: "done", model: MODEL });
    expect(chunks).toContainEqual({
      type: "progress",
      status: "pulling abc",
      completedBytes: 50,
      totalBytes: 100,
    });
  });

  it("surfaces Ollama's error line", async () => {
    fetchMock.mockResolvedValueOnce(
      ndjson([
        { status: "pulling manifest" },
        { error: "file does not exist" },
      ]),
    );
    await expect(
      pullOllamaModel(MODEL, () => undefined, new AbortController().signal),
    ).rejects.toThrow("file does not exist");
  });

  it("reports a missing Ollama as unreachable", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(
      pullOllamaModel(MODEL, () => undefined, new AbortController().signal),
    ).rejects.toBeInstanceOf(OllamaUnreachableError);
  });

  it("follows the local base URL but never leaves loopback", async () => {
    mocks.settings = {
      language: "en",
      llm: {
        provider: "local",
        model: "",
        baseUrl: "http://10.0.0.5:11434/v1",
      },
    };
    await expect(
      pullOllamaModel(MODEL, () => undefined, new AbortController().signal),
    ).rejects.toThrow(/localhost/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects model references outside the Hugging Face pattern", async () => {
    await expect(
      pullOllamaModel(
        "llama3.2",
        () => undefined,
        new AbortController().signal,
      ),
    ).rejects.toThrow("Invalid model reference");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores malformed NDJSON lines", () => {
    expect(parsePullEvent("not json")).toBeNull();
    expect(parsePullEvent('{"status":"x","total":-1}')).toEqual({
      status: "x",
      completed: undefined,
      total: undefined,
      error: undefined,
    });
  });
});
