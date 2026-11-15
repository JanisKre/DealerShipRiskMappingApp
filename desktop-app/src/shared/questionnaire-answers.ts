import { z } from "zod";
import { QUESTION_IDS, type QuestionId } from "./dealer-questionnaire";

/**
 * Sorting a dealership's reply to the fixed questions. Without AI the
 * underwriter reads the reply and writes notes by hand. With AI, a model
 * assigns passages of the reply to the questions; `groundAnswers` keeps an
 * answer only when its quote is literally in the reply, so nothing is
 * attributed to the dealership that it did not write. The result is a draft
 * the underwriter adds to the notes; it changes no figure.
 */

/** Characters of a pasted reply. */
export const REPLY_MAX_CHARS = 12_000;
export const ANSWER_MAX_CHARS = 300;
export const QUOTE_MAX_CHARS = 300;
/** A quote shorter than this proves nothing. */
export const QUOTE_MIN_CHARS = 8;

export const QuestionnaireAnswersAnswerSchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string(),
        answer: z.string().max(2_000),
        quote: z.string().max(2_000),
      }),
    )
    .max(40),
});

export const QuestionnaireAnswerSchema = z.object({
  questionId: z.enum(QUESTION_IDS),
  /** The model's short summary of what the dealership says. */
  answer: z.string().max(ANSWER_MAX_CHARS),
  /** The passage of the reply it rests on, verbatim. */
  quote: z.string().max(QUOTE_MAX_CHARS),
});
export type QuestionnaireAnswer = z.infer<typeof QuestionnaireAnswerSchema>;

function normalise(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[“”„«»"']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Known questions only, one answer each, and only with a quote found in the
 * reply (ignoring case, quotation marks and line breaks).
 */
export function groundAnswers(
  answers: Array<{ questionId: string; answer: string; quote: string }>,
  reply: string,
  asked: readonly QuestionId[],
): QuestionnaireAnswer[] {
  const source = normalise(reply);
  const allowed = new Set<string>(asked);
  const seen = new Set<string>();
  const grounded: QuestionnaireAnswer[] = [];
  for (const a of answers) {
    if (!allowed.has(a.questionId) || seen.has(a.questionId)) continue;
    const quote = a.quote.replace(/\s+/g, " ").trim();
    const answer = a.answer.replace(/\s+/g, " ").trim();
    if (!answer || quote.length < QUOTE_MIN_CHARS) continue;
    if (!source.includes(normalise(quote))) continue;
    seen.add(a.questionId);
    grounded.push({
      questionId: a.questionId as QuestionId,
      answer: answer.slice(0, ANSWER_MAX_CHARS),
      quote: quote.slice(0, QUOTE_MAX_CHARS),
    });
  }
  // In the order the questions were asked.
  return grounded.sort(
    (a, b) => asked.indexOf(a.questionId) - asked.indexOf(b.questionId),
  );
}
