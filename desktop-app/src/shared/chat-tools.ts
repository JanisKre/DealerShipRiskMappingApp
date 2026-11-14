import { z } from "zod";

/**
 * Read-only lookups the optional chat planner may ask for before an answer.
 * The planner only picks tools and locations; the app runs every lookup
 * itself with the same services the detail dialog uses and hands the
 * results to the chat model as fenced data. Without AI the same evidence is
 * in the detail dialog.
 */
export const CHAT_TOOLS = [
  /** Hail EAL inputs, evidence sources, limitations, boundary provenance. */
  "evidence",
  /** DWD station hail days near the location. */
  "hailHistory",
  /** Radar hail cells within 1 km from the local KONRAD3D archive. */
  "radarHail",
  /** Aerial imagery at the location: the counted image and newer candidates. */
  "imagery",
] as const;
export const ChatToolSchema = z.enum(CHAT_TOOLS);
export type ChatTool = z.infer<typeof ChatToolSchema>;

/** Most lookups per question. */
export const CHAT_TOOL_MAX_CALLS = 5;
/** Locations the planner can choose from (names are in the chat context anyway). */
export const CHAT_TOOL_MAX_LOCATIONS = 300;
/** Size of the lookup results handed to the chat model. */
export const CHAT_TOOL_RESULTS_MAX_CHARS = 16_000;

export const ChatToolCallSchema = z.object({
  tool: ChatToolSchema,
  locationId: z.string().min(1).max(100),
});
export type ChatToolCall = z.infer<typeof ChatToolCallSchema>;

export const ChatToolPlanAnswerSchema = z.object({
  calls: z
    .array(z.object({ tool: z.string(), locationId: z.string() }))
    .max(50),
});

/** Known tools and ids only, each pair once, at most {@link CHAT_TOOL_MAX_CALLS}. */
export function cleanToolCalls(
  calls: Array<{ tool: string; locationId: string }>,
  knownIds: ReadonlySet<string>,
): ChatToolCall[] {
  const seen = new Set<string>();
  const result: ChatToolCall[] = [];
  for (const call of calls) {
    const tool = ChatToolSchema.safeParse(call.tool);
    if (!tool.success || !knownIds.has(call.locationId)) continue;
    const key = `${tool.data}:${call.locationId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ tool: tool.data, locationId: call.locationId });
    if (result.length === CHAT_TOOL_MAX_CALLS) break;
  }
  return result;
}
