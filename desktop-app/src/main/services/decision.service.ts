import { randomUUID } from "node:crypto";
import { z } from "zod";
import { LLM_NOT_CONFIGURED } from "@shared/llm-config";
import {
  GOOGLE_DECISIONS_BASE_URL,
  GOOGLE_DECISIONS_DEFAULT_MODEL,
  LOCAL_DECISION_MODELS,
  OLLAMA_DEFAULT_ORIGIN,
  OPENAI_DECISIONS_BASE_URL,
  OPENAI_DECISIONS_DEFAULT_MODEL,
  SYSTEMONE_DEFAULT_BASE_URL,
  SYSTEMONE_DEFAULT_MODEL,
  resolveEngine,
  validateDecisionEndpoint,
  validateOllamaOrigin,
} from "@shared/decision-engines";
import {
  IMAGE_USABLE_INSTRUCTIONS,
  MODEL_INSTRUCTIONS,
  OPEN_AIR_DESCRIPTIONS,
  OPEN_AIR_LEVELS,
  SITE_QUESTION_IDS,
  cleanProbabilities,
  likelierYesNo,
  modelContext,
  needsBoundary,
  questionKind,
  toRun,
  type DecisionEngine,
  type DecisionRun,
  type EngineAnswer,
  type SiteQuestionId,
} from "@shared/site-questions";
import type { BoundaryResult } from "@shared/types";
import { recordAiCall } from "./ai-log.service";
import { fetchWithResilience } from "./http.service";
import type { LlmImage } from "./llm-client";
import { completeJson } from "./llm-agents.service";
import {
  getDecisionApiKey,
  getLlmApiKey,
  getSettings,
} from "./settings.service";
import { encodeAerialImage, provenance } from "./site-check.service";
import { aerialImageForBoundary } from "./tiles.service";

/**
 * Answers the site questions (shared/site-questions.ts) on the aerial image
 * of a location with the engine chosen in the settings
 * (shared/decision-engines.ts). The image is the one the vehicle detection
 * uses, with the lot outline drawn on it. Every request goes to the AI
 * record book. Nothing here changes the count, the boundary or the EAL.
 */

const REQUEST_TIMEOUT_MS = 60_000;
/** A 27B model on a laptop takes its time. */
const LOCAL_TIMEOUT_MS = 180_000;

/** One question as every engine is asked it. */
export interface EngineQuestion {
  id: SiteQuestionId | "imageUsable";
  kind: "yesNo" | "openAirShare";
  instructions: string;
}

export function questionsFor(outlined: boolean): EngineQuestion[] {
  return [
    {
      id: "imageUsable",
      kind: "yesNo",
      instructions: IMAGE_USABLE_INSTRUCTIONS,
    },
    ...SITE_QUESTION_IDS.filter((id) => outlined || !needsBoundary(id)).map(
      (id) => ({
        id,
        kind: questionKind(id),
        instructions: MODEL_INSTRUCTIONS[id],
      }),
    ),
  ];
}

/** Engine answers keyed by question, with the image check separate. */
export interface EngineResult {
  imageUsable: number | null;
  answers: Partial<Record<SiteQuestionId, EngineAnswer>>;
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : undefined;
}

function collect(
  questions: readonly EngineQuestion[],
  read: (q: EngineQuestion) => EngineAnswer | null,
): EngineResult {
  const result: EngineResult = { imageUsable: null, answers: {} };
  for (const q of questions) {
    const answer = read(q);
    if (!answer) continue;
    if (q.id === "imageUsable") {
      result.imageUsable = answer.probabilities?.yes ?? null;
    } else {
      result.answers[q.id] = answer;
    }
  }
  return result;
}

function yesNoAnswer(p: number | undefined): EngineAnswer | null {
  if (p == null) return null;
  const probabilities = { yes: p, no: 1 - p };
  return { probabilities, value: likelierYesNo(probabilities) };
}

function choiceAnswer(
  q: EngineQuestion,
  choice: unknown,
  probabilities: Record<string, unknown> | undefined,
): EngineAnswer {
  const id = q.id as SiteQuestionId;
  const cleaned = cleanProbabilities(id, probabilities);
  const value =
    typeof choice === "string" &&
    (OPEN_AIR_LEVELS as readonly string[]).includes(choice)
      ? choice
      : "unclear";
  return { ...(cleaned ? { probabilities: cleaned } : {}), value };
}

// --- OpenAI Decisions API -------------------------------------------------

export function openAiRequest(
  model: string,
  image: LlmImage,
  questions: readonly EngineQuestion[],
  outlined: boolean,
): unknown {
  return {
    model,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: modelContext(outlined) },
          {
            type: "input_image",
            image_url: `data:${image.mediaType};base64,${image.base64}`,
            detail: "high",
          },
        ],
      },
    ],
    questions: questions.map((q) =>
      q.kind === "yesNo"
        ? { type: "predicate", name: q.id, instructions: q.instructions }
        : {
            type: "choice",
            name: q.id,
            instructions: q.instructions,
            choices: OPEN_AIR_LEVELS.map((value) => ({
              value,
              description: OPEN_AIR_DESCRIPTIONS[value],
            })),
          },
    ),
  };
}

const OpenAiAnswersSchema = z.object({
  answers: z
    .array(
      z
        .object({
          type: z.string(),
          name: z.string().nullable().optional(),
          probability: z.unknown().optional(),
          choice: z.unknown().optional(),
          probabilities: z
            .array(z.object({ value: z.unknown(), probability: z.unknown() }))
            .optional(),
        })
        .passthrough(),
    )
    .max(100),
});

export function readOpenAiAnswers(
  raw: unknown,
  questions: readonly EngineQuestion[],
): EngineResult {
  const parsed = OpenAiAnswersSchema.parse(raw);
  return collect(questions, (q) => {
    const a = parsed.answers.find((x) => x.name === q.id);
    // A refusal leaves the question unanswered.
    if (!a || a.type === "refusal") return null;
    if (q.kind === "yesNo") return yesNoAnswer(finite(a.probability));
    const probabilities = Object.fromEntries(
      (a.probabilities ?? []).flatMap((p) =>
        typeof p.value === "string" ? [[p.value, p.probability]] : [],
      ),
    );
    return choiceAnswer(q, a.choice, probabilities);
  });
}

// --- Gemini Decisions API -------------------------------------------------

export function googleRequest(
  model: string,
  image: LlmImage,
  questions: readonly EngineQuestion[],
  outlined: boolean,
): unknown {
  return {
    model,
    input: [
      { type: "text", text: modelContext(outlined) },
      { type: "image", data: image.base64, mime_type: image.mediaType },
    ],
    questions: Object.fromEntries(questions.map((q) => [q.id, jevQuestion(q)])),
  };
}

// --- SystemOne / Jev (TypeSafe, Clef, Laya, Ollama) -----------------------

/** A question in the SystemOne format (also Google's). */
function jevQuestion(q: EngineQuestion): unknown {
  return q.kind === "yesNo"
    ? { type: "noul", instructions: q.instructions }
    : {
        type: "choice",
        instructions: q.instructions,
        criteria: Object.fromEntries(
          OPEN_AIR_LEVELS.map((level) => [level, OPEN_AIR_DESCRIPTIONS[level]]),
        ),
      };
}

/**
 * The SystemOne request. TypeSafe and servers that follow it take images as
 * named assets referenced from the state; Ollama takes a plain list.
 */
export function systemOneRequest(
  model: string,
  image: LlmImage,
  questions: readonly EngineQuestion[],
  outlined: boolean,
  imageStyle: "assets" | "images",
  assetId: string = randomUUID(),
): unknown {
  const questionMap = Object.fromEntries(
    questions.map((q) => [q.id, jevQuestion(q)]),
  );
  if (imageStyle === "images") {
    return {
      model,
      state: modelContext(outlined),
      images: [image.base64],
      questions: questionMap,
    };
  }
  return {
    model,
    state: { description: modelContext(outlined), image: assetId },
    assets: {
      [assetId]: {
        type: "image",
        format: image.mediaType === "image/png" ? "png" : "jpg",
        data_base64: image.base64,
      },
    },
    questions: questionMap,
  };
}

const JevAnswersSchema = z.object({
  answers: z.record(
    z.string(),
    z
      .object({
        type: z.string().optional(),
        noul: z.unknown().optional(),
        choice: z.unknown().optional(),
        probabilities: z.record(z.string(), z.unknown()).optional(),
      })
      .passthrough(),
  ),
});

/** Answers in the SystemOne shape (TypeSafe, Ollama, Clef, Google). */
export function readJevAnswers(
  raw: unknown,
  questions: readonly EngineQuestion[],
): EngineResult {
  const parsed = JevAnswersSchema.parse(raw);
  return collect(questions, (q) => {
    const a = parsed.answers[q.id];
    if (!a || a.type === "refusal") return null;
    if (q.kind === "yesNo") return yesNoAnswer(finite(a.noul));
    return choiceAnswer(q, a.choice, a.probabilities);
  });
}

// --- The configured AI model (fallback, no probabilities) -----------------

const LlmAnswerSchema = z.record(z.string(), z.string().max(40));

export function llmSystemPrompt(questions: readonly EngineQuestion[]): string {
  const lines = questions.map((q) =>
    q.kind === "yesNo"
      ? `- ${q.id}: ${q.instructions} Answer "yes", "no" or "unclear".`
      : `- ${q.id}: ${q.instructions} Answer "few", "aboutHalf", "most" or "unclear".`,
  );
  const example = Object.fromEntries(questions.map((q) => [q.id, "unclear"]));
  return `You look at one aerial image for a hail-risk screening tool and answer fixed questions about what is visible.
${lines.join("\n")}
Prefer "unclear" to a guess. Reply with exactly one JSON object and nothing else: ${JSON.stringify(example)}`;
}

export function readLlmAnswers(
  raw: Record<string, string>,
  questions: readonly EngineQuestion[],
): EngineResult {
  const result = collect(questions, (q) => {
    const value = raw[q.id]?.trim();
    if (!value) return null;
    return { value };
  });
  // Without probabilities the image check is a plain no.
  const usable = raw.imageUsable?.trim().toLowerCase();
  result.imageUsable = usable === "no" ? 0 : null;
  return result;
}

// --- Running an engine -------------------------------------------------------

export interface EngineTarget {
  engine: DecisionEngine;
  model: string;
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
}

/** Endpoint, key and model of an engine; throws when it is not set up. */
export function engineTarget(engine: DecisionEngine): EngineTarget {
  const settings = getSettings();
  const decisions = settings.decisions;
  const json = { "Content-Type": "application/json" };
  switch (engine) {
    case "openai": {
      const key = getLlmApiKey("openai");
      if (!key) {
        throw new Error(
          `${LLM_NOT_CONFIGURED}: no OpenAI API key for the Decisions API`,
        );
      }
      // A proxy set for OpenAI in the AI settings is used here too.
      const base =
        settings.llm?.provider === "openai" && settings.llm.baseUrl?.trim()
          ? settings.llm.baseUrl.trim().replace(/\/+$/, "")
          : OPENAI_DECISIONS_BASE_URL;
      return {
        engine,
        model: decisions?.openaiModel || OPENAI_DECISIONS_DEFAULT_MODEL,
        url: `${base}/decisions`,
        headers: { ...json, Authorization: `Bearer ${key}` },
        timeoutMs: REQUEST_TIMEOUT_MS,
      };
    }
    case "google": {
      const key = getDecisionApiKey("google");
      if (!key) {
        throw new Error(
          `${LLM_NOT_CONFIGURED}: no Google API key for the Decisions API`,
        );
      }
      return {
        engine,
        model: decisions?.googleModel || GOOGLE_DECISIONS_DEFAULT_MODEL,
        url: `${GOOGLE_DECISIONS_BASE_URL}/decisions`,
        headers: { ...json, "x-goog-api-key": key },
        timeoutMs: REQUEST_TIMEOUT_MS,
      };
    }
    case "systemone": {
      const check = validateDecisionEndpoint(
        decisions?.systemoneBaseUrl || SYSTEMONE_DEFAULT_BASE_URL,
      );
      if (!check.ok)
        throw new Error(`Invalid decision server (${check.problem})`);
      const key = getDecisionApiKey("systemone");
      const hosted = check.url === SYSTEMONE_DEFAULT_BASE_URL;
      if (hosted && !key) {
        throw new Error(`${LLM_NOT_CONFIGURED}: no TypeSafe API key`);
      }
      return {
        engine,
        model: decisions?.systemoneModel || SYSTEMONE_DEFAULT_MODEL,
        url: `${check.url}/v1/systemone`,
        headers: {
          ...json,
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
          // TypeSafe takes images only with this header.
          "TypeSafe-Danger-Zone-Images": "true",
        },
        timeoutMs: hosted ? REQUEST_TIMEOUT_MS : LOCAL_TIMEOUT_MS,
      };
    }
    case "ollama": {
      const check = validateOllamaOrigin(
        decisions?.ollamaBaseUrl || OLLAMA_DEFAULT_ORIGIN,
      );
      if (!check.ok) {
        throw new Error("Ollama address must point to this computer");
      }
      const model = decisions?.ollamaModel?.trim();
      if (!model) {
        throw new Error(
          `${LLM_NOT_CONFIGURED}: no local decision model chosen`,
        );
      }
      // No key: a cloud key must never reach a local port.
      return {
        engine,
        model,
        url: `${check.url}/v1/systemone`,
        headers: json,
        timeoutMs: LOCAL_TIMEOUT_MS,
      };
    }
    case "llm":
      return {
        engine,
        model: settings.llm?.model ?? "",
        url: "",
        headers: {},
        timeoutMs: REQUEST_TIMEOUT_MS,
      };
  }
}

/** The engine the settings stand for; throws when none is set up. */
export function currentEngine(): DecisionEngine {
  const settings = getSettings();
  const engine = resolveEngine({
    decisions: settings.decisions,
    llmProvider: settings.llm?.model.trim() ? settings.llm.provider : null,
    hasOpenAiKey: getLlmApiKey("openai") != null,
  });
  if (!engine) {
    throw new Error(`${LLM_NOT_CONFIGURED}: no engine for the site questions`);
  }
  return engine;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function postDecision(
  target: EngineTarget,
  body: unknown,
  questionsText: string,
  imageCount: number,
): Promise<unknown> {
  const startedAt = Date.now();
  const logged = {
    provider: `decisions:${target.engine}`,
    model: target.model,
    baseUrl: target.url,
    messages: [{ role: "user", content: questionsText }],
    imageCount,
    startedAt,
  };
  try {
    const res = await fetchWithResilience(
      target.url,
      { method: "POST", headers: target.headers, body: JSON.stringify(body) },
      {
        retries: 1,
        retryStatuses: [429, 529, 503],
        timeoutMs: target.timeoutMs,
      },
    );
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Decisions ${res.status}: ${text.slice(0, 300)}`);
    }
    recordAiCall({ ...logged, response: text });
    return JSON.parse(text) as unknown;
  } catch (error) {
    recordAiCall({ ...logged, error });
    throw error;
  }
}

/** Runs one engine on one image. Exported for the tests. */
export async function runEngine(
  engine: DecisionEngine,
  image: LlmImage,
  outlined: boolean,
): Promise<{ model: string; result: EngineResult }> {
  const questions = questionsFor(outlined);
  const target = engineTarget(engine);
  const questionsText = questions
    .map((q) => `${q.id}: ${q.instructions}`)
    .join("\n");
  if (engine === "llm") {
    const raw = await completeJson(
      [
        { role: "system", content: llmSystemPrompt(questions) },
        { role: "user", content: "Aerial image of the lot." },
      ],
      LlmAnswerSchema,
      600,
      [image],
    );
    return { model: target.model, result: readLlmAnswers(raw, questions) };
  }
  const body =
    engine === "openai"
      ? openAiRequest(target.model, image, questions, outlined)
      : engine === "google"
        ? googleRequest(target.model, image, questions, outlined)
        : systemOneRequest(
            target.model,
            image,
            questions,
            outlined,
            engine === "ollama" ? "images" : "assets",
          );
  const raw = await postDecision(target, body, questionsText, 1);
  try {
    return {
      model: target.model,
      result:
        engine === "openai"
          ? readOpenAiAnswers(raw, questions)
          : readJevAnswers(raw, questions),
    };
  } catch (error) {
    throw new Error(
      `The decision engine answered in an unexpected form: ${errorText(error).slice(0, 200)}`,
      { cause: error },
    );
  }
}

const NO_IMAGE = "No aerial image is available for this location.";

/**
 * Answers the site questions for one location. `engine` overrides the
 * setting (used when the user compares engines).
 */
export async function answerSiteQuestions(
  lat: number,
  lon: number,
  boundary: BoundaryResult | undefined,
  engine: DecisionEngine = currentEngine(),
): Promise<DecisionRun> {
  const capture = await aerialImageForBoundary(lat, lon, boundary);
  const image = await encodeAerialImage(capture, boundary);
  if (!image) throw new Error(NO_IMAGE);
  const { model, result } = await runEngine(engine, image, boundary != null);
  const { imageCapturedAt, imageLabel } = provenance(capture);
  return toRun({
    engine,
    model,
    imageCapturedAt,
    imageLabel,
    imageUsable: result.imageUsable,
    answers: result.answers,
  });
}

export interface DecisionEngineTest {
  ok: boolean;
  engine: DecisionEngine;
  model: string;
  /** Probability the engine gave for an obvious "yes"; null without one. */
  probability: number | null;
  error?: string;
}

/**
 * Asks the engine one question with an obvious answer, without an image,
 * so the settings can show whether address, key and model work.
 */
export async function testDecisionEngine(
  engine: DecisionEngine = currentEngine(),
): Promise<DecisionEngineTest> {
  let model = "";
  try {
    const target = engineTarget(engine);
    model = target.model;
    if (engine === "llm") {
      return { ok: true, engine, model, probability: null };
    }
    const text = "A connection test from a hail-risk screening tool.";
    const instructions = "Is this text a connection test?";
    const body =
      engine === "openai"
        ? {
            model,
            input: text,
            questions: [{ type: "predicate", name: "test", instructions }],
          }
        : engine === "google"
          ? {
              model,
              input: text,
              questions: { test: { type: "noul", instructions } },
            }
          : {
              model,
              state: text,
              questions: { test: { type: "noul", instructions } },
            };
    const raw = await postDecision(target, body, `test: ${instructions}`, 0);
    const q: EngineQuestion[] = [
      { id: "hailNet", kind: "yesNo", instructions },
    ];
    // Read as if it were a site question, so the same parsers are tested.
    const renamed =
      engine === "openai"
        ? {
            answers: (
              (raw as { answers?: Array<{ name?: string }> }).answers ?? []
            ).map((a) => ({
              ...a,
              name: a.name === "test" ? "hailNet" : a.name,
            })),
          }
        : {
            answers: {
              hailNet: (raw as { answers?: Record<string, unknown> }).answers
                ?.test,
            },
          };
    const result =
      engine === "openai"
        ? readOpenAiAnswers(renamed, q)
        : readJevAnswers(renamed, q);
    const p = result.answers.hailNet?.probabilities?.yes ?? null;
    if (p == null) {
      return {
        ok: false,
        engine,
        model,
        probability: null,
        error: "The engine answered without a probability.",
      };
    }
    return { ok: true, engine, model, probability: p };
  } catch (error) {
    return {
      ok: false,
      engine,
      model,
      probability: null,
      error: errorText(error).slice(0, 400),
    };
  }
}

/** Models installed in the local Ollama, with the recommended ones marked. */
export async function localDecisionModels(): Promise<{
  reachable: boolean;
  installed: string[];
}> {
  const check = validateOllamaOrigin(
    getSettings().decisions?.ollamaBaseUrl || OLLAMA_DEFAULT_ORIGIN,
  );
  if (!check.ok) return { reachable: false, installed: [] };
  try {
    const res = await fetchWithResilience(
      `${check.url}/api/tags`,
      {},
      { retries: 0, timeoutMs: 2_000 },
    );
    if (!res.ok) return { reachable: false, installed: [] };
    const data = (await res.json()) as { models?: Array<{ name?: unknown }> };
    const installed = (data.models ?? [])
      .flatMap((m) => (typeof m.name === "string" ? [m.name] : []))
      .slice(0, 500);
    return { reachable: true, installed };
  } catch {
    return { reachable: false, installed: [] };
  }
}

/** Ollama's address for decision models (this computer only). */
export function decisionOllamaOrigin(): string {
  const check = validateOllamaOrigin(
    getSettings().decisions?.ollamaBaseUrl || OLLAMA_DEFAULT_ORIGIN,
  );
  if (!check.ok) throw new Error("Ollama address must point to this computer");
  return check.url;
}

/** Recommended models, for the settings. */
export const RECOMMENDED_LOCAL_MODELS = LOCAL_DECISION_MODELS;
