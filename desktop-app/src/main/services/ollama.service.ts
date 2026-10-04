import {
  DEFAULT_LOCAL_BASE_URL,
  isLoopbackUrl,
  OLLAMA_HF_MODEL_PATTERN,
} from "@shared/llm-config";
import type { OllamaPullChunk } from "@shared/ipc-schema";
import { fetchWithResilience } from "./http.service";
import { getSettings } from "./settings.service";

/**
 * Installs a Hugging Face GGUF model into a local Ollama via its pull API
 * (`POST /api/pull`), which downloads straight from Hugging Face. The app
 * itself never stores the model file.
 */

/** Minimum interval between progress chunks sent to the renderer. */
const PROGRESS_INTERVAL_MS = 200;

export class OllamaUnreachableError extends Error {
  constructor(origin: string) {
    super(`Ollama is not reachable at ${origin}`);
    this.name = "OllamaUnreachableError";
  }
}

/**
 * Ollama's native API root. Follows the local provider's base URL (minus the
 * OpenAI-compatible `/v1` path), otherwise Ollama's default port. Loopback
 * only: a pull must never be sent to another machine.
 */
export function ollamaOrigin(): string {
  const llm = getSettings().llm;
  const baseUrl =
    llm?.provider === "local" && llm.baseUrl?.trim()
      ? llm.baseUrl.trim()
      : DEFAULT_LOCAL_BASE_URL;
  if (!isLoopbackUrl(baseUrl)) {
    throw new Error("Ollama URL must point to this computer (localhost)");
  }
  return new URL(baseUrl).origin;
}

/** Pulls `model` and reports progress; resolves when Ollama reports success. */
export async function pullOllamaModel(
  model: string,
  onChunk: (chunk: OllamaPullChunk) => void,
  signal: AbortSignal,
): Promise<void> {
  if (!OLLAMA_HF_MODEL_PATTERN.test(model)) {
    throw new Error("Invalid model reference");
  }
  const origin = ollamaOrigin();
  let res: Response;
  try {
    res = await fetchWithResilience(
      `${origin}/api/pull`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, stream: true }),
        signal,
      },
      { retries: 0, timeoutMs: 30_000 },
    );
  } catch (error) {
    if (signal.aborted) throw error;
    throw new OllamaUnreachableError(origin);
  }
  if (!res.ok || !res.body) {
    throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  }

  let lastSent = 0;
  let lastStatus = "";
  for await (const line of ndjsonLines(res.body, signal)) {
    const event = parsePullEvent(line);
    if (!event) continue;
    if (event.error) throw new Error(event.error);
    if (event.status === "success") {
      onChunk({ type: "done", model });
      return;
    }
    const now = Date.now();
    if (event.status !== lastStatus || now - lastSent >= PROGRESS_INTERVAL_MS) {
      lastStatus = event.status;
      lastSent = now;
      onChunk({
        type: "progress",
        status: event.status,
        completedBytes: event.completed ?? null,
        totalBytes: event.total ?? null,
      });
    }
  }
  if (signal.aborted) return;
  throw new Error("Ollama ended the download without reporting success");
}

interface PullEvent {
  status: string;
  completed?: number;
  total?: number;
  error?: string;
}

/** One NDJSON line of `/api/pull`; null for lines that are not JSON objects. */
export function parsePullEvent(line: string): PullEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const num = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
  return {
    status: typeof obj.status === "string" ? obj.status : "",
    completed: num(obj.completed),
    total: num(obj.total),
    error: typeof obj.error === "string" ? obj.error : undefined,
  };
}

async function* ndjsonLines(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  // The HTTP layer only links the caller's signal until the headers arrive;
  // cancel the body explicitly so an abort also closes the connection.
  const onAbort = (): void => void reader.cancel().catch(() => undefined);
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) yield line;
    }
    if (buffer.trim()) yield buffer;
  } finally {
    signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}
