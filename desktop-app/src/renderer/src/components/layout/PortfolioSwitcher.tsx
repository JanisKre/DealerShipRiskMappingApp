import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  ChevronsUpDown,
  FolderClock,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@renderer/components/ui/popover";
import { useAppStore } from "@renderer/store/appStore";
import { cn } from "@renderer/lib/utils";

interface SessionSummary {
  id: string;
  name: string;
  updatedAt: string;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The portfolio title, merged with everything else portfolio-scoped: start
 * a new one, switch to a different saved one, or rename/delete any saved
 * one — all from one control, since they're all "which/what portfolio,"
 * not separate concerns.
 */
export function PortfolioSwitcher({
  descriptionKey,
}: Readonly<{ descriptionKey?: string }>): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const sessionId = useAppStore((s) => s.sessionId);
  const sessionName = useAppStore((s) => s.sessionName);
  const newPortfolio = useAppStore((s) => s.newPortfolio);
  const switchSession = useAppStore((s) => s.switchSession);
  const renameSavedSession = useAppStore((s) => s.renameSavedSession);
  const deleteSavedSession = useAppStore((s) => s.deleteSavedSession);

  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null,
  );

  async function loadList(): Promise<void> {
    setLoading(true);
    try {
      setSessions(await window.api.listSessions());
    } catch (err) {
      console.error("Loading the portfolio list failed:", err);
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }

  function handleOpenChange(next: boolean): void {
    setOpen(next);
    if (next) {
      void loadList();
    } else {
      setRenamingId(null);
      setConfirmingDeleteId(null);
    }
  }

  async function handleNew(): Promise<void> {
    setBusy(true);
    try {
      await newPortfolio();
      setOpen(false);
      navigate("/");
    } catch (err) {
      toast.error(
        t("shell.portfolioSwitcher.newFailed", { error: errorMessage(err) }),
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleSwitch(id: string): Promise<void> {
    if (id === sessionId) {
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      await switchSession(id);
      setOpen(false);
      navigate("/");
    } catch (err) {
      toast.error(
        t("shell.portfolioSwitcher.switchFailed", {
          error: errorMessage(err),
        }),
      );
    } finally {
      setBusy(false);
    }
  }

  function startRename(session: SessionSummary): void {
    setConfirmingDeleteId(null);
    setRenamingId(session.id);
    setRenameDraft(session.name);
  }

  async function commitRename(id: string): Promise<void> {
    if (renamingId !== id) return; // already committed (Enter) or cancelled (Escape)
    const trimmed = renameDraft.trim();
    setRenamingId(null);
    if (!trimmed) return;
    try {
      await renameSavedSession(id, trimmed);
      await loadList();
    } catch (err) {
      toast.error(
        t("shell.portfolioSwitcher.renameFailed", {
          error: errorMessage(err),
        }),
      );
    }
  }

  async function confirmDelete(id: string): Promise<void> {
    setConfirmingDeleteId(null);
    try {
      await deleteSavedSession(id);
      await loadList();
    } catch (err) {
      toast.error(
        t("shell.portfolioSwitcher.deleteFailed", {
          error: errorMessage(err),
        }),
      );
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex max-w-[16rem] min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-accent"
          disabled={busy}
          title={t("shell.portfolioSwitcher.trigger")}
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-semibold leading-tight">
              {sessionName}
            </span>
            {descriptionKey && (
              <span className="truncate text-xs leading-tight text-muted-foreground">
                {t(descriptionKey)}
              </span>
            )}
          </span>
          {busy ? (
            <Loader2 className="size-4 shrink-0 animate-spin" />
          ) : (
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-1">
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
          onClick={() => void handleNew()}
        >
          <Plus className="size-4" />
          {t("shell.portfolioSwitcher.newPortfolio")}
        </button>
        <div className="my-1 h-px bg-border" />
        <div className="flex items-center gap-1.5 px-2 py-1 text-sm font-semibold">
          <FolderClock className="size-3.5" />
          {t("shell.portfolioSwitcher.savedPortfolios")}
        </div>
        <div className="max-h-72 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          )}
          {!loading && sessions?.length === 0 && (
            <p className="px-2 py-2 text-xs text-muted-foreground">
              {t("shell.portfolioSwitcher.empty")}
            </p>
          )}
          {!loading &&
            sessions?.map((session) => (
              <div
                key={session.id}
                className={cn(
                  "group rounded-sm px-2 py-1.5",
                  session.id === sessionId && "bg-accent",
                )}
              >
                {confirmingDeleteId === session.id ? (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate text-destructive">
                      {t("shell.portfolioSwitcher.confirmDelete", {
                        name: session.name,
                      })}
                    </span>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-7 shrink-0 px-2"
                      onClick={() => void confirmDelete(session.id)}
                    >
                      {t("shell.portfolioSwitcher.deleteConfirmButton")}
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
                ) : renamingId === session.id ? (
                  <Input
                    autoFocus
                    value={renameDraft}
                    aria-label={t("shell.portfolioSwitcher.renameFor", {
                      name: session.name,
                    })}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void commitRename(session.id);
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    onBlur={() => void commitRename(session.id)}
                    className="h-7 text-sm"
                  />
                ) : (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => void handleSwitch(session.id)}
                    >
                      <span className="block truncate text-sm font-medium">
                        {session.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {new Date(session.updatedAt).toLocaleString(
                          i18n.language,
                        )}
                      </span>
                    </button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-7 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        startRename(session);
                      }}
                      title={t("shell.portfolioSwitcher.rename")}
                      aria-label={t("shell.portfolioSwitcher.renameFor", {
                        name: session.name,
                      })}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-7 shrink-0 text-destructive opacity-0 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmingDeleteId(session.id);
                      }}
                      title={t("shell.portfolioSwitcher.delete")}
                      aria-label={t("shell.portfolioSwitcher.deleteFor", {
                        name: session.name,
                      })}
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
