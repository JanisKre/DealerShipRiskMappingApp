import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, MessageSquare, Plus, Trash2 } from "lucide-react";
import { useAppStore } from "@renderer/store/appStore";
import { ExecutiveSummary } from "@renderer/components/ai/ExecutiveSummary";
import { MessageBubble } from "@renderer/components/chat/MessageBubble";
import { useChat } from "@renderer/components/chat/useChat";
import { Button } from "@renderer/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu";
import { Omnibox } from "@renderer/components/upload/Omnibox";
import { cn } from "@renderer/lib/utils";
import { useConversationStore } from "@renderer/store/conversationStore";

/**
 * Right-hand chat dock in the workspace.
 *
 * Layout (similar to the Claude Code extension):
 *   - Header: active thread name + "+ New" + thread dropdown
 *   - Transcript: ExecutiveSummary (if data present), then messages
 *   - Composer at the bottom: Omnibox in "chat" + "dashboard" modes
 */
export function ChatPanel(): React.JSX.Element {
  const navigate = useNavigate();
  const hasData = useAppStore((s) => s.dealerships.length > 0);
  const loadList = useConversationStore((s) => s.loadList);
  const list = useConversationStore((s) => s.list);
  const activeId = useConversationStore((s) => s.activeId);
  const activeName = useConversationStore((s) => s.activeName);
  const selectConversation = useConversationStore((s) => s.selectConversation);
  const newConversation = useConversationStore((s) => s.newConversation);
  const deleteConversation = useConversationStore((s) => s.deleteConversation);

  const { messages, streamingText, streaming, error, send } = useChat();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load the conversation list on first render.
  useEffect(() => {
    void loadList();
  }, [loadList]);

  // Scroll to the end on new text/stream.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streamingText]);

  function onGenerateDashboard(_prompt: string): void {
    navigate("/dashboard");
  }

  const chatEmpty = messages.length === 0 && !streaming;

  // Compact thread picker — shows at most 12 earlier threads.
  const recentThreads = list.slice(0, 12);

  return (
    <div className="flex h-full min-w-0 flex-col border-l bg-card overflow-hidden">
      {/* Header: active thread + dropdown + new */}
      <div className="flex min-w-0 shrink-0 items-center gap-1 border-b px-3 py-2">
        <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-1 text-left text-sm font-medium hover:text-foreground"
              title="Switch thread"
            >
              <span className="truncate">{activeName}</span>
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {recentThreads.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                No threads yet.
              </p>
            ) : (
              recentThreads.map((t) => (
                <DropdownMenuItem
                  key={t.id}
                  onSelect={() => void selectConversation(t.id)}
                  className={cn(
                    "group justify-between gap-2",
                    t.id === activeId && "font-medium",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  <button
                    type="button"
                    aria-label="Delete thread"
                    title="Delete"
                    className="shrink-0 rounded p-0.5 opacity-0 hover:text-destructive group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      void deleteConversation(t.id);
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          onClick={newConversation}
          title="New chat thread"
          aria-label="New chat thread"
        >
          <Plus className="size-4" />
        </Button>
      </div>

      {/* Transcript + ExecutiveSummary */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {chatEmpty && !hasData ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
            <MessageSquare className="size-8 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">
              Ask about the portfolio or have an AI dashboard generated for
              you.
            </p>
          </div>
        ) : (
          <div className="space-y-4 px-4 py-4">
            {hasData && <ExecutiveSummary />}

            {(messages.length > 0 || streaming) && (
              <div className="space-y-3 border-t pt-4">
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
                {error && (
                  <p className="text-xs text-destructive">Error: {error}</p>
                )}
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
          onGenerateDashboard={onGenerateDashboard}
          disabled={streaming}
          compact
        />
      </div>
    </div>
  );
}
