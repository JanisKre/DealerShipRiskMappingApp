import {
  AlertTriangle,
  Building2,
  Car,
  Coins,
  Gauge,
  ShieldAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LucideIcon } from "lucide-react";
import type { AnalyzedDealership } from "@shared/types";
import { effectiveVehicleCount } from "@shared/risk-math";
import { Card, CardContent } from "@renderer/components/ui/card";
import { eur, num } from "@renderer/lib/format";
import { cn } from "@renderer/lib/utils";

type Stat = {
  label: string;
  value: string;
  suffix?: string;
  icon: LucideIcon;
  /** Color accent for icon + value (semantic). */
  tone?: "default" | "warn" | "danger";
};

const toneClasses: Record<
  NonNullable<Stat["tone"]>,
  { icon: string; value: string }
> = {
  default: { icon: "text-muted-foreground", value: "" },
  warn: {
    icon: "text-amber-600 dark:text-amber-400",
    value: "text-amber-600 dark:text-amber-400",
  },
  danger: { icon: "text-destructive", value: "text-destructive" },
};

/**
 * KPI tiles for the dashboard: locations, vehicles, avg. score,
 * total exposure, total EAL, and extreme risks.
 */
export function SummaryCards({
  dealerships,
}: {
  dealerships: AnalyzedDealership[];
}): React.JSX.Element {
  const { t } = useTranslation();
  const count = dealerships.length;
  const scored = dealerships.filter((d) => d.risk);
  const avgScore =
    scored.length > 0
      ? scored.reduce((a, d) => a + (d.risk?.overallScore ?? 0), 0) /
        scored.length
      : 0;
  const totalVehicles = dealerships.reduce(
    (a, d) => a + effectiveVehicleCount(d.detection),
    0,
  );
  const totalExposure = dealerships.reduce(
    (a, d) => a + (d.risk?.exposureEur ?? 0),
    0,
  );
  const totalEal = dealerships.reduce((a, d) => a + (d.risk?.eal ?? 0), 0);
  const extreme = dealerships.filter(
    (d) => (d.risk?.overallScore ?? 0) >= 75,
  ).length;

  const stats: Stat[] = [
    { label: t("dashboard.locations"), value: num(count), icon: Building2 },
    {
      label: t("dashboard.avgScore"),
      value: avgScore.toFixed(0),
      suffix: "/100",
      icon: Gauge,
      tone: avgScore >= 75 ? "danger" : avgScore >= 50 ? "warn" : "default",
    },
    { label: t("common.vehicles"), value: num(totalVehicles), icon: Car },
    {
      label: t("dashboard.totalExposure"),
      value: eur(totalExposure),
      icon: Coins,
    },
    { label: t("dashboard.totalEal"), value: eur(totalEal), icon: ShieldAlert },
    {
      label: t("dashboard.extreme"),
      value: num(extreme),
      icon: AlertTriangle,
      tone: extreme > 0 ? "danger" : "default",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
      {stats.map((s) => {
        const tone = toneClasses[s.tone ?? "default"];
        const Icon = s.icon;
        return (
          <Card key={s.label} className="hover:shadow-md">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="text-muted-foreground text-xs">{s.label}</div>
                <Icon className={cn("size-4", tone.icon)} />
              </div>
              <div
                className={cn(
                  "mt-2 text-xl font-semibold tabular-nums",
                  tone.value,
                )}
              >
                {s.value}
                {s.suffix && (
                  <span className="text-muted-foreground text-sm">
                    {s.suffix}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
