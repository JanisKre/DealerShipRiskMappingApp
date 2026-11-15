import { z } from "zod";

/**
 * AI record book ("KI-Protokollbuch"): one entry per request the app sent to
 * an AI provider, kept locally so the user can show what was asked, what
 * came back and which model answered. Written by the main process only;
 * nothing here is sent anywhere, and the diagnostics report leaves it out.
 */

/** Entries kept; the oldest are pruned on insert. */
export const AI_LOG_MAX_ENTRIES = 500;
/** Stored characters of the request and of the answer per entry. */
export const AI_LOG_TEXT_MAX_CHARS = 20_000;
/** Entries per page in the settings list. */
export const AI_LOG_PAGE_SIZE = 50;

export const AiLogStatusSchema = z.enum(["ok", "error", "aborted"]);
export type AiLogStatus = z.infer<typeof AiLogStatusSchema>;

export const AiLogEntrySchema = z.object({
  id: z.number().int().nonnegative(),
  /** ISO timestamp of the request. */
  at: z.string(),
  /** What asked: the IPC channel or gateway route, e.g. `llm:reviewPlan`. */
  feature: z.string().max(80),
  provider: z.string().max(40),
  model: z.string().max(200),
  /** Host the request went to (no path, no credentials). */
  endpointHost: z.string().max(255),
  /** True when the endpoint is on this computer. */
  local: z.boolean(),
  status: AiLogStatusSchema,
  durationMs: z.number().nonnegative(),
  /** Full sizes; the stored texts may be cut at AI_LOG_TEXT_MAX_CHARS. */
  requestChars: z.number().int().nonnegative(),
  responseChars: z.number().int().nonnegative(),
  /** Images attached to the request (aerial imagery for the site check). */
  imageCount: z.number().int().nonnegative(),
  error: z.string().max(500).optional(),
});
export type AiLogEntry = z.infer<typeof AiLogEntrySchema>;

/** One entry with the stored request and answer text. */
export const AiLogDetailSchema = AiLogEntrySchema.extend({
  request: z.string(),
  response: z.string(),
});
export type AiLogDetail = z.infer<typeof AiLogDetailSchema>;

export const AiLogPageSchema = z.object({
  entries: z.array(AiLogEntrySchema),
  total: z.number().int().nonnegative(),
});
export type AiLogPage = z.infer<typeof AiLogPageSchema>;

/** Cuts a text for storage and marks the cut, so a reader sees it is partial. */
export function clipForLog(
  text: string,
  max: number = AI_LOG_TEXT_MAX_CHARS,
): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… [${text.length - max} more characters not stored]`;
}

/**
 * The request as stored text: role-prefixed messages. Images are never
 * stored, only counted.
 */
export function requestForLog(
  messages: ReadonlyArray<{ role: string; content: string }>,
  imageCount = 0,
): string {
  const text = messages
    .map((m) => `[${m.role}]\n${m.content}`)
    .join("\n\n")
    .concat(imageCount > 0 ? `\n\n[${imageCount} image(s) attached]` : "");
  return clipForLog(text);
}

/** Host of an endpoint URL for the log; "unknown" when it does not parse. */
export function endpointHostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host.slice(0, 255);
  } catch {
    return "unknown";
  }
}
