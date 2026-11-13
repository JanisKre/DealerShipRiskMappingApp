import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import type { AnalyzedDealership, Session } from "@shared/types";
import { effectiveVehicleCount } from "@shared/risk-math";
import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@renderer/components/ui/table";
import { eur, num } from "@renderer/lib/format";
import { useAppStore } from "@renderer/store/appStore";
import { portfolioName } from "@renderer/lib/portfolioName";

/**
 * Saves a copy of the active portfolio under a new id ("… – Stand 13.11.,
 * 18:30") without switching to it: the comparison point for later changes.
 * Autosave keeps overwriting the active portfolio, so it can't be one.
 * Returns the snapshot's name.
 */
export async function saveComparisonSnapshot(
  t: TFunction,
  language: string,
): Promise<string> {
  const session = useAppStore.getState().currentSession();
  const date = new Date().toLocaleString(language, {
    dateStyle: "short",
    timeStyle: "short",
  });
  const name = t("ui.snapshotName", {
    name: portfolioName(session.name, t),
    date,
  });
  await window.api.saveSession({
    ...session,
    id: crypto.randomUUID(),
    name,
    // Nothing to resume or undo in a snapshot.
    pendingAnalysis: undefined,
    boundaryEdits: undefined,
  });
  return name;
}

/** "Stand speichern" with its toasts; shared by the header and the dialog. */
export function useSaveSnapshot(onSaved?: () => void): {
  saving: boolean;
  save: () => Promise<void>;
} {
  const { t, i18n } = useTranslation();
  const [saving, setSaving] = useState(false);
  async function save(): Promise<void> {
    setSaving(true);
    try {
      const name = await saveComparisonSnapshot(t, i18n.language);
      toast.success(t("ui.snapshotSaved", { name }));
      onSaved?.();
    } catch (err) {
      toast.error(
        t("ui.snapshotFailed", {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      setSaving(false);
    }
  }
  return { saving, save };
}

/**
 * Compares the active portfolio against a saved snapshot or portfolio: delta
 * in vehicles and EAL per location (matched by id, otherwise by name).
 */
export function ComparisonView({
  open,
  onOpenChange,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const dealerships = useAppStore((s) => s.dealerships);
  const sessionId = useAppStore((s) => s.sessionId);
  const [sessions, setSessions] = useState<
    Array<{ id: string; name: string; updatedAt: string }>
  >([]);
  const [baseline, setBaseline] = useState<Session | null>(null);
  const [loading, setLoading] = useState(false);

  const loadSessions = useCallback(async (): Promise<void> => {
    // The active portfolio is the comparison target, not a baseline.
    const all = await window.api.listSessions();
    setSessions(all.filter((s) => s.id !== sessionId));
  }, [sessionId]);
  useEffect(() => {
    if (open) void loadSessions();
  }, [open, loadSessions]);
  const snapshot = useSaveSnapshot(() => void loadSessions());

  async function pick(id: string): Promise<void> {
    setLoading(true);
    try {
      setBaseline(await window.api.loadSession(id));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-auto">
        <DialogHeader>
          <DialogTitle>{t("ui.portfolioComparison")}</DialogTitle>
          <DialogDescription>{t("ui.compareDescription")}</DialogDescription>
        </DialogHeader>

        {/* How to get a comparison point, so an empty list is no dead end. */}
        <div className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm">
          <p className="min-w-0 flex-1 text-muted-foreground">
            {sessions.length === 0 && (
              <span className="block font-medium text-foreground">
                {t("ui.noOtherSessions")}
              </span>
            )}
            {t("ui.compareHowTo")}
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={snapshot.saving}
            onClick={() => void snapshot.save()}
          >
            {snapshot.saving ? <Loader2 className="animate-spin" /> : <Save />}
            {t("ui.saveSnapshot")}
          </Button>
        </div>
        {sessions.length > 0 && (
          <Select onValueChange={pick}>
            <SelectTrigger className="max-w-sm">
              <SelectValue placeholder={t("ui.selectBaseline")} />
            </SelectTrigger>
            <SelectContent>
              {sessions.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {portfolioName(s.name, t)} ·{" "}
                  {new Date(s.updatedAt).toLocaleDateString(i18n.language)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {loading && <Loader2 className="mx-auto animate-spin" />}
        {baseline && (
          <DiffTable current={dealerships} baseline={baseline.dealerships} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DiffTable({
  current,
  baseline,
}: {
  current: AnalyzedDealership[];
  baseline: AnalyzedDealership[];
}): React.JSX.Element {
  const { t } = useTranslation();
  const baseMap = new Map(baseline.map((d) => [d.id || d.name, d]));

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("dashboard.locations")}</TableHead>
          <TableHead>Δ {t("common.vehicles")}</TableHead>
          <TableHead>Δ EAL</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {current.map((d) => {
          const base = baseMap.get(d.id || d.name);
          const dVeh =
            effectiveVehicleCount(d.detection) -
            effectiveVehicleCount(base?.detection);
          const dEal = (d.risk?.eal ?? 0) - (base?.risk?.eal ?? 0);
          return (
            <TableRow key={d.id}>
              <TableCell className="font-medium">{d.name}</TableCell>
              <TableCell>
                <Delta value={dVeh} fmt={(n) => num(n)} />
              </TableCell>
              <TableCell>
                <Delta value={dEal} fmt={(n) => eur(n)} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function Delta({
  value,
  fmt,
}: {
  value: number;
  fmt: (n: number) => string;
}): React.JSX.Element {
  if (value === 0) return <span className="text-muted-foreground">0</span>;
  const up = value > 0;
  return (
    <span className={up ? "text-destructive" : "text-success"}>
      {up ? "+" : ""}
      {fmt(value)}
    </span>
  );
}
