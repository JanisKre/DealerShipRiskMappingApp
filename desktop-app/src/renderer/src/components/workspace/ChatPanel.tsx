import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronsUpDown,
  History,
  MessageSquare,
  Plus,
  Trash2,
} from "lucide-react";
import {
  LlmErrorMessage,
  LlmSetupNotice,
} from "@renderer/components/ai/LlmSetupNotice";
import { MessageBubble } from "@renderer/components/chat/MessageBubble";
import { useChat } from "@renderer/components/chat/useChat";
import { Button } from "@renderer/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@renderer/components/ui/popover";
import { Omnibox } from "@renderer/components/upload/Omnibox";
import { useLlmReady } from "@renderer/lib/useLlmReady";
import { cn } from "@renderer/lib/utils";
import {
  NEW_CONVERSATION_TITLE,
  useConversationStore,
} from "@renderer/store/conversationStore";

/**
 * Right-hand chat dock in the workspace.
 *
 * Layout (similar to the Claude Code extension):
 *   - Header: active thread name + "+ New" + thread dropdown
 *   - Transcript: the thread's messages
 *   - Composer at the bottom: Omnibox in chat mode
 */
export function ChatPanel(): React.JSX.Element {
  const { t } = useTranslation();
  const loadList = useConversationStore((s) => s.loadList);
  const list = useConversationStore((s) => s.list);
  const activeId = useConversationStore((s) => s.activeId);
  const activeName = useConversationStore((s) => s.activeName);
  const selectConversation = useConversationStore((s) => s.selectConversation);
  const newConversation = useConversationStore((s) => s.newConversation);
  const deleteConversation = useConversationStore((s) => s.deleteConversation);

  const { messages, streamingText, streaming, error, send } = useChat();
  const llmReady = useLlmReady();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load the conversation list on first render.
  useEffect(() => {
    void loadList();
  }, [loadList]);

  // Scroll to the end on new text/stream.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streamingText]);

  const chatEmpty = messages.length === 0 && !streaming;

  // Compact thread picker — shows at most 12 earlier threads.
  const recentThreads = list.slice(0, 12);

  return (
    <div className="flex h-full min-w-0 flex-col border-l bg-card overflow-hidden">
      {/* Header: active thread + dropdown + new */}
      <div className="flex min-w-0 shrink-0 items-center gap-1 border-b px-3 py-2">
        <ConversationPicker
          conversations={recentThreads}
          activeId={activeId}
          activeName={activeName}
          onSelect={(id) => void selectConversation(id)}
          onNew={newConversation}
          onDelete={(id) => void deleteConversation(id)}
        />

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          onClick={newConversation}
          title={t("ui.newChatThread")}
          aria-label={t("ui.newChatThread")}
        >
          <Plus className="size-4" />
        </Button>
      </div>

      {/* Transcript */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {llmReady === false ? (
          <div className="flex h-full items-center justify-center px-4">
            <LlmSetupNotice />
          </div>
        ) : chatEmpty ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
            <MessageSquare className="size-8 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">{t("ui.emptyChat")}</p>
          </div>
        ) : (
          <div className="space-y-4 px-4 py-4">
            {(messages.length > 0 || streaming) && (
              <div className="space-y-3">
                {messages.map((m, i) => (
                  <MessageBubble
                    key={`${activeId}-${i}-${m.role}`}
                    role={m.role}
                    content={m.content}
                  />
                ))}
                {streaming && (
                  <MessageBubble
                    role="assistant"
                    content={streamingText}
                    pending
                  />
                )}
                {error && <LlmErrorMessage error={error} />}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Composer: chat + dashboard only (no address input in the right dock) */}
      <div className="shrink-0 border-t bg-background px-3 py-3">
        <Omnibox
          modes={["chat"]}
          onPickAddress={() => {
            /* not active — address mode hidden */
          }}
          onAskQuestion={send}
          disabled={streaming || llmReady === false}
          compact
        />
      </div>
    </div>
  );
}

/** Display name of a thread; the store keeps an English sentinel for new ones. */
function threadName(
  name: string,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  return name === NEW_CONVERSATION_TITLE ? t("ui.newConversation") : name;
}

/**
 * Thread picker built like the portfolio switcher: a two-line trigger, a
 * "new" action on top, then the history with name + date per thread, the
 * open one highlighted and a confirmed delete on hover.
 */
function ConversationPicker({
  conversations,
  activeId,
  activeName,
  onSelect,
  onNew,
  onDelete,
}: Readonly<{
  conversations: Array<{ id: string; name: string; updatedAt: string }>;
  activeId: string | null;
  activeName: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}>): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null,
  );
  const formatDate = (iso: string): string =>
    new Date(iso).toLocaleString(i18n.language, {
      dateStyle: "short",
      timeStyle: "short",
    });

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setConfirmingDeleteId(null);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-accent"
          aria-label={t("ui.switchThread")}
        >
          <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold leading-tight">
            {threadName(activeName, t)}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      {/* Right-aligned with collision padding: the chat dock sits at the
          window's right edge, so a left-aligned menu ran off-screen. */}
      <PopoverContent
        align="end"
        collisionPadding={8}
        className="w-80 max-w-[calc(100vw-1rem)] p-1"
      >
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
          onClick={() => {
            onNew();
            setOpen(false);
          }}
        >
          <Plus className="size-4" />
          {t("ui.newConversation")}
        </button>
        <div className="my-1 h-px bg-border" />
        <div className="flex items-center gap-1.5 px-2 py-1 text-sm font-semibold">
          <History className="size-3.5" />
          {t("ui.chatHistory")}
        </div>
        <div className="max-h-72 overflow-y-auto">
          {conversations.length === 0 && (
            <p className="px-2 py-2 text-xs text-muted-foreground">
              {t("ui.noThreads")}
            </p>
          )}
          {conversations.map((conversation) => (
            <div
              key={conversation.id}
              className={cn(
                "group rounded-sm px-2 py-1.5",
                conversation.id === activeId && "bg-accent",
              )}
            >
              {confirmingDeleteId === conversation.id ? (
                <div className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate text-destructive">
                    {t("ui.deleteThreadConfirm", {
                      name: threadName(conversation.name, t),
                    })}
                  </span>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-7 shrink-0 px-2"
                    onClick={() => {
                      onDelete(conversation.id);
                      setConfirmingDeleteId(null);
                    }}
                  >
                    {t("ui.delete")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 shrink-0 px-2"
                    onClick={() => setConfirmingDeleteId(null)}
                  >
                    {t("common.cancel")}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => {
                      onSelect(conversation.id);
                      setOpen(false);
                    }}
                  >
                    <span className="block truncate text-sm font-medium">
                      {threadName(conversation.name, t)}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {formatDate(conversation.updatedAt)}
                    </span>
                  </button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-7 shrink-0 text-destructive opacity-0 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() => setConfirmingDeleteId(conversation.id)}
                    aria-label={`${t("ui.deleteThread")}: ${threadName(conversation.name, t)}`}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
