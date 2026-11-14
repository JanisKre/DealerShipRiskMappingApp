import { z } from "zod";
import { containsFigure } from "./a2ui";

/**
 * Optional AI order for a review run. The fixed queue (highest hail EAL
 * first, `buildReviewQueue`) always exists; the AI may only reorder it and
 * add a short note per location. Ids it invents are dropped, locations it
 * leaves out keep their fixed order at the end, and notes that carry amounts
 * or percentages are discarded.
 */

export const REVIEW_PLAN_MAX_ITEMS = 500;
export const REVIEW_NOTE_MAX_CHARS = 200;

/** What the model sees per location: no name, address, notes or amounts. */
export const ReviewPlanItemSchema = z.object({
  id: z.string().min(1).max(100),
  reasons: z.array(z.enum(["boundary", "imagery", "underwriting"])).min(1),
  hailZone: z.number().int().min(1).max(6).nullable(),
  /** 1 = highest hail EAL in the queue. */
  ealRank: z.number().int().positive(),
  imageryAgeYears: z.number().nonnegative().nullable(),
  boundarySource: z.string().max(40).nullable(),
  boundaryConfidence: z.number().min(0).max(1).nullable(),
  vehicleSource: z.enum(["detected", "estimated", "manual", "none"]),
});
export type ReviewPlanItem = z.infer<typeof ReviewPlanItemSchema>;

export const ReviewPlanSchema = z.object({
  order: z.array(z.string()),
  notes: z.record(z.string(), z.string()),
});
export type ReviewPlan = z.infer<typeof ReviewPlanSchema>;

/** Shape the model is asked to answer with (before validation). */
export const ReviewPlanAnswerSchema = z.object({
  order: z.array(z.string()).max(REVIEW_PLAN_MAX_ITEMS * 2),
  notes: z
    .array(z.object({ id: z.string(), text: z.string() }))
    .max(REVIEW_PLAN_MAX_ITEMS * 2)
    .optional(),
});

/**
 * The fixed queue reordered by the proposal: known ids in the proposed
 * order (each once), then every id the proposal left out, in fixed order.
 */
export function mergeReviewOrder(
  fixed: string[],
  proposed: string[],
): string[] {
  const known = new Set(fixed);
  const seen = new Set<string>();
  const order: string[] = [];
  for (const id of proposed) {
    if (known.has(id) && !seen.has(id)) {
      seen.add(id);
      order.push(id);
    }
  }
  for (const id of fixed) if (!seen.has(id)) order.push(id);
  return order;
}

/** Notes for known ids only, trimmed, without figures; first note per id wins. */
export function cleanReviewNotes(
  fixed: string[],
  notes: Array<{ id: string; text: string }>,
): Record<string, string> {
  const known = new Set(fixed);
  const result: Record<string, string> = {};
  for (const { id, text } of notes) {
    const clean = text.replace(/\s+/g, " ").trim();
    if (!known.has(id) || id in result || !clean || containsFigure(clean))
      continue;
    result[id] =
      clean.length > REVIEW_NOTE_MAX_CHARS
        ? `${clean.slice(0, REVIEW_NOTE_MAX_CHARS - 1).trimEnd()}…`
        : clean;
  }
  return result;
}
