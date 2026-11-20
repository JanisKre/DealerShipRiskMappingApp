import { exportLocale } from "@renderer/lib/format";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  ChevronsUpDown,
  FileUp,
  FolderClock,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { errorReason, notify } from "@renderer/lib/notify";
import { Button } from "@renderer/components/ui/button";
import { HintButton } from "@renderer/components/ui/hint-button";
import { Input } from "@renderer/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@renderer/components/ui/popover";
import type { Session } from "@shared/types";
import { hasManualEdits } from "@shared/portfolio-merge";
import { useAppStore } from "@renderer/store/appStore";
import { cn } from "@renderer/lib/utils";
import { portfolioName } from "@renderer/lib/portfolioName";
import {
  groupSessions,
  isSnapshot,
  type SessionSummary,
} from "@renderer/lib/portfolioSessions";
import { Badge } from "@renderer/components/ui/badge";
import { PORTFOLIO_FILE_INVALID } from "@shared/constants";

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
  const openImportedSession = useAppStore((s) => s.openImportedSession);
  const mergeSession = useAppStore((s) => s.mergeSession);
  const hasLocations = useAppStore((s) => s.dealerships.length > 0);
  const activeIsSnapshot = useAppStore((s) => s.sessionSnapshotOf != null);

  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingImport, setPendingImport] = useState<Session | null>(null);
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
      setPendingImport(null);
    }
  }

  async function handleNew(): Promise<void> {
    setBusy(true);
    try {
      await newPortfolio();
      setOpen(false);
      navigate("/");
    } catch (err) {
      notify.error(t("shell.portfolioSwitcher.newFailed"), { cause: err });
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
      notify.error(t("shell.portfolioSwitcher.switchFailed"), { cause: err });
    } finally {
      setBusy(false);
    }
  }

  async function handleImportFile(): Promise<void> {
    setBusy(true);
    try {
      const session = await window.api.importPortfolioFile(exportLocale());
      if (session) setPendingImport(session);
    } catch (err) {
      // A file that is no portfolio gets its own sentence instead of the
      // parser's text.
      if (errorReason(err).includes(PORTFOLIO_FILE_INVALID))
        notify.error(t("shell.portfolioSwitcher.importFailed"), {
          description: t("shell.portfolioSwitcher.importInvalid"),
        });
      else
        notify.error(t("shell.portfolioSwitcher.importFailed"), { cause: err });
    } finally {
      setBusy(false);
    }
  }

  async function handleOpenImported(): Promise<void> {
    if (!pendingImport) return;
    setBusy(true);
    try {
      await openImportedSession(pendingImport);
      setPendingImport(null);
      setOpen(false);
      navigate("/");
    } catch (err) {
      notify.error(t("shell.portfolioSwitcher.importOpenFailed"), {
        cause: err,
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleMergeImported(): Promise<void> {
    if (!pendingImport) return;
    setBusy(true);
    try {
      const result = await mergeSession(pendingImport);
      notify.success(
        t("shell.portfolioSwitcher.mergeDone", {
          added: result.addedIds.length,
          updated: result.updatedIds.length,
        }),
      );
      if (result.conflictNames.length > 0)
        notify.warning(
          t("shell.portfolioSwitcher.mergeConflicts", {
            count: result.conflictNames.length,
          }),
          { description: result.conflictNames.slice(0, 5).join(", ") },
        );
      setPendingImport(null);
      setOpen(false);
    } catch (err) {
      notify.error(t("shell.portfolioSwitcher.mergeFailed"), { cause: err });
    } finally {
      setBusy(false);
    }
  }

  function startRename(session: SessionSummary): void {
    setConfirmingDeleteId(null);
    setRenamingId(session.id);
    setRenameDraft(portfolioName(session.name, t));
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
      notify.error(t("shell.portfolioSwitcher.renameFailed"), { cause: err });
    }
  }

  async function confirmDelete(id: string): Promise<void> {
    setConfirmingDeleteId(null);
    const deleted = sessions?.find((session) => session.id === id);
    const wasOpen = id === sessionId;
    try {
      const openedName = await deleteSavedSession(id);
      const name = portfolioName(deleted?.name ?? "", t);
      // Deleting the open portfolio switches to another one: say so.
      if (wasOpen)
        notify.success(
          openedName
            ? t("shell.portfolioSwitcher.deletedOpenSwitched", {
                name,
                next: portfolioName(openedName, t),
              })
            : t("shell.portfolioSwitcher.deletedOpen", { name }),
        );
      await loadList();
    } catch (err) {
      notify.error(t("shell.portfolioSwitcher.deleteFailed"), { cause: err });
    }
  }

  const grouped = groupSessions(sessions ?? []);

  function renderRow(session: SessionSummary): React.JSX.Element {
    return (
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
                name: portfolioName(session.name, t),
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
              name: portfolioName(session.name, t),
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
              className="min-w-0 flex-1 rounded-sm text-left focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              onClick={() => void handleSwitch(session.id)}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-sm font-medium">
                  {portfolioName(session.name, t)}
                </span>
                {isSnapshot(session, sessions ?? []) && (
                  <Badge
                    variant="outline"
                    className="shrink-0 px-1.5 py-0 font-normal"
                  >
                    {t("shell.portfolioSwitcher.snapshotBadge")}
                  </Badge>
                )}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {new Date(session.updatedAt).toLocaleString(i18n.language)}
              </span>
            </button>
            {/* Also shown while the row has keyboard focus. */}
            <HintButton
              type="button"
              size="icon"
              variant="ghost"
              side="left"
              className="size-7 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                startRename(session);
              }}
              aria-label={t("shell.portfolioSwitcher.renameFor", {
                name: portfolioName(session.name, t),
              })}
            >
              <Pencil className="size-3.5" />
            </HintButton>
            <HintButton
              type="button"
              size="icon"
              variant="ghost"
              side="left"
              className="size-7 shrink-0 text-destructive opacity-0 hover:text-destructive group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                setConfirmingDeleteId(session.id);
              }}
              aria-label={t("shell.portfolioSwitcher.deleteFor", {
                name: portfolioName(session.name, t),
              })}
            >
              <Trash2 className="size-3.5" />
            </HintButton>
          </div>
        )}
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex max-w-[16rem] min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          disabled={busy}
          title={t("shell.portfolioSwitcher.trigger")}
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-sm font-semibold leading-tight">
                {portfolioName(sessionName, t)}
              </span>
              {activeIsSnapshot && (
                <Badge
                  variant="outline"
                  className="shrink-0 px-1.5 py-0 font-normal"
                >
                  {t("shell.portfolioSwitcher.snapshotBadge")}
                </Badge>
              )}
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
      <PopoverContent
        align="start"
        className="w-80 p-1"
        // Escape while renaming cancels the rename and keeps the list open
        // (Radix catches Escape on the document before the input sees it).
        onEscapeKeyDown={(event) => {
          if (renamingId) event.preventDefault();
        }}
      >
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
          onClick={() => void handleNew()}
        >
          <Plus className="size-4" />
          {t("shell.portfolioSwitcher.newPortfolio")}
        </button>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
          onClick={() => void handleImportFile()}
          disabled={busy}
        >
          <FileUp className="size-4" />
          {t("shell.portfolioSwitcher.importFile")}
        </button>
        {pendingImport && (
          <div className="mx-1 my-1 space-y-2 rounded-md border bg-muted/30 p-2.5 text-xs">
            <p>
              {t("shell.portfolioSwitcher.importFound", {
                name: pendingImport.name,
                count: pendingImport.dealerships.length,
                edited: pendingImport.dealerships.filter(hasManualEdits).length,
              })}
            </p>
            {hasLocations && (
              <>
                <Button
                  size="sm"
                  className="h-7 w-full"
                  disabled={busy}
                  onClick={() => void handleMergeImported()}
                >
                  {t("shell.portfolioSwitcher.importMerge")}
                </Button>
                <p className="text-muted-foreground">
                  {t("shell.portfolioSwitcher.importMergeHint")}
                </p>
              </>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-7 w-full"
              disabled={busy}
              onClick={() => void handleOpenImported()}
            >
              {t("shell.portfolioSwitcher.importOpenNew")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-full"
              onClick={() => setPendingImport(null)}
            >
              {t("common.cancel")}
            </Button>
          </div>
        )}
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
          {!loading && sessions && (
            <>
              {grouped.portfolios.map(renderRow)}
              {grouped.snapshots.length > 0 && (
                <div className="mt-1 flex items-center gap-1.5 border-t px-2 pt-2 pb-1 text-xs font-semibold text-muted-foreground">
                  {t("shell.portfolioSwitcher.snapshotsHeading")}
                </div>
              )}
              {grouped.snapshots.map(renderRow)}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
