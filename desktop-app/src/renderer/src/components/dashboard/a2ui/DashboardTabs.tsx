import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  LayoutDashboard,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu";
import { Input } from "@renderer/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@renderer/components/ui/tabs";
import { useDashboardStore } from "@renderer/store/dashboardStore";

const STANDARD = "__standard__";

/**
 * One row of tabs for every dashboard: the standard overview first, then
 * the AI dashboards, then "new dashboard", which opens the assistant with a
 * sentence to complete. Rename, change and delete sit in the "…" menu of the
 * open AI dashboard, so switching stays a single click.
 */
export function DashboardTabs({
  onNew,
  onChange,
  trailing,
}: Readonly<{
  /** Opens the assistant to describe a new dashboard. */
  onNew: () => void;
  /** Opens the assistant to change the open dashboard. */
  onChange: () => void;
  /** Controls of the open view, at the end of the row. */
  trailing?: React.ReactNode;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const list = useDashboardStore((s) => s.list);
  const active = useDashboardStore((s) => s.active);
  const open = useDashboardStore((s) => s.open);
  const rename = useDashboardStore((s) => s.rename);
  const remove = useDashboardStore((s) => s.remove);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [deleting, setDeleting] = useState(false);

  function select(value: string): void {
    void open(value === STANDARD ? null : value).catch((err: unknown) =>
      toast.error(err instanceof Error ? err.message : String(err)),
    );
  }

  async function commitRename(): Promise<void> {
    if (!active || !draft.trim()) return;
    try {
      await rename(active.id, draft);
      setRenaming(false);
    } catch {
      toast.error(t("a2ui.renameFigure"));
    }
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      <Tabs
        value={active?.id ?? STANDARD}
        onValueChange={select}
        className="min-w-0 max-w-full shrink-0"
      >
        {/* Scrolls sideways when there are many dashboards. */}
        <div className="max-w-full overflow-x-auto">
          <TabsList aria-label={t("a2ui.tabs.label")}>
            <TabsTrigger value={STANDARD} className="gap-1.5">
              <LayoutDashboard className="size-3.5" />
              {t("a2ui.tabs.standard")}
            </TabsTrigger>
            {list.map((d) => (
              <TabsTrigger key={d.id} value={d.id} className="max-w-56 gap-1.5">
                <Sparkles className="size-3.5 text-primary" />
                <span className="truncate">{d.name}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Tabs>

      {active && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              aria-label={t("a2ui.tabs.more", { name: active.name })}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={onChange}>
              <MessageSquare className="size-3.5" />
              {t("a2ui.tabs.change")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                setDraft(active.name);
                setRenaming(true);
              }}
            >
              <Pencil className="size-3.5" />
              {t("a2ui.tabs.rename")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => setDeleting(true)}
            >
              <Trash2 className="size-3.5" />
              {t("a2ui.tabs.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <Button
        variant="ghost"
        size="sm"
        className="h-8 shrink-0 gap-1.5 px-2.5 text-muted-foreground hover:text-foreground"
        onClick={onNew}
      >
        <Plus className="size-4" />
        {t("a2ui.tabs.new")}
      </Button>

      {trailing && <div className="ml-auto shrink-0">{trailing}</div>}

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("a2ui.tabs.rename")}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={draft}
            maxLength={80}
            aria-label={t("a2ui.tabs.rename")}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void commitRename();
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => void commitRename()}
              disabled={!draft.trim()}
            >
              {t("a2ui.tabs.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("a2ui.tabs.deleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("a2ui.tabs.deleteText", { name: active?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setDeleting(false);
                if (active) void remove(active.id);
              }}
            >
              {t("ui.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
