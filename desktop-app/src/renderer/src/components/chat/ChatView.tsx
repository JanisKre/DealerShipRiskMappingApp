import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Database, Info, MessageSquare, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { RISK_MODEL_VERSION } from "@shared/constants";
import { defaultDashboardSurface } from "@shared/a2ui";
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
  mentionsDashboard,
  parseChatAction,
  type ChatAction,
} from "@renderer/lib/chatAssist";
import { useLlmReady } from "@renderer/lib/useLlmReady";
import { useAppStore } from "@renderer/store/appStore";
import { useConversationStore } from "@renderer/store/conversationStore";
import { useDashboardStore } from "@renderer/store/dashboardStore";
import { useMapStore } from "@renderer/store/mapStore";
import { ConversationPicker } from "./ConversationPicker";
import { MessageBubble } from "./MessageBubble";
import { useChat } from "./useChat";
import { portfolioName } from "@renderer/lib/portfolioName";

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
  dashboardPage = false,
  draft,
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
  /**
   * On the dashboard page, changes ("wechsle zu Zone 2") apply to the AI
   * dashboard on screen; elsewhere only new dashboards can be requested.
   */
  dashboardPage?: boolean;
  /** Sentence start to put into the composer (see Omnibox `draft`). */
  draft?: { text: string; key: number };
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
    respond,
  } = useChat();
  const llmReady = useLlmReady();
  const scrollRef = useRef<HTMLDivElement>(null);
  /** A local action (e.g. building a dashboard) is still running. */
  const [actionPending, setActionPending] = useState(false);
  const shownDashboard = useDashboardStore((s) =>
    dashboardPage ? (s.active?.name ?? null) : null,
  );
  const canEditDashboard = shownDashboard != null;
  const dashboardBuilding = useDashboardStore((s) => s.building);
  /** Replies the app wrote itself (no AI answer to regenerate). */
  const appReplies = useRef(new Set<string>());

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streamingText, actionPending]);

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
      case "dashboard":
        return buildDashboard(action.prompt, action.mode);
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

  /**
   * Builds or changes an AI dashboard and shows it. Without an AI provider
   * a new request gets the starter template, which the AI can adapt later.
   */
  async function buildDashboard(
    prompt: string,
    mode: "create" | "edit",
  ): Promise<string> {
    const dashboards = useDashboardStore.getState();
    if (llmReady === false) {
      if (mode === "edit") return t("chat.actions.dashboardNeedsAi");
      const surface = defaultDashboardSurface(
        {
          title: t("a2ui.template.title"),
          count: t("a2ui.measure.count"),
          eal: t("a2ui.measure.eal"),
          exposure: t("a2ui.measure.exposure"),
          vehicles: t("a2ui.measure.vehicles"),
          byZone: t("a2ui.template.byZone"),
          topEal: t("a2ui.template.topEal"),
          table: t("a2ui.template.table"),
        },
        crypto.randomUUID(),
      );
      const dashboard = await dashboards.saveNew(surface, prompt);
      void navigate("/dashboard");
      return t("chat.actions.dashboardTemplate", { name: dashboard.name });
    }
    const outcome = await dashboards.build(prompt, mode);
    if (!outcome.ok)
      return t("chat.actions.dashboardFailed", {
        count: outcome.issues.length,
        detail: outcome.issues
          .slice(0, 2)
          .map((i) => i.message)
          .join("; "),
      });
    void navigate("/dashboard");
    return t(
      outcome.created
        ? "chat.actions.dashboardCreated"
        : "chat.actions.dashboardUpdated",
      { name: outcome.dashboard.name },
    );
  }

  /** Local commands answer instantly; everything else goes to the AI. */
  function submit(prompt: string): void {
    const text = prompt.trim();
    if (!text || streaming || actionPending) return;
    const commandReply = onCommand?.(text) ?? null;
    const action = commandReply
      ? null
      : parseChatAction(text, locations, { canEditDashboard });
    const appendUser = (): void => {
      const store = useConversationStore.getState();
      if (!store.activeId) store.newConversation();
      store.appendMessage({ role: "user", content: text });
    };
    if (commandReply || action) {
      appendUser();
      reply(
        commandReply
          ? Promise.resolve(commandReply)
          : runAction(action as ChatAction),
      );
      return;
    }
    if (llmReady === false) {
      toast.info(t("chat.needsAi"));
      return;
    }
    // Wording alone was not clear: with a dashboard on screen (or when the
    // message is about dashboards) a short AI call decides whether it asks
    // for a new dashboard, a change, or is an ordinary question.
    if (canEditDashboard || mentionsDashboard(text)) {
      appendUser();
      setActionPending(true);
      void window.api
        .classifyChatIntent({ message: text, dashboardTitle: shownDashboard })
        .catch(() => ({ intent: "chat" as const }))
        .then(({ intent }) => {
          if (intent === "chat") {
            setActionPending(false);
            respond();
          } else {
            reply(buildDashboard(text, intent));
          }
        });
      return;
    }
    send(text);
  }

  /** Shows an app reply (command, action) once it is ready. */
  function reply(content: Promise<string>): void {
    setActionPending(true);
    void content
      .catch((err: unknown) =>
        t("chat.actions.failed", { error: (err as Error).message }),
      )
      .then((text) => {
        appReplies.current.add(text);
        useConversationStore
          .getState()
          .appendMessage({ role: "assistant", content: text });
        void useConversationStore.getState().persistActive();
      })
      .finally(() => setActionPending(false));
  }

  const lastAssistant = messages.map((m) => m.role).lastIndexOf("assistant");
  /** Replies to local commands are app messages, not AI answers: there is
      nothing to regenerate. */
  function answersCommand(index: number): boolean {
    if (appReplies.current.has(messages[index]?.content ?? "")) return true;
    for (let i = index - 1; i >= 0; i--) {
      if (messages[i].role !== "user") continue;
      const q = messages[i].content;
      return (
        parseChatAction(q, locations, { canEditDashboard: true }) !== null ||
        (isCommand?.(q) ?? false)
      );
    }
    return true;
  }
  const empty = messages.length === 0 && !streaming && !actionPending;

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
            portfolio: portfolioName(sessionName, t),
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
            {/* A chat log: new answers are announced once complete
                (aria-busy holds them back while tokens stream in). */}
            <div
              role="log"
              aria-live="polite"
              aria-relevant="additions"
              aria-busy={streaming || actionPending}
              className="space-y-4 px-4 py-4"
            >
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
              {actionPending && (
                <MessageBubble
                  role="assistant"
                  content=""
                  pending
                  pendingLabel={
                    dashboardBuilding
                      ? shownDashboard
                        ? t("a2ui.updating")
                        : t("a2ui.building")
                      : undefined
                  }
                />
              )}
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
          disabled={streaming || actionPending}
          onStop={streaming ? stop : undefined}
          draft={draft}
          compact
        />
      </div>
    </div>
  );
}
