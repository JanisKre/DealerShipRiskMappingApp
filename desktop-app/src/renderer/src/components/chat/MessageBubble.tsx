import { Loader2, Sparkles, User } from "lucide-react";
import type { ChatMessage } from "@shared/types";
import { cn } from "@renderer/lib/utils";
import { Markdown } from "@renderer/components/ai/ExecutiveSummary";

/**
 * Eine Chat-Blase (User rechts, Assistent links). User-Text wird literal
 * dargestellt, Assistenten-Antworten als Markdown. `pending` zeigt den Spinner,
 * solange noch kein Token eingetroffen ist.
 */
export function MessageBubble({
  role,
  content,
  pending,
}: Readonly<{
  role: ChatMessage["role"];
  content: string;
  pending?: boolean;
}>): React.JSX.Element {
  const isUser = role === "user";
  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      <div
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground",
        )}
      >
        {isUser ? <User className="size-4" /> : <Sparkles className="size-4" />}
      </div>
      <div
        className={cn(
          "max-w-[80%] rounded-lg px-3 py-2 text-sm",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted",
        )}
      >
        {isUser ? (
          <span className="whitespace-pre-wrap">{content}</span>
        ) : (
          <Markdown text={content} />
        )}
        {pending && content === "" && (
          <Loader2 className="size-4 animate-spin" />
        )}
      </div>
    </div>
  );
}
