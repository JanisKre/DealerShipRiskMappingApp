import { create } from "zustand";
import type { ChatMessage, Conversation } from "@shared/types";
import { deriveConversationTitle, isGreeting } from "@renderer/lib/chatAssist";

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
  /** Name was derived automatically and may still improve (e.g. "hallo"). */
  activeNameAuto: boolean;
  activeCreatedAt: string | null;
  messages: ChatMessage[];

  loadList: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  newConversation: () => void;
  appendMessage: (m: ChatMessage) => void;
  replaceLast: (content: string) => void;
  /** Drops everything after the last user message (for "regenerate"). */
  truncateAfterLastUser: () => void;
  renameConversation: (id: string, name: string) => Promise<void>;
  persistActive: () => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
}

/** Title heuristic: the first real question (greetings skipped), ~40 chars. */
function deriveTitle(messages: ChatMessage[]): string {
  return deriveConversationTitle(messages, NEW_CONVERSATION_TITLE);
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  list: [],
  activeId: null,
  activeName: NEW_CONVERSATION_TITLE,
  activeNameAuto: true,
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
      // A greeting title ("hallo") is replaced once a real question follows.
      activeNameAuto: isGreeting(conv.name),
      activeCreatedAt: conv.createdAt,
      messages: conv.messages,
    });
  },

  newConversation: () => {
    set({
      activeId: crypto.randomUUID(),
      activeName: NEW_CONVERSATION_TITLE,
      activeNameAuto: true,
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

  truncateAfterLastUser: () =>
    set((s) => {
      let last = s.messages.length - 1;
      while (last >= 0 && s.messages[last].role !== "user") last--;
      return { messages: s.messages.slice(0, last + 1) };
    }),

  renameConversation: async (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (id === get().activeId) {
      set({ activeName: trimmed, activeNameAuto: false });
      if (get().messages.length > 0) await get().persistActive();
      return;
    }
    const conv = await window.api.loadConversation(id);
    if (!conv) return;
    await window.api.saveConversation({ ...conv, name: trimmed });
    await get().loadList();
  },

  persistActive: async () => {
    const { activeId, activeName, activeNameAuto, activeCreatedAt, messages } =
      get();
    if (messages.length === 0) return;
    const now = new Date().toISOString();
    const id = activeId ?? crypto.randomUUID();
    // Title from the first real question; an automatic title keeps
    // improving (a "hallo" opener is replaced by the next question).
    const name =
      activeName === NEW_CONVERSATION_TITLE || activeNameAuto
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
        activeNameAuto: true,
        activeCreatedAt: null,
        messages: [],
      });
    }
    await get().loadList();
  },
}));
