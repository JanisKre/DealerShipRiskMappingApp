import { useEffect, useRef } from "react";
import { LLM_CONTEXT_MAX_CHARS } from "@shared/ipc-schema";
import type { ChatMessage } from "@shared/types";
import { condenseHistory } from "@renderer/lib/chatAssist";
import { buildSessionContext } from "@renderer/lib/sessionContext";
import { useLlmStream } from "@renderer/lib/useLlmStream";
import { useAppStore } from "@renderer/store/appStore";
import { useConversationStore } from "@renderer/store/conversationStore";

export interface UseChat {
  messages: ChatMessage[];
  activeId: string | null;
  streamingText: string;
  streaming: boolean;
  error: string | null;
  send: (question: string) => void;
  /** Asks the last question again, replacing the answer after it. */
  regenerate: () => void;
  /** Stops the running answer; the text so far is kept. */
  stop: () => void;
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

  // Commit the finished (or stopped) stream answer exactly once + persist it.
  useEffect(() => {
    if (!streaming && text && !committedRef.current) {
      committedRef.current = true;
      const store = useConversationStore.getState();
      store.appendMessage({ role: "assistant", content: text });
      void store.persistActive();
    }
  }, [streaming, text]);

  /** Streams an answer to the conversation as it stands in the store. */
  function stream(): void {
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
    });
  }

  function send(question: string): void {
    const q = question.trim();
    if (!q || streaming) return;
    const store = useConversationStore.getState();
    if (!store.activeId) store.newConversation();
    store.appendMessage({ role: "user", content: q });
    stream();
    // Persist the user message immediately -> conversation appears in the list.
    void store.persistActive();
  }

  function regenerate(): void {
    if (streaming) return;
    const store = useConversationStore.getState();
    if (!store.messages.some((m) => m.role === "user")) return;
    store.truncateAfterLastUser();
    stream();
  }

  return {
    messages,
    activeId,
    streamingText: text,
    streaming,
    error,
    send,
    regenerate,
    stop: cancel,
  };
}
