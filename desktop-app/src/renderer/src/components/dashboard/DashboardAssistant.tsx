import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { MessageSquare, Plus, X } from "lucide-react";
import { useChat } from "@renderer/components/chat/useChat";
import { MessageBubble } from "@renderer/components/chat/MessageBubble";
import { Omnibox } from "@renderer/components/upload/Omnibox";
import { Button } from "@renderer/components/ui/button";
import { useConversationStore } from "@renderer/store/conversationStore";

export function DashboardAssistant({
  onClose,
  onDashboardCommand,
}: Readonly<{
  onClose: () => void;
  onDashboardCommand: (prompt: string) => string | null;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const { messages, streamingText, streaming, error, send } = useChat();
  const newConversation = useConversationStore((s) => s.newConversation);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, streamingText]);

  function submit(prompt: string): void {
    const commandResult = onDashboardCommand(prompt);
    send(prompt);
    if (commandResult) {
      useConversationStore.getState().appendMessage({
        role: "assistant",
        content: commandResult,
      });
    }
  }

  const examplePrompts = [
    t("dashboard.examplePromptTable"),
    t("dashboard.examplePromptSeasonal"),
    t("dashboard.examplePromptRisk"),
  ];

  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-l bg-card shadow-xl md:w-80 lg:w-96">
      <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2.5">
        <MessageSquare className="size-4 text-primary" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">
            {t("dashboard.assistantTitle")}
          </h2>
          <p className="truncate text-xs text-muted-foreground">
            {t("dashboard.assistantDescription")}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={newConversation}
          title={t("ui.newChatThread")}
          aria-label={t("ui.newChatThread")}
        >
          <Plus className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={onClose}
          title={t("dashboard.closeAssistant")}
          aria-label={t("dashboard.closeAssistant")}
        >
          <X className="size-4" />
        </Button>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {messages.length === 0 && !streaming ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-3 text-center">
            <MessageSquare className="size-7 text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground">
              {t("dashboard.assistantEmpty")}
            </p>
            <div className="mt-2 flex flex-wrap justify-center gap-1.5">
              {examplePrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className="rounded-full border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  onClick={() => submit(prompt)}
                  disabled={streaming}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((message, index) => (
              <MessageBubble
                key={`${index}-${message.role}-${message.content.slice(0, 16)}`}
                role={message.role}
                content={message.content}
              />
            ))}
            {streaming && (
              <MessageBubble role="assistant" content={streamingText} pending />
            )}
            {error && (
              <p className="text-xs text-destructive">
                {t("ui.error", { error })}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t bg-background px-3 py-3">
        <Omnibox
          modes={["chat"]}
          onPickAddress={() => undefined}
          onAskQuestion={submit}
          disabled={streaming}
          compact
        />
        <p className="mt-1 px-1 text-[10px] text-muted-foreground">
          {t("dashboard.assistantHint")}
        </p>
      </div>
    </aside>
  );
}
