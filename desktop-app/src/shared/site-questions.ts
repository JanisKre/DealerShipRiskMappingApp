import { z } from "zod";

/**
 * Site questions: a fixed checklist per location (hail protection, parking
 * deck, share parked in the open, boundary, construction, is it a
 * dealership at all). Works without AI: the underwriter, or the dealer
 * through the underwriter, answers by hand. An image model may answer the
 * same questions on the aerial image; a decision model also returns a
 * probability per answer (docs/site-questions.md).
 *
 * Every answer keeps who gave it, when, and on which image. The answer
 * shown is the underwriter's, else the dealer's, else the newest model
 * answer. Nothing here changes the vehicle count, the boundary or the hail
 * EAL: the answers are observations next to the result.
 */

// --- Catalog --------------------------------------------------------------

export const SITE_QUESTION_IDS = [
  "hailNet",
  "canopy",
  "parkingStructure",
  "openAirShare",
  "boundaryFits",
  "construction",
  "dealershipVisible",
] as const;
export const SiteQuestionIdSchema = z.enum(SITE_QUESTION_IDS);
export type SiteQuestionId = z.infer<typeof SiteQuestionIdSchema>;

/** Questions about hail protection, for the filter and the export. */
export const PROTECTION_QUESTIONS = [
  "hailNet",
  "canopy",
  "parkingStructure",
] as const satisfies readonly SiteQuestionId[];

/** Ordered answer levels of the one non-yes/no question. */
export const OPEN_AIR_LEVELS = ["few", "aboutHalf", "most"] as const;
export type OpenAirLevel = (typeof OPEN_AIR_LEVELS)[number];

export const YES_NO = ["yes", "no"] as const;

export type SiteQuestionKind = "yesNo" | "openAirShare";

export function questionKind(id: SiteQuestionId): SiteQuestionKind {
  return id === "openAirShare" ? "openAirShare" : "yesNo";
}

/** The answers a question can have, apart from "unclear". */
export function questionOptions(id: SiteQuestionId): readonly string[] {
  return questionKind(id) === "openAirShare" ? OPEN_AIR_LEVELS : YES_NO;
}

/** Questions that need the lot boundary drawn on the image. */
export function needsBoundary(id: SiteQuestionId): boolean {
  return id === "boundaryFits";
}

/**
 * What a model is asked, in English (all engines take English best). The
 * renderer shows the localised wording from `siteQuestions.q.<id>`.
 */
export const MODEL_INSTRUCTIONS: Record<SiteQuestionId, string> = {
  hailNet:
    "Are hail protection nets stretched over rows of parked vehicles (fine regular mesh on masts, often grey or black, cars faintly visible underneath)?",
  canopy:
    "Do carports or solid canopies cover parked vehicles? Building roofs do not count unless vehicles are parked under them.",
  parkingStructure:
    "Is there a multi-storey car park or a parking deck on the lot?",
  openAirShare:
    "Of the vehicles you can see or infer on the lot, how many stand in the open (not under nets, canopies or a parking deck)?",
  boundaryFits:
    "The pink line is the lot boundary a screening tool found automatically. Does it enclose the dealership's operating area (sales and storage areas with parked vehicles, its buildings and yards) without public roads, neighbouring businesses, fields or housing?",
  construction:
    "Is there visible construction on the lot (excavation, building site, cranes, new surfacing)?",
  dealershipVisible:
    "Does the image show a car dealership or vehicle storage site (rows of parked vehicles, showroom, workshop)?",
};

/** Descriptions of the open-air levels, for choice questions. */
export const OPEN_AIR_DESCRIPTIONS: Record<OpenAirLevel, string> = {
  few: "Few of the vehicles stand in the open; most are protected.",
  aboutHalf: "About half of the vehicles stand in the open.",
  most: "Most of the vehicles stand in the open.",
};

/** Asked first on every image; "no" makes every answer "unclear". */
export const IMAGE_USABLE_INSTRUCTIONS =
  "Is the aerial image clear enough to judge the lot (no clouds, snow, heavy shadow, blur or missing imagery)?";

/** Context sent with the image to every engine. */
export function modelContext(outlined: boolean): string {
  return `Aerial image of one car dealership in Germany, for a hail-risk screening tool.${
    outlined
      ? " The pink line is the lot boundary the tool uses; judge only what is inside it."
      : ""
  } Judge only what is visible; when the image does not show it, the answer is uncertain.`;
}

// --- Answers --------------------------------------------------------------

export const ANSWER_SOURCES = ["underwriter", "dealer", "model"] as const;
export const AnswerSourceSchema = z.enum(ANSWER_SOURCES);
export type AnswerSource = z.infer<typeof AnswerSourceSchema>;

export const DECISION_ENGINES = [
  "openai",
  "google",
  "systemone",
  "ollama",
  "llm",
] as const;
export const DecisionEngineSchema = z.enum(DECISION_ENGINES);
export type DecisionEngine = z.infer<typeof DecisionEngineSchema>;

/**
 * Where a probability comes from. `decision`: a decision endpoint that
 * scores the options. An image model answering in words gives none.
 */
export const PROBABILITY_KINDS = ["decision"] as const;

const Probability = z.number().min(0).max(1);

export const SiteAnswerSchema = z.object({
  question: SiteQuestionIdSchema,
  /** One of `questionOptions`, or "unclear". */
  value: z.string().max(20),
  source: AnswerSourceSchema,
  at: z.string().max(40),
  /** Model answers: the engine and model that gave it. */
  engine: DecisionEngineSchema.optional(),
  model: z.string().max(200).optional(),
  /** Model answers: probability per option, as the engine returned it. */
  probabilities: z.record(z.string().max(20), Probability).optional(),
  probabilityKind: z.enum(PROBABILITY_KINDS).optional(),
  /** Model answers: the image looked at. */
  imageCapturedAt: z.string().max(40).nullable().optional(),
  imageLabel: z.string().max(200).optional(),
});
export type SiteAnswer = z.infer<typeof SiteAnswerSchema>;

/** Kept per location: one answer per question, source and engine. */
export const SITE_ANSWERS_MAX =
  SITE_QUESTION_IDS.length * (2 + DECISION_ENGINES.length);

export const SiteAnswersSchema = z.array(SiteAnswerSchema).max(200);

export function isValidValue(id: SiteQuestionId, value: string): boolean {
  return value === "unclear" || questionOptions(id).includes(value);
}

/** Identity of a stored answer: a new one replaces the old one. */
function slot(a: SiteAnswer): string {
  return `${a.question}|${a.source}|${a.source === "model" ? (a.engine ?? "") : ""}`;
}

/** Stores answers: each replaces the earlier one in its slot. */
export function mergeAnswers(
  existing: readonly SiteAnswer[] | undefined,
  incoming: readonly SiteAnswer[],
): SiteAnswer[] {
  const bySlot = new Map<string, SiteAnswer>();
  for (const a of existing ?? []) bySlot.set(slot(a), a);
  for (const a of incoming) {
    if (!isValidValue(a.question, a.value)) continue;
    bySlot.set(slot(a), a);
  }
  return [...bySlot.values()].slice(-SITE_ANSWERS_MAX);
}

/** Removes the underwriter's or dealer's answer to one question. */
export function clearAnswer(
  existing: readonly SiteAnswer[] | undefined,
  question: SiteQuestionId,
  source: Exclude<AnswerSource, "model">,
): SiteAnswer[] {
  return (existing ?? []).filter(
    (a) => !(a.question === question && a.source === source),
  );
}

// --- Thresholds -----------------------------------------------------------

/**
 * When a yes/no probability counts as "yes" or "no"; between the two it is
 * "unclear". Measured per engine and model on the user's own labelled
 * locations (`calibrate`), or the default below.
 */
export const ThresholdSchema = z
  .object({
    yes: Probability,
    no: Probability,
    /** Labelled locations the values were measured on; absent: default. */
    n: z.number().int().nonnegative().optional(),
    measuredAt: z.string().max(40).optional(),
  })
  .refine((t) => t.no < t.yes, "no must be below yes");
export type Threshold = z.infer<typeof ThresholdSchema>;

/**
 * Used until a measurement exists: wide on purpose, so an unmeasured
 * engine says "unclear" rather than guess.
 */
export const DEFAULT_THRESHOLD: Threshold = { yes: 0.8, no: 0.2 };

/** Key of the thresholds of one engine and model. */
export function engineKey(engine: DecisionEngine, model: string): string {
  return `${engine}:${model}`.slice(0, 240);
}

export const ThresholdTableSchema = z.record(
  z.string().max(240),
  z.partialRecord(SiteQuestionIdSchema, ThresholdSchema),
);
export type ThresholdTable = z.infer<typeof ThresholdTableSchema>;

/** The measured threshold of an answer's engine, if any. */
export function measuredThreshold(
  answer: SiteAnswer,
  table: ThresholdTable | undefined,
): Threshold | null {
  if (!answer.engine || !answer.model) return null;
  const found =
    table?.[engineKey(answer.engine, answer.model)]?.[answer.question];
  return found?.n != null ? found : null;
}

/**
 * The value a model answer stands for. A probability from a decision
 * endpoint is read against the measured threshold, else the default; an
 * answer without probabilities keeps the value the model gave.
 */
export function modelValue(
  answer: SiteAnswer,
  table: ThresholdTable | undefined,
): string {
  const p = answer.probabilities;
  if (!p || answer.probabilityKind !== "decision") return answer.value;
  if (questionKind(answer.question) === "yesNo") {
    const yes = p.yes;
    if (yes == null) return "unclear";
    const t = measuredThreshold(answer, table) ?? DEFAULT_THRESHOLD;
    return yes >= t.yes ? "yes" : yes <= t.no ? "no" : "unclear";
  }
  // Ordered levels: the most likely one, if it is clearly ahead.
  const ranked = OPEN_AIR_LEVELS.map((level) => ({
    level,
    p: p[level] ?? 0,
  })).sort((a, b) => b.p - a.p);
  return ranked[0].p >= 0.6 ? ranked[0].level : "unclear";
}

/** Probability of the shown value, only once it is backed by a measurement. */
export function shownProbability(
  answer: SiteAnswer,
  table: ThresholdTable | undefined,
): number | null {
  if (answer.source !== "model" || answer.probabilityKind !== "decision")
    return null;
  if (!measuredThreshold(answer, table)) return null;
  const value = modelValue(answer, table);
  const p = answer.probabilities?.[value];
  return p == null ? null : p;
}

// --- The answer shown -----------------------------------------------------

export interface ResolvedAnswer {
  question: SiteQuestionId;
  /** What the checklist shows; "unanswered" when nobody answered. */
  value: string;
  /** The answer it comes from. */
  answer: SiteAnswer | null;
  /** Answers of the other sources, newest first. */
  others: SiteAnswer[];
}

const RANK: Record<AnswerSource, number> = {
  underwriter: 0,
  dealer: 1,
  model: 2,
};

/** Underwriter before dealer before the newest model answer. */
export function resolveAnswer(
  answers: readonly SiteAnswer[] | undefined,
  question: SiteQuestionId,
  table?: ThresholdTable,
): ResolvedAnswer {
  const own = (answers ?? [])
    .filter((a) => a.question === question)
    .sort(
      (a, b) => RANK[a.source] - RANK[b.source] || b.at.localeCompare(a.at),
    );
  const [first, ...others] = own;
  if (!first) return { question, value: "unanswered", answer: null, others };
  return {
    question,
    value: first.source === "model" ? modelValue(first, table) : first.value,
    answer: first,
    others,
  };
}

export function resolveAll(
  answers: readonly SiteAnswer[] | undefined,
  table?: ThresholdTable,
): ResolvedAnswer[] {
  return SITE_QUESTION_IDS.map((id) => resolveAnswer(answers, id, table));
}

export type ProtectionState = "seen" | "notSeen" | "unclear" | "unanswered";

/**
 * Hail protection in one word, for the filter and the export: "seen" when
 * any protection question is answered yes, "notSeen" when all three are
 * no, "unanswered" when none is answered, else "unclear".
 */
export function protectionState(
  answers: readonly SiteAnswer[] | undefined,
  table?: ThresholdTable,
): ProtectionState {
  const values = PROTECTION_QUESTIONS.map(
    (id) => resolveAnswer(answers, id, table).value,
  );
  if (values.includes("yes")) return "seen";
  if (values.every((v) => v === "no")) return "notSeen";
  if (values.every((v) => v === "unanswered")) return "unanswered";
  return "unclear";
}

// --- Model runs -------------------------------------------------------------

/** One engine's answers on one image, as the main process returns them. */
export const DecisionRunSchema = z.object({
  engine: DecisionEngineSchema,
  model: z.string().max(200),
  at: z.string().max(40),
  imageCapturedAt: z.string().max(40).nullable(),
  imageLabel: z.string().max(200),
  /** False: clouds, snow or blur; every answer is then "unclear". */
  imageUsable: z.boolean(),
  answers: z.array(SiteAnswerSchema).max(SITE_QUESTION_IDS.length),
});
export type DecisionRun = z.infer<typeof DecisionRunSchema>;

/** A raw engine answer, before it becomes a stored answer. */
export interface EngineAnswer {
  /** Probability per option; absent when the engine gives none. */
  probabilities?: Record<string, number>;
  /** The option the engine picked, or "unclear". */
  value: string;
}

/** Probabilities clamped to 0..1 and only for the question's options. */
export function cleanProbabilities(
  id: SiteQuestionId,
  raw: Record<string, unknown> | undefined,
): Record<string, number> | undefined {
  if (!raw) return undefined;
  const out: Record<string, number> = {};
  for (const option of questionOptions(id)) {
    const v = raw[option];
    if (typeof v === "number" && Number.isFinite(v)) {
      out[option] = Math.min(1, Math.max(0, v));
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Turns engine answers into stored answers of one run. */
export function toRun(input: {
  engine: DecisionEngine;
  model: string;
  imageCapturedAt: string | null;
  imageLabel: string;
  /** Probability that the image is usable; null when not asked. */
  imageUsable: number | null;
  answers: Partial<Record<SiteQuestionId, EngineAnswer>>;
  at?: string;
}): DecisionRun {
  const at = input.at ?? new Date().toISOString();
  const usable = input.imageUsable == null || input.imageUsable >= 0.5;
  const answers: SiteAnswer[] = [];
  for (const id of SITE_QUESTION_IDS) {
    const raw = input.answers[id];
    if (!raw) continue;
    const probabilities = usable
      ? cleanProbabilities(id, raw.probabilities)
      : undefined;
    const value = usable && isValidValue(id, raw.value) ? raw.value : "unclear";
    answers.push({
      question: id,
      value,
      source: "model",
      at,
      engine: input.engine,
      model: input.model.slice(0, 200),
      ...(probabilities ? { probabilities, probabilityKind: "decision" } : {}),
      imageCapturedAt: input.imageCapturedAt,
      imageLabel: input.imageLabel.slice(0, 200),
    });
  }
  return {
    engine: input.engine,
    model: input.model.slice(0, 200),
    at,
    imageCapturedAt: input.imageCapturedAt,
    imageLabel: input.imageLabel.slice(0, 200),
    imageUsable: usable,
    answers,
  };
}

/** The value for yes/no probabilities: the more likely option. */
export function likelierYesNo(p: Record<string, number> | undefined): string {
  if (!p || p.yes == null) return "unclear";
  return p.yes >= 0.5 ? "yes" : "no";
}

// --- Comparison with labelled locations -----------------------------------

/** Labelled locations needed before thresholds are suggested. */
export const CALIBRATION_MIN_LABELS = 20;
/** And at least this many of each class. */
export const CALIBRATION_MIN_PER_CLASS = 5;
/** A suggested threshold must reach this share of correct answers. */
export const CALIBRATION_TARGET = 0.9;

export interface CalibrationRow {
  key: string;
  engine: DecisionEngine;
  model: string;
  question: SiteQuestionId;
  /** Locations with a person's yes/no and this engine's probability. */
  n: number;
  positives: number;
  /** Mean squared error of the probability against the label (0 is perfect). */
  brier: number | null;
  /** Share right with the default thresholds, among the answers not "unclear". */
  accuracyDefault: number | null;
  /** Share left "unclear" with the default thresholds. */
  unclearDefault: number | null;
  /** Suggested thresholds; null while there are too few labels. */
  suggested: Threshold | null;
}

interface Pair {
  p: number;
  label: boolean;
}

/** Answers of a person (underwriter first) that are yes or no. */
function labelOf(
  answers: readonly SiteAnswer[],
  question: SiteQuestionId,
): boolean | null {
  const person = answers
    .filter(
      (a) =>
        a.question === question &&
        a.source !== "model" &&
        (a.value === "yes" || a.value === "no"),
    )
    .sort((a, b) => RANK[a.source] - RANK[b.source])[0];
  return person ? person.value === "yes" : null;
}

/**
 * The lowest probability from which "yes" is right at least `target` of the
 * time, and the highest up to which "no" is; null when no value gets there.
 */
function suggestThreshold(pairs: Pair[], target: number): Threshold | null {
  const candidates = [...new Set(pairs.map((x) => x.p))].sort((a, b) => a - b);
  let yes: number | null = null;
  for (const t of candidates) {
    const above = pairs.filter((x) => x.p >= t);
    if (above.length < CALIBRATION_MIN_PER_CLASS) break;
    const right = above.filter((x) => x.label).length / above.length;
    if (right >= target) {
      yes = t;
      break;
    }
  }
  if (yes == null) return null;
  // "No" only below "yes": the band between the two stays "unclear".
  let no: number | null = null;
  for (const t of candidates.filter((c) => c < yes).reverse()) {
    const below = pairs.filter((x) => x.p <= t);
    if (below.length < CALIBRATION_MIN_PER_CLASS) break;
    const right = below.filter((x) => !x.label).length / below.length;
    if (right >= target) {
      no = t;
      break;
    }
  }
  if (no == null) return null;
  return { yes, no };
}

/**
 * Compares the engines' yes/no probabilities with what the underwriter or
 * the dealer answered on the same locations. Only answers with a
 * probability from a decision endpoint take part.
 */
export function calibrate(
  locations: ReadonlyArray<{ siteAnswers?: SiteAnswer[] }>,
  now: Date = new Date(),
): CalibrationRow[] {
  const groups = new Map<
    string,
    {
      engine: DecisionEngine;
      model: string;
      question: SiteQuestionId;
      pairs: Pair[];
    }
  >();
  for (const location of locations) {
    const answers = location.siteAnswers ?? [];
    for (const a of answers) {
      if (
        a.source !== "model" ||
        a.probabilityKind !== "decision" ||
        !a.engine ||
        !a.model ||
        questionKind(a.question) !== "yesNo" ||
        a.probabilities?.yes == null
      )
        continue;
      const label = labelOf(answers, a.question);
      if (label == null) continue;
      const key = engineKey(a.engine, a.model);
      const id = `${key}|${a.question}`;
      const group = groups.get(id) ?? {
        engine: a.engine,
        model: a.model,
        question: a.question,
        pairs: [],
      };
      group.pairs.push({ p: a.probabilities.yes, label });
      groups.set(id, group);
    }
  }
  const rows: CalibrationRow[] = [];
  for (const { engine, model, question, pairs } of groups.values()) {
    const positives = pairs.filter((x) => x.label).length;
    const brier =
      pairs.reduce((s, x) => s + (x.p - (x.label ? 1 : 0)) ** 2, 0) /
      pairs.length;
    const decided = pairs.filter(
      (x) => x.p >= DEFAULT_THRESHOLD.yes || x.p <= DEFAULT_THRESHOLD.no,
    );
    const right = decided.filter(
      (x) => x.p >= DEFAULT_THRESHOLD.yes === x.label,
    ).length;
    const enough =
      pairs.length >= CALIBRATION_MIN_LABELS &&
      positives >= CALIBRATION_MIN_PER_CLASS &&
      pairs.length - positives >= CALIBRATION_MIN_PER_CLASS;
    const suggested = enough
      ? suggestThreshold(pairs, CALIBRATION_TARGET)
      : null;
    rows.push({
      key: engineKey(engine, model),
      engine,
      model,
      question,
      n: pairs.length,
      positives,
      brier: Math.round(brier * 1000) / 1000,
      accuracyDefault:
        decided.length > 0
          ? Math.round((right / decided.length) * 100) / 100
          : null,
      unclearDefault:
        Math.round(((pairs.length - decided.length) / pairs.length) * 100) /
        100,
      suggested: suggested
        ? { ...suggested, n: pairs.length, measuredAt: now.toISOString() }
        : null,
    });
  }
  return rows.sort(
    (a, b) =>
      a.key.localeCompare(b.key) ||
      SITE_QUESTION_IDS.indexOf(a.question) -
        SITE_QUESTION_IDS.indexOf(b.question),
  );
}
