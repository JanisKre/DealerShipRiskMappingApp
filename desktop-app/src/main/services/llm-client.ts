import type { ChatMessage, LlmProvider } from "@shared/types";
import {
  DEFAULT_LOCAL_BASE_URL,
  LLM_NOT_CONFIGURED,
  isLoopbackUrl,
} from "@shared/llm-config";
import { getLlmApiKey, getSettings } from "./settings.service";
import { fetchWithResilience } from "./http.service";
import { recordAiCall } from "./ai-log.service";

/** Provider-agnostic LLM client: provider resolution, token limits, full and streamed completions for OpenAI-compatible endpoints and Claude. API keys come from safeStorage; every request is written to the AI record book. */

/** Human-readable name of the active UI language, for prompt instructions. */
export function responseLanguageName(): string {
  const names: Record<string, string> = {
    en: "English",
    de: "German",
    fr: "French",
  };
  return names[getSettings().language ?? "en"] ?? "English";
}

// --- Provider resolution ---------------------------------------------------

interface ResolvedProvider {
  provider: LlmProvider;
  model: string;
  baseUrl: string;
  apiKey?: string;
  /** Time until response headers arrive (covers loading a local model). */
  timeoutMs?: number;
}

/**
 * A local runtime loads the model into memory on the first request, which
 * can take far longer than the default HTTP timeout.
 */
const LOCAL_TIMEOUT_MS = 180_000;

/**
 * Time until the response headers of a cloud request. A non-streamed answer
 * sends its headers only once it is complete, so the general 15 s HTTP
 * timeout cut off memos, JSON agents and image checks of larger models.
 */
const CLOUD_TIMEOUT_MS = 120_000;

/** Error text when the answer stopped at the token limit before any text. */
export const LLM_TRUNCATED = "AI answer stopped at the token limit";

/**
 * Room for a model that reasons before it answers. Current Claude and OpenAI
 * models think by default and the provider counts that thinking against the
 * limit of the answer, so a limit sized for the visible answer alone (16
 * tokens for one word, 400 for a small JSON object) is spent before the
 * first character. Measured on claude-opus-5-5: the one-word routing answer
 * failed at 16 tokens and the memo was cut off at 1200.
 */
export const REASONING_HEADROOM_TOKENS = 4096;

/**
 * Extra room for the one repeat of a request whose answer the limit cut
 * although the model had reasoned (or had written nothing at all).
 */
export const REASONING_RETRY_TOKENS = 12_288;

/**
 * Providers whose current models reason by default. Other OpenAI-compatible
 * servers (custom, local) keep the exact limit and get the room only when
 * an answer shows that the model reasoned.
 */
function reasonsByDefault(p: ResolvedProvider): boolean {
  return (
    p.provider === "claude" ||
    (p.provider === "openai" &&
      new URL(p.baseUrl).hostname === "api.openai.com")
  );
}

/** The limit sent to the provider for an answer the caller caps at `maxTokens`. */
function providerTokenLimit(
  p: ResolvedProvider,
  maxTokens: number,
  attempt: number,
): number {
  return (
    maxTokens +
    (reasonsByDefault(p) ? REASONING_HEADROOM_TOKENS : 0) +
    (attempt > 0 ? REASONING_RETRY_TOKENS : 0)
  );
}

/**
 * OpenAI's own API takes `max_completion_tokens`; its reasoning models
 * reject `max_tokens`. OpenAI-compatible servers (custom, local) still take
 * `max_tokens`.
 */
function openAiTokenLimit(
  p: ResolvedProvider,
  maxTokens: number,
): Record<string, number> {
  const official =
    p.provider === "openai" && new URL(p.baseUrl).hostname === "api.openai.com";
  return official
    ? { max_completion_tokens: maxTokens }
    : { max_tokens: maxTokens };
}

/** One provider answer and how it ended. */
interface Completion {
  text: string;
  /** The provider stopped at the token limit. */
  truncated: boolean;
  /** The model reasoned before (or instead of) answering. */
  reasoned: boolean;
}

/**
 * A cut-off answer is asked for once more with more room when the limit was
 * (or may have been) spent on reasoning: nothing was written, or the answer
 * shows reasoning. A model that simply writes past the limit is not asked
 * again; its cut-off text is passed on.
 */
function cutByReasoning(completion: Completion): boolean {
  return (
    completion.truncated &&
    (completion.reasoned || completion.text.trim() === "")
  );
}

/**
 * An answer that ended at the token limit: empty is an error (nothing to
 * show or parse), cut-off text is passed on with a warning; JSON callers
 * reject it and ask once more.
 */
function checkCompletion(
  text: string,
  truncated: boolean,
  maxTokens: number,
): string {
  if (!truncated) return text;
  if (text.trim() === "") throw new Error(`${LLM_TRUNCATED} (${maxTokens})`);
  console.warn(`AI answer cut off at the token limit (${maxTokens})`);
  return text;
}

function normalizeBaseUrl(rawUrl: string, label: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${label} must be a valid HTTP(S) URL`);
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`${label} must use HTTP or HTTPS`);
  }
  if (url.username || url.password) {
    throw new Error(`${label} must not contain embedded credentials`);
  }
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

/**
 * Resolves endpoint, key and model from the saved settings. `requireModel:
 * false` is for listing the available models before one is chosen.
 */
export function resolveProvider({
  requireModel = true,
} = {}): ResolvedProvider {
  const settings = getSettings();
  const llm = settings.llm;
  const provider: LlmProvider = llm?.provider ?? "openai";
  const model = llm?.model.trim() ?? "";
  // Strip trailing slash so `${baseUrl}/v1/messages` composes cleanly.
  const baseUrlSetting = llm?.baseUrl?.trim();
  if (requireModel && !model) {
    throw new Error(`${LLM_NOT_CONFIGURED}: no model configured`);
  }

  if (provider === "local") {
    // No API key: a local runtime needs none, and a stored cloud key must
    // not be sent to whatever listens on a local port.
    const baseUrl = normalizeBaseUrl(
      baseUrlSetting || DEFAULT_LOCAL_BASE_URL,
      "Local model base URL",
    );
    if (!isLoopbackUrl(baseUrl)) {
      throw new Error(
        "Local model base URL must point to this computer (localhost)",
      );
    }
    return { provider, model, baseUrl, timeoutMs: LOCAL_TIMEOUT_MS };
  }

  // API key is optional for a custom base URL (local proxies may not require
  // auth); the official endpoints always need one. Fail before the request so
  // the renderer can route the user to the AI settings instead of showing 401.
  const apiKey = getLlmApiKey(provider) ?? undefined;
  if (provider !== "custom" && !baseUrlSetting && !apiKey) {
    throw new Error(`${LLM_NOT_CONFIGURED}: no API key configured`);
  }

  if (provider === "claude") {
    return {
      provider,
      model,
      baseUrl: normalizeBaseUrl(
        baseUrlSetting || "https://api.anthropic.com",
        "Claude base URL",
      ),
      apiKey,
    };
  }
  if (provider === "custom") {
    if (!baseUrlSetting)
      throw new Error(
        `${LLM_NOT_CONFIGURED}: no base URL configured for the custom provider`,
      );
    return {
      provider,
      model,
      baseUrl: normalizeBaseUrl(baseUrlSetting, "Custom provider base URL"),
      apiKey,
    };
  }
  // openai (and all OpenAI-compatible defaults)
  return {
    provider,
    model,
    baseUrl: normalizeBaseUrl(
      baseUrlSetting || "https://api.openai.com/v1",
      "OpenAI base URL",
    ),
    apiKey,
  };
}

// --- Full response (non-streaming) -----------------------------------------

export async function chatComplete(
  messages: ChatMessage[],
  maxTokens = 2048,
  /** Images for the last user message (vision models only). */
  images: readonly LlmImage[] = [],
): Promise<string> {
  const p = resolveProvider();
  const startedAt = Date.now();
  const logged = {
    provider: p.provider,
    model: p.model,
    baseUrl: p.baseUrl,
    messages,
    imageCount: images.length,
    startedAt,
  };
  try {
    let completion = await completeWith(
      p,
      messages,
      providerTokenLimit(p, maxTokens, 0),
      images,
    );
    if (cutByReasoning(completion)) {
      // Each request to the provider gets its own line in the record book.
      recordAiCall({
        ...logged,
        response: completion.text,
        error: new Error(`${LLM_TRUNCATED} (${maxTokens}); asked again`),
      });
      logged.startedAt = Date.now();
      completion = await completeWith(
        p,
        messages,
        providerTokenLimit(p, maxTokens, 1),
        images,
      );
    }
    const response = checkCompletion(
      completion.text,
      completion.truncated,
      maxTokens,
    );
    recordAiCall({ ...logged, response });
    return response;
  } catch (error) {
    recordAiCall({ ...logged, error });
    throw error;
  }
}

/** An image sent along with a prompt; never stored in the record book. */
export interface LlmImage {
  mediaType: "image/jpeg" | "image/png";
  base64: string;
}

function completeWith(
  p: ResolvedProvider,
  messages: ChatMessage[],
  maxTokens: number,
  images: readonly LlmImage[],
): Promise<Completion> {
  switch (p.provider) {
    case "openai":
    case "custom":
    case "local":
      return openAiComplete(p, messages, maxTokens, images);
    case "claude":
      return claudeComplete(p, messages, maxTokens, images);
    default:
      throw new Error(`Unknown provider: ${p.provider}`);
  }
}

/** Index of the message the images belong to: the last user message. */
function imageMessageIndex(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return i;
  }
  return -1;
}

async function openAiComplete(
  p: ResolvedProvider,
  messages: ChatMessage[],
  maxTokens: number,
  images: readonly LlmImage[] = [],
): Promise<Completion> {
  const imageAt = images.length > 0 ? imageMessageIndex(messages) : -1;
  const body = messages.map((m, i) =>
    i === imageAt
      ? {
          role: m.role,
          content: [
            { type: "text", text: m.content },
            ...images.map((image) => ({
              type: "image_url",
              image_url: {
                url: `data:${image.mediaType};base64,${image.base64}`,
              },
            })),
          ],
        }
      : m,
  );
  const res = await fetchWithResilience(
    `${p.baseUrl}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: p.model,
        messages: body,
        ...openAiTokenLimit(p, maxTokens),
      }),
    },
    { timeoutMs: p.timeoutMs ?? CLOUD_TIMEOUT_MS },
  );
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
        // Ollama and vLLM / DeepSeek name the reasoning text differently.
        reasoning?: string;
        reasoning_content?: string;
      };
      finish_reason?: string;
    }>;
    usage?: { completion_tokens_details?: { reasoning_tokens?: number } };
  };
  const choice = data.choices?.[0];
  return {
    text: choice?.message?.content ?? "",
    truncated: choice?.finish_reason === "length",
    reasoned:
      (data.usage?.completion_tokens_details?.reasoning_tokens ?? 0) > 0 ||
      Boolean(choice?.message?.reasoning || choice?.message?.reasoning_content),
  };
}

async function claudeComplete(
  p: ResolvedProvider,
  messages: ChatMessage[],
  maxTokens: number,
  images: readonly LlmImage[] = [],
): Promise<Completion> {
  const system = messages.find((m) => m.role === "system")?.content;
  const imageAt = images.length > 0 ? imageMessageIndex(messages) : -1;
  const rest = messages.flatMap((m, i): unknown[] => {
    if (m.role === "system") return [];
    if (i !== imageAt) return [m];
    return [
      {
        role: m.role,
        content: [
          ...images.map((image) => ({
            type: "image",
            source: {
              type: "base64",
              media_type: image.mediaType,
              data: image.base64,
            },
          })),
          { type: "text", text: m.content },
        ],
      },
    ];
  });
  const res = await fetchWithResilience(
    `${p.baseUrl}/v1/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(p.apiKey ? { "x-api-key": p.apiKey } : {}),
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: p.model,
        max_tokens: maxTokens,
        system,
        messages: rest,
      }),
    },
    { timeoutMs: p.timeoutMs ?? CLOUD_TIMEOUT_MS },
  );
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>;
    stop_reason?: string;
  };
  if (data.stop_reason === "refusal") throw new Error(CLAUDE_DECLINED);
  const text =
    data.content
      ?.filter((c) => c.type == null || c.type === "text")
      .map((c) => c.text ?? "")
      .join("") ?? "";
  return {
    text,
    truncated: data.stop_reason === "max_tokens",
    reasoned: Boolean(
      data.content?.some(
        (c) => c.type === "thinking" || c.type === "redacted_thinking",
      ),
    ),
  };
}

/** Claude's safety classifiers ended the answer (`stop_reason: "refusal"`). */
const CLAUDE_DECLINED = "Claude declined to answer this request";

// --- Streaming --------------------------------------------------------------

/**
 * Token stream over SSE. For Claude, the Anthropic `stream: true` protocol is
 * parsed; for OpenAI/custom, the OpenAI `chat/completions` protocol. `signal`
 * aborts it.
 */
export async function* chatCompleteStream(
  messages: ChatMessage[],
  signal?: AbortSignal,
  /** Hard cap on the answer; omitted, the provider default applies. */
  maxTokens?: number,
): AsyncGenerator<string, void, unknown> {
  const p = resolveProvider();
  const startedAt = Date.now();
  let response = "";
  let error: unknown;
  let finished = false;
  let inner: AsyncGenerator<string, StreamEnd, unknown> | undefined;
  try {
    for (let attempt = 0; ; attempt++) {
      // Claude needs a limit; without one its stream gets the default.
      const limit =
        maxTokens ?? (p.provider === "claude" ? CLAUDE_STREAM_TOKENS : null);
      const sent =
        limit == null ? undefined : providerTokenLimit(p, limit, attempt);
      inner =
        p.provider === "claude"
          ? claudeStream(p, messages, signal, sent ?? CLAUDE_STREAM_TOKENS)
          : openAiStream(p, messages, signal, sent);
      let end: StreamEnd;
      for (;;) {
        const step = await inner.next();
        if (step.done) {
          end = step.value;
          break;
        }
        response += step.value;
        yield step.value;
      }
      inner = undefined;
      // Cut before the first character: the limit went into reasoning. Ask
      // once more with more room; text already shown is never replaced.
      if (!end.truncated || response !== "") break;
      if (attempt > 0 || limit == null) {
        throw new Error(`${LLM_TRUNCATED} (${limit ?? "provider default"})`);
      }
      recordAiCall({
        provider: p.provider,
        model: p.model,
        baseUrl: p.baseUrl,
        messages,
        startedAt,
        error: new Error(`${LLM_TRUNCATED} (${limit}); asked again`),
      });
    }
    finished = true;
  } catch (err) {
    error = err;
    throw err;
  } finally {
    // The consumer stopped reading: close the provider connection too.
    await inner?.return({ truncated: false }).catch(() => undefined);
    // Not finished and no error: the consumer stopped reading (cancel).
    recordAiCall({
      provider: p.provider,
      model: p.model,
      baseUrl: p.baseUrl,
      messages,
      startedAt,
      response,
      error,
      aborted: Boolean(signal?.aborted) || (!finished && error == null),
    });
  }
}

/** How a provider stream ended. */
interface StreamEnd {
  /** The provider stopped at the token limit. */
  truncated: boolean;
}

/** Limit of a Claude stream whose caller sets none. */
const CLAUDE_STREAM_TOKENS = 2048;

async function* openAiStream(
  p: ResolvedProvider,
  messages: ChatMessage[],
  signal?: AbortSignal,
  maxTokens?: number,
): AsyncGenerator<string, StreamEnd, unknown> {
  const res = await fetchWithResilience(
    `${p.baseUrl}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: p.model,
        messages,
        stream: true,
        ...(maxTokens ? openAiTokenLimit(p, maxTokens) : {}),
      }),
      signal,
    },
    { timeoutMs: p.timeoutMs ?? CLOUD_TIMEOUT_MS },
  );
  if (!res.ok || !res.body)
    throw new Error(`LLM ${res.status}: ${await res.text()}`);
  let truncated = false;
  for await (const data of sseLines(res.body, signal)) {
    if (data === "[DONE]") break;
    const json = parseSseJson<{
      choices?: Array<{
        delta?: { content?: string };
        finish_reason?: string | null;
      }>;
      error?: { message?: string };
    }>(data);
    if (!json) continue;
    // An error mid-stream must end the answer visibly, not as a short reply.
    if (json.error) throw new Error(`LLM: ${json.error.message ?? "error"}`);
    const choice = json.choices?.[0];
    if (choice?.finish_reason === "length") truncated = true;
    if (choice?.delta?.content) yield choice.delta.content;
  }
  return { truncated };
}

async function* claudeStream(
  p: ResolvedProvider,
  messages: ChatMessage[],
  signal?: AbortSignal,
  maxTokens: number = CLAUDE_STREAM_TOKENS,
): AsyncGenerator<string, StreamEnd, unknown> {
  const system = messages.find((m) => m.role === "system")?.content;
  const rest = messages.filter((m) => m.role !== "system");
  const res = await fetchWithResilience(
    `${p.baseUrl}/v1/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(p.apiKey ? { "x-api-key": p.apiKey } : {}),
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: p.model,
        max_tokens: maxTokens,
        system,
        messages: rest,
        stream: true,
      }),
      signal,
    },
    { timeoutMs: p.timeoutMs ?? CLOUD_TIMEOUT_MS },
  );
  if (!res.ok || !res.body)
    throw new Error(`Claude ${res.status}: ${await res.text()}`);
  let truncated = false;
  for await (const data of sseLines(res.body, signal)) {
    const json = parseSseJson<{
      type?: string;
      delta?: { type?: string; text?: string; stop_reason?: string };
      error?: { type?: string; message?: string };
    }>(data);
    if (!json) continue;
    // e.g. `overloaded_error` mid-stream: without this the answer just stops.
    if (json.type === "error") {
      throw new Error(
        `Claude: ${json.error?.message ?? json.error?.type ?? "stream error"}`,
      );
    }
    if (json.type === "message_delta") {
      if (json.delta?.stop_reason === "refusal")
        throw new Error(CLAUDE_DECLINED);
      if (json.delta?.stop_reason === "max_tokens") truncated = true;
    }
    if (json.type === "content_block_delta" && json.delta?.text)
      yield json.delta.text;
  }
  return { truncated };
}

/** One SSE payload as JSON; null for a line that is not (yet) valid JSON. */
function parseSseJson<T>(data: string): T | null {
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

/** Splits an SSE body stream into the payload of the `data:` lines. */
async function* sseLines(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("data:")) {
          yield trimmed.slice(5).trim();
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// --- Setup: connection test + model list ------------------------------------
