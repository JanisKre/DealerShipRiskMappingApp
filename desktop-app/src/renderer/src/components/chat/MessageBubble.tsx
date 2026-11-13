import { useTranslation } from "react-i18next";
import { Copy, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import type { ChatMessage } from "@shared/types";
import { stripLocationLinks } from "@renderer/lib/chatAssist";
import { cn } from "@renderer/lib/utils";
import { Markdown } from "@renderer/components/ai/Markdown";

/**
 * One chat message. Questions sit right in a compact bubble; answers run
 * full width as Markdown, without avatars, so the narrow dock keeps its
 * width for text. Copy (and regenerate on the latest answer) appear on
 * hover or keyboard focus, and stay visible on the latest answer.
 */
export function MessageBubble({
  role,
  content,
  pending,
  pendingLabel,
  latest,
  onRegenerate,
}: Readonly<{
  role: ChatMessage["role"];
  content: string;
  pending?: boolean;
  /** Shown next to the spinner while an app action runs. */
  pendingLabel?: string;
  /** Latest answer: its actions stay visible instead of hover-only. */
  latest?: boolean;
  onRegenerate?: () => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const isUser = role === "user";

  async function copy(): Promise<void> {
    try {
      // Through the main process: navigator.clipboard is unavailable because
      // the app denies all renderer permission requests.
      // The displayed answer carries in-app location links; copy plain text.
      await window.api.writeClipboardText(stripLocationLinks(content));
      toast.success(t("chat.copied"));
    } catch {
      toast.error(t("chat.copyFailed"));
    }
  }

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-3 py-2 text-sm text-primary-foreground">
          {content}
        </div>
      </div>
    );
  }

  const finished = !pending && content !== "";
  return (
    <div className="group/message text-sm">
      {content === "" && pending ? (
        <span className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {pendingLabel}
        </span>
      ) : (
        <Markdown text={content} />
      )}
      {finished && (
        <div
          className={cn(
            "mt-1 flex items-center gap-0.5 transition-opacity",
            !latest &&
              "opacity-0 group-hover/message:opacity-100 focus-within:opacity-100",
          )}
        >
          <button
            type="button"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => void copy()}
            aria-label={t("chat.copy")}
          >
            <Copy className="size-3.5" />
          </button>
          {onRegenerate && (
            <button
              type="button"
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={onRegenerate}
              aria-label={t("chat.regenerate")}
            >
              <RotateCcw className="size-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
