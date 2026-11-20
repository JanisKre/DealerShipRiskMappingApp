import { z } from "zod";
import type { AnalyzedDealership, RiskParameters } from "./types";
import { DEFAULT_RISK_PARAMETERS } from "./parameters";
import { lastAnalyzedOn } from "./change-report";
import { hasEalBasis } from "./estimates";
import { challengeAssumptions, challengeFacts } from "./assumption-challenge";
import { checkNumbers, containsNumberWordFigure } from "./number-check";
import { dealershipHailZone, displayedHailVehicleSource } from "./risk-math";

/**
 * Evidence memo: a short underwriting note in which every figure is one the
 * app computed. Without AI the memo is the fact sheet below. With AI, a
 * model writes sentences over the same facts; `verifyMemo` then drops every
 * sentence that states a number not found among the facts and attaches the
 * facts each remaining sentence rests on. The model never supplies a figure.
 */

export const MEMO_FACT_KEYS = [
  "vehicles",
  "vehicleSource",
  "imageDate",
  "hailZone",
  "hailZoneSource",
  "eventsPerYear",
  "lossPerVehicleEur",
  "hailEalEur",
  "exposureEur",
  "stockLow",
  "stockMedian",
  "stockHigh",
  "boundarySource",
  "boundaryConfidencePct",
  "lotAreaSqm",
  "deductibleEur",
  "productLimitEur",
  "analyzedOn",
  "modelVersion",
] as const;
export type MemoFactKey = (typeof MEMO_FACT_KEYS)[number];

export interface MemoFact {
  /** Citation id, "f1" … */
  id: string;
  key: MemoFactKey;
  value: number | string;
}

const FACT_LABEL: Record<MemoFactKey, string> = {
  vehicles: "Vehicles on the lot (N)",
  vehicleSource: "Source of the vehicle count",
  imageDate: "Capture date of the aerial image the vehicles were counted on",
  hailZone: "Hail zone (higher means more hail; the scale ends at six)",
  hailZoneSource: "Source of the hail zone",
  eventsPerYear: "Damaging hail events per year in this zone",
  lossPerVehicleEur: "Expected loss per vehicle and event (EUR)",
  hailEalEur: "Hail expected annual loss (EUR, screening estimate)",
  exposureEur: "Estimated value of the vehicles on the lot (EUR)",
  stockLow: "Lowest vehicle count on archived images",
  stockMedian: "Median vehicle count on archived images",
  stockHigh: "Highest vehicle count on archived images",
  boundarySource: "Source of the lot boundary",
  boundaryConfidencePct: "Confidence of the lot boundary (%)",
  lotAreaSqm: "Lot area (m²)",
  deductibleEur: "Deductible per loss (EUR)",
  productLimitEur: "Product limit (EUR)",
  analyzedOn: "Date of the last analysis",
  modelVersion: "Risk model version",
};

/** The figures and sources of a location's result, in a fixed order. */
export function memoFacts(d: AnalyzedDealership): MemoFact[] {
  const detail = d.risk?.ealBreakdown?.hailDetail;
  const zone = dealershipHailZone(d);
  const values: Array<[MemoFactKey, number | string | null | undefined]> = [
    ["vehicles", detail ? Math.round(detail.vehicles) : null],
    [
      "vehicleSource",
      d.risk
        ? displayedHailVehicleSource(detail?.vehicleSource, d.detection)
        : null,
    ],
    ["imageDate", d.detection?.imagery?.chosen.capturedAt?.slice(0, 10)],
    ["hailZone", zone?.zone],
    ["hailZoneSource", zone?.source],
    ["eventsPerYear", detail?.frequency],
    ["lossPerVehicleEur", detail ? Math.round(detail.meanSeverityEur) : null],
    ["hailEalEur", hasEalBasis(d) ? Math.round(d.risk!.eal) : null],
    [
      "exposureEur",
      d.risk?.exposureEur != null ? Math.round(d.risk.exposureEur) : null,
    ],
    [
      "stockLow",
      detail?.stockRange ? Math.round(detail.stockRange.vehiclesLow) : null,
    ],
    [
      "stockMedian",
      detail?.stockRange ? Math.round(detail.stockRange.vehiclesMedian) : null,
    ],
    [
      "stockHigh",
      detail?.stockRange ? Math.round(detail.stockRange.vehiclesHigh) : null,
    ],
    ["boundarySource", d.boundary?.source],
    [
      "boundaryConfidencePct",
      d.boundary ? Math.round(d.boundary.confidence * 100) : null,
    ],
    ["lotAreaSqm", d.boundary ? Math.round(d.boundary.areaSqm) : null],
    ["deductibleEur", d.deductibleEur],
    ["productLimitEur", d.productLimitEur],
    ["analyzedOn", lastAnalyzedOn(d)],
    ["modelVersion", d.risk?.modelVersion],
  ];
  const facts: MemoFact[] = [];
  for (const [key, value] of values) {
    if (value == null || value === "") continue;
    facts.push({ id: `f${facts.length + 1}`, key, value });
  }
  return facts;
}

/** The facts as fenced text for the model: `[f1] label: value`. */
export function memoFactsText(
  d: AnalyzedDealership,
  facts: MemoFact[],
  parameters: RiskParameters = DEFAULT_RISK_PARAMETERS,
  now: Date = new Date(),
): string {
  return [
    `Location: ${d.name}`,
    ...facts.map((f) => `[${f.id}] ${FACT_LABEL[f.key]}: ${f.value}`),
    "",
    challengeFacts(d.name, challengeAssumptions(d, parameters, now)),
  ].join("\n");
}

/** "Hail zone 4 on a scale from 1 to 6": the scale itself may be written. */
const HAIL_ZONE_SCALE = [1, 6] as const;

export const MEMO_MAX_SENTENCES = 10;
export const MEMO_SENTENCE_MAX_CHARS = 400;

export const EvidenceMemoAnswerSchema = z.object({
  sentences: z
    .array(
      z.object({
        text: z.string().min(1).max(2_000),
        facts: z.array(z.string()).max(20).default([]),
      }),
    )
    .max(40),
});
export type EvidenceMemoAnswer = z.infer<typeof EvidenceMemoAnswerSchema>;

export const EvidenceMemoSchema = z.object({
  sentences: z.array(
    z.object({
      text: z.string(),
      /** Ids of the facts the sentence rests on. */
      facts: z.array(z.string()),
    }),
  ),
  /** Sentences removed because they stated a figure the app did not compute. */
  removed: z.array(
    z.object({ text: z.string(), unsupported: z.array(z.string()) }),
  ),
});
export type EvidenceMemo = z.infer<typeof EvidenceMemoSchema>;

const DATE_FACTS: ReadonlySet<MemoFactKey> = new Set([
  "imageDate",
  "analyzedOn",
]);

/**
 * The numbers a sentence may state because of this fact. A number fact is
 * its value. A date contributes its year only: day and month count when
 * the date is written out (see `withoutFactLiterals`), not as loose
 * numbers ("14 %" is not supported by an analysis on the 14th). Texts such
 * as the model version or a source name contribute nothing.
 */
function factNumbers(fact: MemoFact): number[] {
  if (typeof fact.value === "number") return [fact.value];
  if (!DATE_FACTS.has(fact.key)) return [];
  const year = /^(\d{4})-\d{2}-\d{2}/.exec(fact.value)?.[1];
  return year ? [Number(year)] : [];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The sentence without the facts it quotes literally: a date fact written
 * as a date (ISO, "14.11.2026", "14. November 2026") and text facts such
 * as the model version. Returns the ids of the facts found that way.
 */
function withoutFactLiterals(
  text: string,
  facts: MemoFact[],
): { text: string; quoted: Set<string> } {
  const quoted = new Set<string>();
  let rest = text;
  for (const fact of facts) {
    if (typeof fact.value !== "string") continue;
    const patterns: RegExp[] = [new RegExp(escapeRegExp(fact.value), "gi")];
    const date = DATE_FACTS.has(fact.key)
      ? /^(\d{4})-(\d{2})-(\d{2})/.exec(fact.value)
      : null;
    if (date) {
      const [, year, month, day] = date;
      const d = String(Number(day));
      const m = String(Number(month));
      patterns.push(
        new RegExp(`\\b0?${d}\\.\\s?0?${m}\\.\\s?${year}\\b`, "g"),
        new RegExp(`\\b0?${d}\\.?\\s+\\p{L}+\\.?\\s+${year}\\b`, "gu"),
        new RegExp(`\\b\\p{L}+\\s+0?${d},\\s+${year}\\b`, "gu"),
      );
    }
    for (const pattern of patterns) {
      if (!pattern.test(rest)) continue;
      quoted.add(fact.id);
      rest = rest.replace(pattern, " ");
    }
  }
  return { text: rest, quoted };
}

/**
 * Keeps the sentences whose numbers are all facts. A sentence's sources are
 * the valid ids the model cited plus every fact one of its numbers matches,
 * so the citation list is checked, not trusted.
 */
export function verifyMemo(
  answer: EvidenceMemoAnswer,
  facts: MemoFact[],
): EvidenceMemo {
  const known = new Set(facts.map((f) => f.id));
  // The ends of the hail zone scale are not a claim about this location.
  const allowed = [...facts.flatMap(factNumbers), ...HAIL_ZONE_SCALE];
  // No fact is a share: a number written with "%" must be the one fact
  // that is a percentage, and a value below one is never its percentage.
  const options = {
    shares: false,
    percentAllowed: facts
      .filter((f) => f.key === "boundaryConfidencePct")
      .flatMap(factNumbers),
  };
  const memo: EvidenceMemo = { sentences: [], removed: [] };
  for (const sentence of answer.sentences) {
    const text = sentence.text.trim().slice(0, MEMO_SENTENCE_MAX_CHARS);
    if (!text) continue;
    const { text: bare, quoted } = withoutFactLiterals(text, facts);
    const check = checkNumbers(bare, allowed, options);
    // "zwanzigtausend Euro": a figure in words has no fact behind it.
    const wordFigure = containsNumberWordFigure(bare);
    if (!check.ok || wordFigure) {
      memo.removed.push({
        text,
        unsupported: check.ok ? ["…"] : check.unsupported,
      });
      continue;
    }
    if (memo.sentences.length >= MEMO_MAX_SENTENCES) continue;
    const cited = new Set([
      ...sentence.facts.filter((id) => known.has(id)),
      ...quoted,
    ]);
    for (const fact of facts) {
      if (factNumbers(fact).length === 0) continue;
      if (
        checkNumbers(bare, factNumbers(fact), options).unsupported.length <
        checkNumbers(bare, [], options).unsupported.length
      )
        cited.add(fact.id);
    }
    memo.sentences.push({
      text,
      facts: facts.filter((f) => cited.has(f.id)).map((f) => f.id),
    });
  }
  return memo;
}
