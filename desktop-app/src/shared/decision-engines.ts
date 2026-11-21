import { z } from "zod";
import { isLoopbackUrl } from "./llm-config";
import {
  DecisionEngineSchema,
  ThresholdTableSchema,
  type DecisionEngine,
} from "./site-questions";

/**
 * The engines that can answer the site questions on an aerial image
 * (shared/site-questions.ts). Decision endpoints score every option and
 * return probabilities without writing text; the configured AI model is
 * the fallback and answers in words, without probabilities.
 *
 * - openai: OpenAI Decisions API (`POST /v1/decisions`).
 * - google: Gemini Decisions API (`POST /v1beta/decisions`).
 * - systemone: the SystemOne/Jev format (`POST /v1/systemone`) of TypeSafe
 *   Jev, and of self-hosted servers such as SGLang with Clef or laya-serve.
 * - ollama: open-weight decision models in a local Ollama
 *   (`POST /v1/systemone` on this computer).
 * - llm: the AI model configured for the app's other AI features.
 */

export const DECISION_ENGINE_CHOICES = [
  "auto",
  ...DecisionEngineSchema.options,
] as const;
export type DecisionEngineChoice = (typeof DECISION_ENGINE_CHOICES)[number];

export const OPENAI_DECISIONS_DEFAULT_MODEL = "gpt-6-luna";
export const OPENAI_DECISIONS_BASE_URL = "https://api.openai.com/v1";
export const GOOGLE_DECISIONS_DEFAULT_MODEL = "gemini-decision-1";
export const GOOGLE_DECISIONS_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta";
export const SYSTEMONE_DEFAULT_BASE_URL = "https://api.typesafe.ai";
export const SYSTEMONE_DEFAULT_MODEL = "jev-latest";
export const OLLAMA_DEFAULT_ORIGIN = "http://localhost:11434";

/**
 * Open-weight decision models that read images, offered for download into
 * a local Ollama. Sizes as Ollama lists them; check the licence before
 * commercial use.
 */
export const LOCAL_DECISION_MODELS = [
  {
    name: "d1:2b",
    label: "Liquid AI d1 2B",
    sizeGb: 2,
    licence: "LFM Open License v1.0",
    note: "small",
  },
  {
    name: "clef-flash",
    label: "Cloudflare Clef-flash 9B",
    sizeGb: 7,
    licence: "Apache 2.0",
    note: "balanced",
  },
  {
    name: "clef",
    label: "Cloudflare Clef 27B",
    sizeGb: 19,
    licence: "Apache 2.0",
    note: "large",
  },
] as const;
export type LocalDecisionModel = (typeof LOCAL_DECISION_MODELS)[number];

/** Only these library names may be pulled; anything else is refused. */
export function isLocalDecisionModel(name: string): boolean {
  return LOCAL_DECISION_MODELS.some((m) => m.name === name);
}

/** A model name as the endpoints take it. */
const ModelName = z
  .string()
  .trim()
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/, "Invalid model name");

export const DecisionSettingsSchema = z.object({
  /** "auto" follows the AI provider set up for the app. */
  engine: z.enum(DECISION_ENGINE_CHOICES).default("auto"),
  openaiModel: ModelName.optional(),
  googleModel: ModelName.optional(),
  systemoneBaseUrl: z.string().max(500).optional(),
  systemoneModel: ModelName.optional(),
  /** Model in the local Ollama, e.g. "d1:2b". */
  ollamaModel: ModelName.optional(),
  /** Ollama address; this computer only. */
  ollamaBaseUrl: z.string().max(500).optional(),
  /** Measured thresholds per engine and model (site-questions.ts). */
  thresholds: ThresholdTableSchema.optional(),
  /** Filled by the main process: whether a key is stored. */
  hasGoogleKey: z.boolean().optional(),
  hasSystemoneKey: z.boolean().optional(),
});
export type DecisionSettings = z.infer<typeof DecisionSettingsSchema>;

export type EndpointCheck =
  | { ok: true; url: string }
  | { ok: false; problem: "invalid" | "scheme" | "credentials" | "insecure" };

/**
 * A SystemOne server: HTTPS, or HTTP on this computer (a self-hosted model
 * such as SGLang or laya-serve). No credentials in the address.
 */
export function validateDecisionEndpoint(raw: string): EndpointCheck {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, problem: "invalid" };
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    return { ok: false, problem: "scheme" };
  }
  if (url.username || url.password)
    return { ok: false, problem: "credentials" };
  if (url.protocol === "http:" && !isLoopbackUrl(url.toString())) {
    return { ok: false, problem: "insecure" };
  }
  url.hash = "";
  url.search = "";
  return { ok: true, url: url.toString().replace(/\/+$/, "") };
}

/** Ollama: this computer only, so "local model" means the image stays here. */
export function validateOllamaOrigin(raw: string): EndpointCheck {
  const check = validateDecisionEndpoint(raw);
  if (!check.ok) return check;
  if (!isLoopbackUrl(check.url)) return { ok: false, problem: "insecure" };
  return { ok: true, url: new URL(check.url).origin };
}

export interface EngineContext {
  decisions: DecisionSettings | undefined;
  llmProvider: "openai" | "claude" | "custom" | "local" | null;
  hasOpenAiKey: boolean;
}

/**
 * The engine "auto" stands for: the decision endpoint of the provider the
 * app already uses, else the configured AI model. A local setup stays
 * local: Ollama with a decision model, else the local AI model.
 */
export function resolveEngine(ctx: EngineContext): DecisionEngine | null {
  const choice = ctx.decisions?.engine ?? "auto";
  if (choice !== "auto") return choice;
  if (ctx.llmProvider === "local") {
    return ctx.decisions?.ollamaModel ? "ollama" : "llm";
  }
  if (ctx.llmProvider === "openai" && ctx.hasOpenAiKey) return "openai";
  if (ctx.llmProvider) return "llm";
  if (ctx.decisions?.ollamaModel) return "ollama";
  return null;
}

/** Whether the engine sends the image to another computer. */
export function isLocalEngine(
  engine: DecisionEngine,
  ctx: { llmProvider: EngineContext["llmProvider"]; systemoneBaseUrl?: string },
): boolean {
  if (engine === "ollama") return true;
  if (engine === "llm") return ctx.llmProvider === "local";
  if (engine === "systemone") {
    return ctx.systemoneBaseUrl != null && isLoopbackUrl(ctx.systemoneBaseUrl);
  }
  return false;
}

/** Whether the engine returns probabilities. */
export function engineScores(engine: DecisionEngine): boolean {
  return engine !== "llm";
}
