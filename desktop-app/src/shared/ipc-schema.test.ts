import { describe, expect, it } from "vitest";
import { DEALERSHIP_NOTES_MAX_LENGTH } from "./constants";
import {
  LlmStreamEnvelopeSchema,
  ModelDownloadEnvelopeSchema,
  OllamaPullEnvelopeSchema,
  StreamCancelSchema,
  ipcRequest,
} from "./ipc-schema";

const streamId = "550e8400-e29b-41d4-a716-446655440000";

describe("streaming IPC envelopes", () => {
  it("accepts a valid LLM stream request", () => {
    expect(
      LlmStreamEnvelopeSchema.safeParse({
        streamId,
        req: { kind: "summary", sessionContext: "portfolio" },
      }).success,
    ).toBe(true);
  });

  it("rejects invalid stream IDs before channel construction", () => {
    expect(
      LlmStreamEnvelopeSchema.safeParse({
        streamId: "llm:stream:../../settings",
        req: { kind: "summary", sessionContext: "portfolio" },
      }).success,
    ).toBe(false);
    expect(
      StreamCancelSchema.safeParse({ streamId: "not-a-uuid" }).success,
    ).toBe(false);
  });

  it("validates model-download and cancellation envelopes", () => {
    expect(ModelDownloadEnvelopeSchema.safeParse({ streamId }).success).toBe(
      true,
    );
    expect(StreamCancelSchema.safeParse({ streamId }).success).toBe(true);
  });
});

describe("local model IPC payloads", () => {
  it("only lets Hugging Face GGUF references through to Ollama", () => {
    expect(
      OllamaPullEnvelopeSchema.safeParse({
        streamId,
        model: "hf.co/bartowski/Llama-3.2-3B-Instruct-GGUF:Q4_K_M",
      }).success,
    ).toBe(true);
    for (const model of [
      "llama3.2",
      "hf.co/owner/repo",
      "https://evil.example/model:Q4",
      "hf.co/owner/../repo:Q4",
    ]) {
      expect(
        OllamaPullEnvelopeSchema.safeParse({ streamId, model }).success,
      ).toBe(false);
    }
  });

  it("validates Hugging Face repository IDs and search input", () => {
    expect(
      ipcRequest["hf:modelFiles"].safeParse({ repoId: "owner/repo-GGUF" })
        .success,
    ).toBe(true);
    expect(
      ipcRequest["hf:modelFiles"].safeParse({ repoId: "../api/whoami" })
        .success,
    ).toBe(false);
    expect(
      ipcRequest["hf:searchModels"].safeParse({
        query: "x".repeat(101),
        sort: "trending",
      }).success,
    ).toBe(false);
  });
});

describe("dealership notes in saved sessions", () => {
  const session = (notes: string): unknown => ({
    session: {
      id: "s1",
      name: "Portfolio",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      dealerships: [{ id: "d1", name: "Dealer", lat: 51, lon: 7, notes }],
    },
  });

  it("accepts notes up to the length limit and rejects longer ones", () => {
    expect(
      ipcRequest["sessions:save"].safeParse(
        session("x".repeat(DEALERSHIP_NOTES_MAX_LENGTH)),
      ).success,
    ).toBe(true);
    expect(
      ipcRequest["sessions:save"].safeParse(
        session("x".repeat(DEALERSHIP_NOTES_MAX_LENGTH + 1)),
      ).success,
    ).toBe(false);
  });
});
