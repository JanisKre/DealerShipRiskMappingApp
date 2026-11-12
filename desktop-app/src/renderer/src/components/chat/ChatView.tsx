import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Database, Info, MessageSquare, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { RISK_MODEL_VERSION } from "@shared/constants";
import {
  LlmErrorMessage,
  LlmSetupNotice,
} from "@renderer/components/ai/LlmSetupNotice";
import { LocationLinkContext } from "@renderer/components/ai/Markdown";
import { Button } from "@renderer/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@renderer/components/ui/popover";
import { Omnibox } from "@renderer/components/upload/Omnibox";
import {
  linkifyLocations,
  parseChatAction,
  type ChatAction,
} from "@renderer/lib/chatAssist";
import { useLlmReady } from "@renderer/lib/useLlmReady";
import { useAppStore } from "@renderer/store/appStore";
import { useConversationStore } from "@renderer/store/conversationStore";
import { useMapStore } from "@renderer/store/mapStore";
import { ConversationPicker } from "./ConversationPicker";
import { MessageBubble } from "./MessageBubble";
import { useChat } from "./useChat";

/** Earlier threads shown in the picker. */
const RECENT_THREADS = 12;

/**
 * The portfolio chat, identical on the map and the dashboard: thread picker,
 * a line stating what the AI sees, the transcript with clickable locations,
 * provenance, copy and regenerate, context-aware example prompts, local
 * commands ("öffne …", "zeige … auf der Karte", "exportiere …") and a stop
 * button while an answer streams. Files are imported only through the
 * locations list, not through the chat.
 */
export function ChatView({
  onClose,
  onOpenLocation,
  onShowLocation,
  onCommand,
  isCommand,
  extraPrompts = [],
}: Readonly<{
  /** Close button in the header (dashboard side panel). */
  onClose?: () => void;
  /** Opens the detail dialog of a location. */
  onOpenLocation: (id: string) => void;
  /** Shows a location on the map. */
  onShowLocation: (id: string) => void;
  /** Page-specific local commands (dashboard tiles); returns the reply. */
  onCommand?: (prompt: string) => string | null;
  /** Recognises those page commands without running them. */
  isCommand?: (prompt: string) => boolean;
  /** Page-specific example prompts shown before the general ones. */
  extraPrompts?: string[];
}>): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dealerships = useAppStore((s) => s.dealerships);
  const sessionName = useAppStore((s) => s.sessionName);
  const selectedId = useAppStore((s) => s.selectedId);
  const list = useConversationStore((s) => s.list);
  const activeName = useConversationStore((s) => s.activeName);
  const loadList = useConversationStore((s) => s.loadList);
  const selectConversation = useConversationStore((s) => s.selectConversation);
  const newConversation = useConversationStore((s) => s.newConversation);
  const renameConversation = useConversationStore((s) => s.renameConversation);
  const deleteConversation = useConversationStore((s) => s.deleteConversation);
  const {
    messages,
    activeId,
    streamingText,
    streaming,
    error,
    send,
    regenerate,
    stop,
  } = useChat();
  const llmReady = useLlmReady();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streamingText]);

  const locations = useMemo(
    () => dealerships.map((d) => ({ id: d.id, name: d.name })),
    [dealerships],
  );
  const selected = dealerships.find((d) => d.id === selectedId) ?? null;

  // Context-aware starters: about the selected location, else the portfolio.
  const prompts = [
    ...extraPrompts,
    ...(selected
      ? [
          t("chat.prompts.whyLocation", { name: selected.name }),
          t("chat.prompts.compareNeighbours", { name: selected.name }),
        ]
      : [t("chat.prompts.topEal"), t("chat.prompts.summary")]),
  ];

  async function runAction(action: ChatAction): Promise<string> {
    switch (action.type) {
      case "open":
        onOpenLocation(action.id);
        return t("chat.actions.opened", { name: action.name });
      case "showOnMap":
        onShowLocation(action.id);
        return t("chat.actions.shown", { name: action.name });
      case "layer":
        useMapStore.getState().setLayers({ [action.layer]: true });
        void navigate("/");
        return t(`chat.actions.layer.${action.layer}`);
      case "export": {
        const { path } = await window.api.exportReport(
          useAppStore.getState().currentSession(),
          action.format,
        );
        return path
          ? t("chat.actions.exported", { path })
          : t("chat.actions.exportCancelled");
      }
    }
  }

  /** Local commands answer instantly; everything else goes to the AI. */
  function submit(prompt: string): void {
    const text = prompt.trim();
    if (!text || streaming) return;
    const commandReply = onCommand?.(text) ?? null;
    const action = commandReply ? null : parseChatAction(text, locations);
    if (commandReply || action) {
      const store = useConversationStore.getState();
      if (!store.activeId) store.newConversation();
      store.appendMessage({ role: "user", content: text });
      const reply = commandReply
        ? Promise.resolve(commandReply)
        : runAction(action as ChatAction);
      void reply
        .catch((err: unknown) =>
          t("chat.actions.failed", { error: (err as Error).message }),
        )
        .then((content) => {
          store.appendMessage({ role: "assistant", content });
          void useConversationStore.getState().persistActive();
        });
      return;
    }
    if (llmReady === false) {
      toast.info(t("chat.needsAi"));
      return;
    }
    send(text);
  }

  const lastAssistant = messages.map((m) => m.role).lastIndexOf("assistant");
  /** Replies to local commands are app messages, not AI answers: there is
      nothing to regenerate. */
  function answersCommand(index: number): boolean {
    for (let i = index - 1; i >= 0; i--) {
      if (messages[i].role !== "user") continue;
      const q = messages[i].content;
      return (
        parseChatAction(q, locations) !== null || (isCommand?.(q) ?? false)
      );
    }
    return true;
  }
  const empty = messages.length === 0 && !streaming;

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden border-l bg-card">
      <div className="flex min-w-0 shrink-0 items-center gap-1 border-b px-3 py-2">
        <ConversationPicker
          conversations={list.slice(0, RECENT_THREADS)}
          activeId={activeId}
          activeName={activeName}
          onSelect={(id) => void selectConversation(id)}
          onRename={(id, name) => void renameConversation(id, name)}
          onDelete={(id) => void deleteConversation(id)}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          onClick={newConversation}
          aria-label={t("ui.newChatThread")}
        >
          <Plus className="size-4" />
        </Button>
        {onClose && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            onClick={onClose}
            aria-label={t("dashboard.closeAssistant")}
          >
            <X className="size-4" />
          </Button>
        )}
      </div>

      {/* What the AI sees, and — once, behind the ⓘ — what its answers rest
          on and what they are not, instead of a note under every answer. */}
      <div className="flex shrink-0 items-start gap-1.5 border-b bg-muted/30 px-3 py-1.5 text-[11px] leading-snug text-muted-foreground">
        <Database className="mt-px size-3 shrink-0" />
        <span className="min-w-0 flex-1">
          {t("chat.context", {
            portfolio: sessionName,
            count: dealerships.length,
          })}
          {selected && (
            <>
              {" · "}
              {t("chat.contextSelected", { name: selected.name })}
            </>
          )}
        </span>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="-my-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full hover:bg-accent hover:text-foreground"
              aria-label={t("chat.provenanceLabel")}
            >
              <Info className="size-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            collisionPadding={8}
            className="w-72 p-3 text-xs leading-relaxed"
          >
            {t("chat.provenance", { model: RISK_MODEL_VERSION })}
          </PopoverContent>
        </Popover>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {llmReady === false && (
          <div className="px-4 pt-4">
            <LlmSetupNotice />
          </div>
        )}
        {empty ? (
          <div className="flex min-h-full flex-col items-center justify-center gap-3 px-4 py-6 text-center">
            <MessageSquare className="size-8 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">
              {t("chat.emptyChat")}
            </p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {prompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className="rounded-full border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  onClick={() => submit(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <LocationLinkContext.Provider value={onOpenLocation}>
            <div className="space-y-4 px-4 py-4">
              {messages.map((m, i) => (
                <MessageBubble
                  key={`${activeId}-${i}-${m.role}`}
                  role={m.role}
                  content={
                    m.role === "assistant"
                      ? linkifyLocations(m.content, locations)
                      : m.content
                  }
                  latest={i === lastAssistant}
                  onRegenerate={
                    i === lastAssistant &&
                    !streaming &&
                    llmReady !== false &&
                    !answersCommand(i)
                      ? regenerate
                      : undefined
                  }
                />
              ))}
              {streaming && (
                <MessageBubble
                  role="assistant"
                  content={linkifyLocations(streamingText, locations)}
                  pending
                />
              )}
              {error && <LlmErrorMessage error={error} />}
            </div>
          </LocationLinkContext.Provider>
        )}
      </div>

      <div className="shrink-0 border-t bg-background px-3 py-3">
        <Omnibox
          modes={["chat"]}
          onPickAddress={() => undefined}
          onAskQuestion={submit}
          disabled={streaming}
          onStop={streaming ? stop : undefined}
          compact
        />
      </div>
    </div>
  );
}
