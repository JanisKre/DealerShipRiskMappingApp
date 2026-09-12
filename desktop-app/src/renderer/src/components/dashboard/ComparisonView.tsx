import { useState } from "react";
import { useTranslation } from "react-i18next";
import { GitCompare, Loader2 } from "lucide-react";
import type { AnalyzedDealership, Session } from "@shared/types";
import { effectiveVehicleCount } from "@shared/risk-math";
import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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

/**
 * Compares the active portfolio against a saved session: delta in
 * score, vehicles, and EAL per location (matched by id, otherwise by name).
 */
export function ComparisonView(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const dealerships = useAppStore((s) => s.dealerships);
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<
    Array<{ id: string; name: string; updatedAt: string }>
  >([]);
  const [baseline, setBaseline] = useState<Session | null>(null);
  const [loading, setLoading] = useState(false);

  async function openDialog(): Promise<void> {
    setOpen(true);
    setSessions(await window.api.listSessions());
  }

  async function pick(id: string): Promise<void> {
    setLoading(true);
    try {
      setBaseline(await window.api.loadSession(id));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" onClick={openDialog}>
          <GitCompare /> {t("ui.compare")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-auto">
        <DialogHeader>
          <DialogTitle>{t("ui.portfolioComparison")}</DialogTitle>
          <DialogDescription>{t("ui.compareDescription")}</DialogDescription>
        </DialogHeader>

        <Select onValueChange={pick}>
          <SelectTrigger className="max-w-sm">
            <SelectValue placeholder={t("ui.selectBaseline")} />
          </SelectTrigger>
          <SelectContent>
            {sessions.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name} ·{" "}
                {new Date(s.updatedAt).toLocaleDateString(i18n.language)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

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
          <TableHead>Δ {t("common.score")}</TableHead>
          <TableHead>Δ {t("common.vehicles")}</TableHead>
          <TableHead>Δ EAL</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {current.map((d) => {
          const base = baseMap.get(d.id || d.name);
          const dScore =
            (d.risk?.overallScore ?? 0) - (base?.risk?.overallScore ?? 0);
          const dVeh =
            effectiveVehicleCount(d.detection) -
            effectiveVehicleCount(base?.detection);
          const dEal = (d.risk?.eal ?? 0) - (base?.risk?.eal ?? 0);
          return (
            <TableRow key={d.id}>
              <TableCell className="font-medium">{d.name}</TableCell>
              <TableCell>
                <Delta value={dScore} fmt={(n) => n.toFixed(0)} />
              </TableCell>
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
    <span className={up ? "text-destructive" : "text-green-600"}>
      {up ? "+" : ""}
      {fmt(value)}
    </span>
  );
}
