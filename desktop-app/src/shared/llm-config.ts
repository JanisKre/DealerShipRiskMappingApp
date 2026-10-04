import type { LlmSettings } from "./types";

/**
 * Stable prefix of the error the main process throws when an AI feature is
 * used before a provider is set up. The renderer matches on it to show the
 * setup prompt instead of a raw error.
 */
export const LLM_NOT_CONFIGURED = "LLM_NOT_CONFIGURED";

/**
 * OpenAI-compatible local runtimes offered as presets for the `local`
 * provider. All of them serve `/v1/models` and `/v1/chat/completions`.
 */
export const LOCAL_RUNTIMES = {
  ollama: { label: "Ollama", baseUrl: "http://localhost:11434/v1" },
  lmstudio: { label: "LM Studio", baseUrl: "http://localhost:1234/v1" },
  llamacpp: { label: "llama.cpp", baseUrl: "http://localhost:8080/v1" },
} as const;
export type LocalRuntime = keyof typeof LOCAL_RUNTIMES;

/** Base URL used by the `local` provider when none is set (Ollama). */
export const DEFAULT_LOCAL_BASE_URL = LOCAL_RUNTIMES.ollama.baseUrl;

/**
 * Whether a URL points to this computer. The `local` provider is restricted
 * to loopback so "local model" really means the data never leaves the device.
 */
export function isLoopbackUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (!["http:", "https:"].includes(url.protocol)) return false;
  const host = url.hostname;
  return (
    host === "localhost" || host === "[::1]" || /^127(\.\d{1,3}){3}$/.test(host)
  );
}

/**
 * Whether the LLM settings are complete enough to send a request. Mirrors the
 * checks in `llm.service.ts`'s `resolveProvider`:
 *   - a model name is always required,
 *   - the custom provider needs a base URL,
 *   - the local provider falls back to Ollama's default URL and needs no key,
 *   - the official OpenAI/Claude endpoints need an API key; a custom base URL
 *     (local proxy) may work without one.
 */
export function isLlmConfigured(llm: LlmSettings | undefined): boolean {
  if (!llm?.model.trim()) return false;
  const hasBaseUrl = Boolean(llm.baseUrl?.trim());
  if (llm.provider === "local") return true;
  if (llm.provider === "custom") return hasBaseUrl;
  return Boolean(llm.hasApiKey) || hasBaseUrl;
}

/**
 * True for errors that the user fixes in the AI settings: the provider is not
 * set up, or the endpoint rejected the credentials (HTTP 401/403). Not
 * anchored: errors from `ipcRenderer.invoke` arrive wrapped as
 * "Error invoking remote method '…': Error: LLM 401: …".
 */
export function isLlmSetupError(message: string | null | undefined): boolean {
  if (!message) return false;
  return (
    message.includes(LLM_NOT_CONFIGURED) ||
    /\b(LLM|Claude) (401|403)\b/.test(message)
  );
}

// --- Hugging Face → Ollama ---------------------------------------------------

/** `owner/name` of a Hugging Face model repository. */
export const HF_REPO_ID_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;

/** Ollama model reference for a GGUF quantization on Hugging Face. */
export const OLLAMA_HF_MODEL_PATTERN =
  /^hf\.co\/[A-Za-z0-9][A-Za-z0-9_.-]{0,95}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,95}:[A-Za-z0-9_.-]{1,40}$/;

/**
 * Name under which Ollama pulls and serves a Hugging Face GGUF file
 * (`ollama pull hf.co/<owner>/<repo>:<quant>`).
 */
export function ollamaHfModelName(repoId: string, quant: string): string {
  return `hf.co/${repoId}:${quant}`;
}

/**
 * Quantization tag of a single-file GGUF in the repository root, e.g.
 * `Q4_K_M` for `Llama-3.2-3B-Instruct-Q4_K_M.gguf`. Returns null for files
 * Ollama cannot pull by tag: sharded files, files in subfolders, and vision
 * projectors.
 */
export function ggufQuantFromFilename(filename: string): string | null {
  if (filename.includes("/")) return null;
  if (!/\.gguf$/i.test(filename)) return null;
  if (/-\d{5}-of-\d{5}\.gguf$/i.test(filename)) return null;
  if (/mmproj/i.test(filename)) return null;
  const match = /[-_.]((?:I?Q\d[A-Za-z0-9_]*)|BF16|F16|F32)\.gguf$/i.exec(
    filename,
  );
  return match ? match[1].toUpperCase() : null;
}
