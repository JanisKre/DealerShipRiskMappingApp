import { useEffect, useRef, useState } from "react";
import { LLM_CONTEXT_MAX_CHARS } from "@shared/ipc-schema";
import type { ChatMessage } from "@shared/types";
import { condenseHistory } from "@renderer/lib/chatAssist";
import {
  mayNeedLookups,
  plannerLocations,
  runChatLookups,
  type LookupRun,
} from "@renderer/lib/chatLookups";
import { buildSessionContext } from "@renderer/lib/sessionContext";
import { useLlmStream } from "@renderer/lib/useLlmStream";
import { useAppStore } from "@renderer/store/appStore";
import { useConversationStore } from "@renderer/store/conversationStore";

export interface UseChat {
  messages: ChatMessage[];
  activeId: string | null;
  streamingText: string;
  /** True while lookups run or the answer streams. */
  streaming: boolean;
  /** True while the optional lookups for the question run. */
  lookingUp: boolean;
  /** Lookups behind the latest answer; null when none ran. */
  lookups: LookupRun["done"] | null;
  error: string | null;
  send: (question: string) => void;
  /** Asks the last question again, replacing the answer after it. */
  regenerate: () => void;
  /** Stops the running answer; the text so far is kept. */
  stop: () => void;
  /** Answers the last user message, which the caller already appended. */
  respond: () => void;
}

/**
 * Encapsulates the chat send/stream logic (previously in `ChatArea`): starts
 * an LLM stream for the active conversation and commits the finished answer
 * exactly once into {@link useConversationStore}, including persistence.
 */
export function useChat(): UseChat {
  const dealerships = useAppStore((s) => s.dealerships);
  const parameters = useAppStore((s) => s.parameters);
  const selectedId = useAppStore((s) => s.selectedId);
  const messages = useConversationStore((s) => s.messages);
  const activeId = useConversationStore((s) => s.activeId);
  const { text, streaming, error, start, cancel } = useLlmStream();
  const committedRef = useRef(true);
  const [lookingUp, setLookingUp] = useState(false);
  const [lookups, setLookups] = useState<LookupRun["done"] | null>(null);
  /** Bumped by stop/new requests so a finished lookup does not start a stale answer. */
  const requestRef = useRef(0);

  // Commit the finished (or stopped) stream answer exactly once + persist it.
  useEffect(() => {
    if (!streaming && text && !committedRef.current) {
      committedRef.current = true;
      const store = useConversationStore.getState();
      store.appendMessage({ role: "assistant", content: text });
      void store.persistActive();
    }
  }, [streaming, text]);

  /**
   * Optional lookups before the answer: only with an AI provider (the chat
   * needs one anyway) and only when the question can refer to a location.
   * Any failure means an answer from the portfolio context alone.
   */
  async function lookUp(question: string): Promise<string | undefined> {
    if (!mayNeedLookups(question, dealerships, selectedId)) return undefined;
    try {
      const { calls } = await window.api.planChatTools({
        question: question.slice(0, 2_000),
        locations: plannerLocations(dealerships, selectedId),
        selectedId,
      });
      if (calls.length === 0) return undefined;
      const run = await runChatLookups(calls, dealerships, window.api);
      setLookups(run.done);
      return run.results || undefined;
    } catch {
      return undefined;
    }
  }

  /** Streams an answer to the conversation as it stands in the store. */
  async function stream(): Promise<void> {
    const request = ++requestRef.current;
    setLookups(null);
    const question = [...useConversationStore.getState().messages]
      .reverse()
      .find((m) => m.role === "user")?.content;
    let toolResults: string | undefined;
    if (question) {
      setLookingUp(true);
      try {
        toolResults = await lookUp(question);
      } finally {
        setLookingUp(false);
      }
    }
    if (request !== requestRef.current) return;
    committedRef.current = false;
    // The request carries at most 20 messages; older turns travel as a
    // condensed note inside the (data-only) portfolio context instead of
    // being dropped.
    const { recent, note } = condenseHistory(
      useConversationStore.getState().messages,
    );
    const portfolio = buildSessionContext(dealerships, {
      parameters,
      selectedId,
    });
    const memory = note
      ? `\n\nEarlier part of this conversation (condensed, oldest first):\n${note}`
      : "";
    start({
      kind: "chat",
      messages: recent,
      sessionContext: (portfolio + memory).slice(0, LLM_CONTEXT_MAX_CHARS),
      toolResults,
    });
  }

  const busy = streaming || lookingUp;

  function send(question: string): void {
    const q = question.trim();
    if (!q || busy) return;
    const store = useConversationStore.getState();
    if (!store.activeId) store.newConversation();
    store.appendMessage({ role: "user", content: q });
    void stream();
    // Persist the user message immediately -> conversation appears in the list.
    void store.persistActive();
  }

  function respond(): void {
    if (busy) return;
    void stream();
    void useConversationStore.getState().persistActive();
  }

  function regenerate(): void {
    if (busy) return;
    const store = useConversationStore.getState();
    if (!store.messages.some((m) => m.role === "user")) return;
    store.truncateAfterLastUser();
    void stream();
  }

  return {
    messages,
    activeId,
    streamingText: text,
    streaming: busy,
    lookingUp,
    lookups,
    error,
    send,
    regenerate,
    respond,
    stop: () => {
      requestRef.current++;
      setLookingUp(false);
      cancel();
    },
  };
}
