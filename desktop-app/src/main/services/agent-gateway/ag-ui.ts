import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ChatMessage } from "@shared/types";

/**
 * AG-UI (Agent-User Interaction Protocol): one run of the portfolio chat as
 * a server-sent event stream, so an AG-UI front end can talk to the app's
 * assistant. Text only; the agent offers no tools and changes no state.
 */

const ContentSchema = z.union([
  z.string(),
  z.array(
    z.object({ type: z.string(), text: z.string().optional() }).passthrough(),
  ),
]);

export const RunAgentInputSchema = z
  .object({
    threadId: z.string().min(1).max(200).optional(),
    runId: z.string().min(1).max(200).optional(),
    messages: z
      .array(
        z
          .object({
            id: z.string().optional(),
            role: z.string(),
            content: ContentSchema.optional(),
          })
          .passthrough(),
      )
      .max(200)
      .default([]),
    forwardedProps: z
      .object({ portfolioId: z.string().min(1).max(200).optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type RunAgentInput = z.infer<typeof RunAgentInputSchema>;

/** Characters of conversation taken from an AG-UI client. */
export const AG_UI_MAX_CONVERSATION_CHARS = 40_000;

/**
 * The user/assistant turns of an AG-UI input as chat messages. System,
 * developer and tool messages from the client are dropped: the system prompt
 * is the app's own.
 */
export function chatMessagesFromAgUi(input: RunAgentInput): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const m of input.messages) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    const content =
      typeof m.content === "string"
        ? m.content
        : (m.content ?? [])
            .map((part) => (part.type === "text" ? (part.text ?? "") : ""))
            .join("");
    if (content.trim()) messages.push({ role: m.role, content });
  }
  // Keep the newest turns within the budget.
  let used = 0;
  const kept: ChatMessage[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    used += messages[i].content.length;
    if (used > AG_UI_MAX_CONVERSATION_CHARS && kept.length > 0) break;
    kept.unshift(messages[i]);
  }
  return kept;
}

export type AgUiEvent =
  | { type: "RUN_STARTED"; threadId: string; runId: string }
  | { type: "STATE_SNAPSHOT"; snapshot: unknown }
  | { type: "TEXT_MESSAGE_START"; messageId: string; role: "assistant" }
  | { type: "TEXT_MESSAGE_CONTENT"; messageId: string; delta: string }
  | { type: "TEXT_MESSAGE_END"; messageId: string }
  | { type: "RUN_FINISHED"; threadId: string; runId: string }
  | { type: "RUN_ERROR"; message: string; code?: string };

export function encodeAgUiEvent(event: AgUiEvent): string {
  return `data: ${JSON.stringify({ ...event, timestamp: Date.now() })}\n\n`;
}

/**
 * The events of one run. `tokens` is the answer stream; `snapshot` is sent
 * as shared state before the answer. An error ends the run with RUN_ERROR
 * instead of RUN_FINISHED.
 */
export async function* agUiRun(
  input: RunAgentInput,
  tokens: AsyncIterable<string>,
  snapshot?: unknown,
): AsyncGenerator<AgUiEvent, void, unknown> {
  const threadId = input.threadId ?? randomUUID();
  const runId = input.runId ?? randomUUID();
  const messageId = randomUUID();
  yield { type: "RUN_STARTED", threadId, runId };
  if (snapshot !== undefined) yield { type: "STATE_SNAPSHOT", snapshot };
  let open = false;
  try {
    for await (const delta of tokens) {
      if (!delta) continue;
      if (!open) {
        yield { type: "TEXT_MESSAGE_START", messageId, role: "assistant" };
        open = true;
      }
      yield { type: "TEXT_MESSAGE_CONTENT", messageId, delta };
    }
  } catch (error) {
    if (open) yield { type: "TEXT_MESSAGE_END", messageId };
    yield {
      type: "RUN_ERROR",
      message: (error instanceof Error ? error.message : String(error)).slice(
        0,
        500,
      ),
    };
    return;
  }
  if (open) yield { type: "TEXT_MESSAGE_END", messageId };
  yield { type: "RUN_FINISHED", threadId, runId };
}
