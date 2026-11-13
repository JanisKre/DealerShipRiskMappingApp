import { useMemo } from "react";
import {
  AlertTriangle,
  Building2,
  Car,
  CloudHail,
  Coins,
  Layers,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LucideIcon } from "lucide-react";
import type { AnalyzedDealership } from "@shared/types";
import {
  ELEVATED_HAIL_ZONE,
  computeAccumulationClusters,
  dealershipHailZone,
  effectiveVehicleCount,
} from "@shared/risk-math";
import { Card, CardContent } from "@renderer/components/ui/card";
import { eur, num, pct } from "@renderer/lib/format";
import { cn } from "@renderer/lib/utils";
import { useAppStore } from "@renderer/store/appStore";
import { estimateReasons } from "./estimates";
import { TileInfo } from "./TileInfo";

type Stat = {
  label: string;
  value: string;
  /** Muted second line with context for the value. */
  hint?: string;
  icon: LucideIcon;
  info?: { topic: string; values?: Record<string, string | number> };
  /** Color accent for icon + value (semantic). */
  tone?: "default" | "warn";
};

const toneClasses: Record<
  NonNullable<Stat["tone"]>,
  { icon: string; value: string }
> = {
  default: { icon: "text-muted-foreground", value: "" },
  // Colour on the icon only; the figure stays readable.
  warn: { icon: "text-warning-foreground", value: "" },
};

/**
 * KPI row for the hail underwriting view: locations, vehicles (and how many
 * park in the open), exposure, hail EAL, the largest accumulation, and the
 * locations in elevated hail zones.
 */
export function SummaryCards({
  dealerships,
}: {
  dealerships: AnalyzedDealership[];
}): React.JSX.Element {
  const { t } = useTranslation();
  const parameters = useAppStore((s) => s.parameters);

  const totalVehicles = dealerships.reduce(
    (a, d) => a + effectiveVehicleCount(d.detection),
    0,
  );
  const totalExposure = dealerships.reduce(
    (a, d) => a + (d.risk?.exposureEur ?? 0),
    0,
  );
  const totalEal = dealerships.reduce((a, d) => a + (d.risk?.eal ?? 0), 0);

  const elevated = dealerships.filter(
    (d) => (dealershipHailZone(d)?.zone ?? 0) >= ELEVATED_HAIL_ZONE,
  );
  const elevatedExposure = elevated.reduce(
    (a, d) => a + (d.risk?.exposureEur ?? 0),
    0,
  );

  // While the analysis runs every sum is partial: say so on each figure
  // instead of showing e.g. "0 €" as if it were final.
  const analyzed = dealerships.filter((d) => d.risk).length;
  const provisional =
    analyzed < dealerships.length
      ? t("dashboard.kpi.provisional", {
          analyzed,
          total: dealerships.length,
        })
      : undefined;
  const estimated = dealerships.filter(
    (d) => estimateReasons(d).length > 0,
  ).length;
  const estimatedHint =
    estimated > 0
      ? t("dashboard.kpi.estimatedSites", { count: estimated })
      : undefined;
  const withProvisional = (hint?: string): string | undefined =>
    provisional ? [provisional, hint].filter(Boolean).join(" · ") : hint;

  const largest = useMemo(() => {
    const located = dealerships.filter((d) => d.lat != null && d.lon != null);
    return computeAccumulationClusters(
      located,
      parameters.accumulationRadiusKm,
      parameters,
    )
      .filter((c) => c.count > 1)
      .sort((a, b) => b.totalExposureEur - a.totalExposureEur)[0];
  }, [dealerships, parameters]);

  const stats: Stat[] = [
    {
      label: t("dashboard.locations"),
      value: num(dealerships.length),
      icon: Building2,
    },
    {
      label: t("common.vehicles"),
      value: num(totalVehicles),
      hint: withProvisional(estimatedHint),
      icon: Car,
    },
    {
      label: t("dashboard.totalExposure"),
      value: eur(totalExposure),
      hint: withProvisional(estimatedHint),
      icon: Coins,
    },
    {
      label: t("dashboard.hailEal"),
      value: eur(totalEal),
      hint: withProvisional(),
      icon: CloudHail,
      info: { topic: "hailEal" },
    },
    {
      label: t("dashboard.kpi.largestAccumulation"),
      value: largest ? eur(largest.totalExposureEur) : "–",
      hint: withProvisional(
        largest
          ? t("dashboard.kpi.accumulationHint", {
              count: largest.count,
              radius: parameters.accumulationRadiusKm,
            })
          : t("dashboard.kpi.noAccumulation", {
              radius: parameters.accumulationRadiusKm,
            }),
      ),
      icon: Layers,
      info: {
        topic: "accumulations",
        values: { radius: parameters.accumulationRadiusKm },
      },
    },
    {
      label: t("dashboard.kpi.elevatedZones", { zone: ELEVATED_HAIL_ZONE }),
      value: num(elevated.length),
      hint: withProvisional(
        totalExposure > 0
          ? t("dashboard.kpi.exposureShare", {
              share: pct(elevatedExposure / totalExposure),
            })
          : undefined,
      ),
      icon: AlertTriangle,
      tone: elevated.length > 0 ? "warn" : "default",
    },
  ];

  return (
    // Six columns only from 80rem of tile width: below that, euro values such
    // as "24.675.000 €" no longer fit a sixth of the row and were clipped.
    <div className="grid grid-cols-2 gap-4 @xl:grid-cols-3 @7xl:grid-cols-6">
      {stats.map((s) => {
        const tone = toneClasses[s.tone ?? "default"];
        const Icon = s.icon;
        return (
          <Card key={s.label} className="hover:shadow-md">
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                  <span className="truncate" title={s.label}>
                    {s.label}
                  </span>
                  {s.info && (
                    <TileInfo
                      topic={s.info.topic}
                      values={s.info.values}
                      label={s.label}
                    />
                  )}
                </div>
                <Icon className={cn("size-4 shrink-0", tone.icon)} />
              </div>
              <div
                className={cn(
                  "mt-2 truncate text-xl font-semibold tabular-nums",
                  tone.value,
                )}
                title={s.value}
              >
                {s.value}
              </div>
              {s.hint && (
                <div
                  className="mt-0.5 truncate text-xs text-muted-foreground"
                  title={s.hint}
                >
                  {s.hint}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
