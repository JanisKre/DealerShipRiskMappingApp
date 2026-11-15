import { AsyncLocalStorage } from "node:async_hooks";
import {
  clipForLog,
  endpointHostOf,
  requestForLog,
  type AiLogDetail,
} from "@shared/ai-log";
import { isLoopbackUrl } from "@shared/llm-config";

/**
 * Records every request to an AI provider in the local record book
 * (shared/ai-log.ts). The sink is injected at start-up (main/index.ts), so
 * this module has no database import and the LLM client stays testable.
 * Recording never fails a request: a sink error is only logged.
 */

export type AiLogSink = (entry: Omit<AiLogDetail, "id">) => void;

let sink: AiLogSink | null = null;
let enabled: () => boolean = () => true;

/** Wires the record book; `isEnabled` reads the user's setting per call. */
export function configureAiLog(
  nextSink: AiLogSink | null,
  isEnabled: () => boolean = () => true,
): void {
  sink = nextSink;
  enabled = isEnabled;
}

const featureContext = new AsyncLocalStorage<string>();

/** Runs `fn` with `feature` as the origin of the AI calls made inside it. */
export function withAiFeature<T>(feature: string, fn: () => T): T {
  return featureContext.run(feature, fn);
}

export function currentAiFeature(): string {
  return featureContext.getStore() ?? "other";
}

export interface AiCallRecord {
  provider: string;
  model: string;
  baseUrl: string;
  messages: ReadonlyArray<{ role: string; content: string }>;
  imageCount?: number;
  startedAt: number;
  response?: string;
  error?: unknown;
  aborted?: boolean;
}

export function recordAiCall(call: AiCallRecord): void {
  if (!sink) return;
  try {
    if (!enabled()) return;
    const response = call.response ?? "";
    const requestChars = call.messages.reduce(
      (sum, m) => sum + m.content.length,
      0,
    );
    const errorText =
      call.error == null
        ? undefined
        : (call.error instanceof Error
            ? call.error.message
            : String(call.error)
          ).slice(0, 500);
    sink({
      at: new Date(call.startedAt).toISOString(),
      feature: currentAiFeature().slice(0, 80),
      provider: call.provider,
      model: call.model.slice(0, 200),
      endpointHost: endpointHostOf(call.baseUrl),
      local: isLoopbackUrl(call.baseUrl),
      status: call.aborted ? "aborted" : call.error == null ? "ok" : "error",
      durationMs: Math.max(0, Date.now() - call.startedAt),
      requestChars,
      responseChars: response.length,
      imageCount: call.imageCount ?? 0,
      ...(errorText ? { error: errorText } : {}),
      request: requestForLog(call.messages, call.imageCount ?? 0),
      response: clipForLog(response),
    });
  } catch (error) {
    console.warn("Writing the AI record book failed:", error);
  }
}
