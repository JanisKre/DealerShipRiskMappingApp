import { useState } from "react";
import { MessageSquarePlus, Search, Trash2 } from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import { cn } from "@renderer/lib/utils";
import { useConversationStore } from "@renderer/store/conversationStore";

/**
 * Left-hand conversation list: "+ New", search, and a scrollable list sorted
 * by `updatedAt`. The active entry is highlighted; each entry can be
 * permanently deleted via the trash icon.
 */
export function ConversationSidebar(): React.JSX.Element {
  const list = useConversationStore((s) => s.list);
  const activeId = useConversationStore((s) => s.activeId);
  const selectConversation = useConversationStore((s) => s.selectConversation);
  const newConversation = useConversationStore((s) => s.newConversation);
  const deleteConversation = useConversationStore((s) => s.deleteConversation);
  const [query, setQuery] = useState("");

  const filtered = list.filter((c) =>
    c.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r bg-card">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <h2 className="text-sm font-semibold">Conversations</h2>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={newConversation}
          title="New conversation"
          aria-label="New conversation"
        >
          <MessageSquarePlus className="size-4" />
        </Button>
      </div>

      <div className="px-3 pb-2">
        <div className="flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {filtered.length === 0 && (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">
            {list.length === 0
              ? "No conversations yet."
              : "No matches."}
          </p>
        )}
        {filtered.map((c) => (
          <div
            key={c.id}
            className={cn(
              "group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm",
              c.id === activeId
                ? "bg-primary text-primary-foreground"
                : "text-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left"
              onClick={() => void selectConversation(c.id)}
              title={c.name}
            >
              {c.name}
            </button>
            <button
              type="button"
              aria-label="Delete conversation"
              title="Delete"
              className={cn(
                "shrink-0 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100",
                c.id === activeId
                  ? "hover:bg-primary-foreground/20"
                  : "hover:bg-background hover:text-destructive",
              )}
              onClick={() => void deleteConversation(c.id)}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
      </nav>
    </aside>
  );
}
