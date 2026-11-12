import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronsUpDown,
  History,
  MessageSquare,
  Pencil,
  Trash2,
} from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@renderer/components/ui/popover";
import { cn } from "@renderer/lib/utils";
import { NEW_CONVERSATION_TITLE } from "@renderer/store/conversationStore";

type TFunction = ReturnType<typeof useTranslation>["t"];

/** Display name of a thread; the store keeps an English sentinel for new ones. */
export function threadName(name: string, t: TFunction): string {
  return name === NEW_CONVERSATION_TITLE ? t("ui.newConversation") : name;
}

/**
 * Thread picker built like the portfolio switcher: a trigger with the open
 * thread, a "new" action on top, then the history with name + date per
 * thread, the open one highlighted, rename and a confirmed delete on hover.
 */
export function ConversationPicker({
  conversations,
  activeId,
  activeName,
  onSelect,
  onRename,
  onDelete,
}: Readonly<{
  conversations: Array<{ id: string; name: string; updatedAt: string }>;
  activeId: string | null;
  activeName: string;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}>): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null,
  );
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const formatDate = (iso: string): string =>
    new Date(iso).toLocaleString(i18n.language, {
      dateStyle: "short",
      timeStyle: "short",
    });

  function commitRename(id: string): void {
    if (renamingId !== id) return;
    setRenamingId(null);
    if (renameDraft.trim()) onRename(id, renameDraft);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setConfirmingDeleteId(null);
          setRenamingId(null);
        }
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
        {/* No "new conversation" entry: the + next to the picker does that. */}
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
          {conversations.map((conversation) => {
            const name = threadName(conversation.name, t);
            return (
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
                      {t("ui.deleteThreadConfirm", { name })}
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
                ) : renamingId === conversation.id ? (
                  <Input
                    autoFocus
                    value={renameDraft}
                    aria-label={t("chat.renameFor", { name })}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(conversation.id);
                      if (e.key === "Escape") {
                        e.stopPropagation();
                        setRenamingId(null);
                      }
                    }}
                    onBlur={() => commitRename(conversation.id)}
                    className="h-7 text-sm"
                  />
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
                        {name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {formatDate(conversation.updatedAt)}
                      </span>
                    </button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-7 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                      onClick={() => {
                        setRenameDraft(name);
                        setRenamingId(conversation.id);
                      }}
                      aria-label={t("chat.renameFor", { name })}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-7 shrink-0 text-destructive opacity-0 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                      onClick={() => setConfirmingDeleteId(conversation.id)}
                      aria-label={`${t("ui.deleteThread")}: ${name}`}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
