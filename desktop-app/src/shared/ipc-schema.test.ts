import { describe, expect, it } from "vitest";
import {
  LlmStreamEnvelopeSchema,
  ModelDownloadEnvelopeSchema,
  StreamCancelSchema,
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
