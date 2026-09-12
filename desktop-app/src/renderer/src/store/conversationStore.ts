import { create } from "zustand";
import type { ChatMessage, Conversation } from "@shared/types";

/**
 * Store for the persisted chat history: a list of persisted conversations
 * (left) plus the messages of the active conversation (right). Persistence
 * runs over SQLite (`window.api.*Conversation*`); the store keeps only the
 * active conversation fully in memory.
 */

/** Sentinel title for a not-yet-named (fresh) conversation. */
export const NEW_CONVERSATION_TITLE = "New Conversation";

interface ConversationMeta {
  id: string;
  name: string;
  updatedAt: string;
}

interface ConversationState {
  list: ConversationMeta[];
  activeId: string | null;
  activeName: string;
  activeCreatedAt: string | null;
  messages: ChatMessage[];

  loadList: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  newConversation: () => void;
  appendMessage: (m: ChatMessage) => void;
  replaceLast: (content: string) => void;
  persistActive: () => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
}

/** Title heuristic: first line of the first user message, truncated to ~40 characters. */
function deriveTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  const line = firstUser?.content.split("\n")[0]?.trim() ?? "";
  if (!line) return NEW_CONVERSATION_TITLE;
  return line.length > 40 ? `${line.slice(0, 40).trimEnd()}…` : line;
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  list: [],
  activeId: null,
  activeName: NEW_CONVERSATION_TITLE,
  activeCreatedAt: null,
  messages: [],

  loadList: async () => {
    const list = await window.api.listConversations();
    set({ list });
  },

  selectConversation: async (id) => {
    const conv = await window.api.loadConversation(id);
    if (!conv) return;
    set({
      activeId: conv.id,
      activeName: conv.name,
      activeCreatedAt: conv.createdAt,
      messages: conv.messages,
    });
  },

  newConversation: () => {
    set({
      activeId: crypto.randomUUID(),
      activeName: NEW_CONVERSATION_TITLE,
      activeCreatedAt: new Date().toISOString(),
      messages: [],
    });
  },

  appendMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),

  replaceLast: (content) =>
    set((s) => {
      if (s.messages.length === 0) return s;
      const copy = [...s.messages];
      copy[copy.length - 1] = { ...copy[copy.length - 1], content };
      return { messages: copy };
    }),

  persistActive: async () => {
    const { activeId, activeName, activeCreatedAt, messages } = get();
    if (messages.length === 0) return;
    const now = new Date().toISOString();
    const id = activeId ?? crypto.randomUUID();
    // Title from the first question on the first exchange.
    const name =
      activeName === NEW_CONVERSATION_TITLE
        ? deriveTitle(messages)
        : activeName;
    const conversation: Conversation = {
      id,
      name,
      createdAt: activeCreatedAt ?? now,
      updatedAt: now,
      messages,
    };
    set({
      activeId: id,
      activeName: name,
      activeCreatedAt: conversation.createdAt,
    });
    await window.api.saveConversation(conversation);
    await get().loadList();
  },

  deleteConversation: async (id) => {
    await window.api.deleteConversation(id);
    if (get().activeId === id) {
      set({
        activeId: null,
        activeName: NEW_CONVERSATION_TITLE,
        activeCreatedAt: null,
        messages: [],
      });
    }
    await get().loadList();
  },
}));
