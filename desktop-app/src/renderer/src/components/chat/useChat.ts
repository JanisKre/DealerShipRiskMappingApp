import { useEffect, useRef } from "react";
import type { ChatMessage } from "@shared/types";
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
}

/**
 * Encapsulates the chat send/stream logic (previously in `ChatArea`): starts
 * an LLM stream for the active conversation and commits the finished answer
 * exactly once into {@link useConversationStore}, including persistence.
 */
export function useChat(): UseChat {
  const dealerships = useAppStore((s) => s.dealerships);
  const messages = useConversationStore((s) => s.messages);
  const activeId = useConversationStore((s) => s.activeId);
  const { text, streaming, error, start } = useLlmStream();
  const committedRef = useRef(true);

  // Commit the finished stream answer exactly once + persist it.
  useEffect(() => {
    if (!streaming && text && !committedRef.current) {
      committedRef.current = true;
      const store = useConversationStore.getState();
      store.appendMessage({ role: "assistant", content: text });
      void store.persistActive();
    }
  }, [streaming, text]);

  function send(question: string): void {
    const q = question.trim();
    if (!q || streaming) return;
    const store = useConversationStore.getState();
    if (!store.activeId) store.newConversation();
    store.appendMessage({ role: "user", content: q });
    committedRef.current = false;
    start({
      kind: "chat",
      messages: useConversationStore.getState().messages.slice(-20),
      sessionContext: buildSessionContext(dealerships),
    });
    // Persist the user message immediately -> conversation appears in the list.
    void store.persistActive();
  }

  return { messages, activeId, streamingText: text, streaming, error, send };
}
