import { describe, expect, it } from "vitest";
import { DEALERSHIP_NOTES_MAX_LENGTH } from "./constants";
import {
  CLIPBOARD_TEXT_MAX_CHARS,
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
        req: { kind: "chat", messages: [], sessionContext: "portfolio" },
      }).success,
    ).toBe(true);
  });

  it("rejects invalid stream IDs before channel construction", () => {
    expect(
      LlmStreamEnvelopeSchema.safeParse({
        streamId: "llm:stream:../../settings",
        req: { kind: "chat", messages: [], sessionContext: "portfolio" },
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

describe("dealership website in saved sessions", () => {
  const session = (website: string): unknown => ({
    session: {
      id: "s1",
      name: "Portfolio",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      dealerships: [
        {
          id: "d1",
          name: "Dealer",
          lat: 51,
          lon: 7,
          website,
          websiteSource: "manual",
        },
      ],
    },
  });

  it("accepts http(s) websites and rejects other schemes", () => {
    expect(
      ipcRequest["sessions:save"].safeParse(session("https://autohaus.de/"))
        .success,
    ).toBe(true);
    expect(
      ipcRequest["sessions:save"].safeParse(session("javascript:alert(1)"))
        .success,
    ).toBe(false);
  });
});

describe("clipboard:writeText", () => {
  const schema = ipcRequest["clipboard:writeText"];

  it("accepts plain text up to the limit", () => {
    expect(schema.safeParse({ text: "Antwort" }).success).toBe(true);
    expect(
      schema.safeParse({ text: "x".repeat(CLIPBOARD_TEXT_MAX_CHARS) }).success,
    ).toBe(true);
  });

  it("rejects empty, oversized and non-text payloads", () => {
    expect(schema.safeParse({ text: "" }).success).toBe(false);
    expect(
      schema.safeParse({ text: "x".repeat(CLIPBOARD_TEXT_MAX_CHARS + 1) })
        .success,
    ).toBe(false);
    expect(schema.safeParse({ text: 42 }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
  });
});

describe("hail:history", () => {
  const schema = ipcRequest["hail:history"];
  it("accepts coordinates and rejects out-of-range ones", () => {
    expect(schema.safeParse({ lat: 51.05, lon: 13.74 }).success).toBe(true);
    expect(schema.safeParse({ lat: 91, lon: 13 }).success).toBe(false);
    expect(schema.safeParse({ lat: 51, lon: "13" }).success).toBe(false);
  });
});

describe("report:location", () => {
  const schema = ipcRequest["report:location"];
  const dealership = { id: "a", name: "Autohaus", lat: 51, lon: 13 };
  it("accepts a location with a locale and review notes", () => {
    expect(
      schema.safeParse({
        dealership,
        locale: "de",
        reviewNotes: ["Grenze prüfen"],
      }).success,
    ).toBe(true);
  });
  it("rejects unknown locales, too many or too long notes", () => {
    expect(
      schema.safeParse({ dealership, locale: "es", reviewNotes: [] }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        dealership,
        locale: "en",
        reviewNotes: Array(13).fill("x"),
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        dealership,
        locale: "en",
        reviewNotes: ["x".repeat(301)],
      }).success,
    ).toBe(false);
  });
});
