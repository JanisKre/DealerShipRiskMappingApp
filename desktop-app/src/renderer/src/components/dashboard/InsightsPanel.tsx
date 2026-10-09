import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ClipboardCheck } from "lucide-react";
import type { AnalyzedDealership, RiskParameters } from "@shared/types";
import { generateAlerts, type Alert } from "@shared/analytics";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@renderer/components/ui/card";
import { boundarySourceLabel } from "@renderer/lib/boundarySource";
import { eur, num, pct } from "@renderer/lib/format";
import { useAppStore } from "@renderer/store/appStore";
import { TileInfo } from "./TileInfo";

const INITIAL_ROWS = 8;

/**
 * Review notes ("Prüfhinweise"): fixed, named rules from `generateAlerts`.
 * Every hit shows the rule that fired, so the list is explainable. An
 * accumulation note opens the accumulation on the map; every other note
 * opens the location's detail dialog.
 */
export function InsightsPanel({
  dealerships,
  onSelect,
  onShowAccumulation,
}: Readonly<{
  dealerships: AnalyzedDealership[];
  onSelect: (d: AnalyzedDealership) => void;
  onShowAccumulation: (memberIds: string[]) => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const parameters = useAppStore((s) => s.parameters);
  const [showAll, setShowAll] = useState(false);
  const alerts = useMemo(
    () => generateAlerts(dealerships, parameters),
    [dealerships, parameters],
  );
  const byId = useMemo(
    () => new Map(dealerships.map((d) => [d.id, d])),
    [dealerships],
  );
  const critical = alerts.filter((a) => a.level === "critical").length;
  const visible = showAll ? alerts : alerts.slice(0, INITIAL_ROWS);

  function open(alert: Alert): void {
    if (alert.memberIds) {
      onShowAccumulation(alert.memberIds);
      return;
    }
    const d = byId.get(alert.dealershipId);
    if (d) onSelect(d);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-base">
          <ClipboardCheck className="size-4 text-amber-500" />
          {t("dashboard.review.title")}
          <TileInfo topic="review" values={ruleValues(parameters)} />
        </CardTitle>
        <CardDescription>
          {t("dashboard.review.summary", {
            critical,
            warnings: alerts.length - critical,
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("dashboard.review.none")}
          </p>
        ) : (
          <ul className="space-y-1">
            {visible.map((a, i) => (
              <li key={`${a.dealershipId}-${a.kind}-${i}`}>
                <button
                  type="button"
                  onClick={() => open(a)}
                  className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  <AlertBadge level={a.level} />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{a.name}</span>
                    {a.memberIds && a.memberIds.length > 1 && (
                      <span className="text-muted-foreground">
                        {" "}
                        {t("dashboard.accumulations.more", {
                          count: a.memberIds.length - 1,
                        })}
                      </span>
                    )}{" "}
                    — {alertMessage(a, t)}
                    <span className="block text-xs text-muted-foreground">
                      {t("dashboard.review.ruleLabel")}{" "}
                      {t(
                        `dashboard.review.rules.${a.kind}`,
                        ruleValues(parameters),
                      )}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {alerts.length > INITIAL_ROWS && (
          <div className="flex justify-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAll((value) => !value)}
            >
              {showAll
                ? t("dashboard.showLess")
                : t("dashboard.showAll", { count: alerts.length })}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Thresholds interpolated into the rule texts. */
function ruleValues(p: RiskParameters): Record<string, string | number> {
  return {
    zone: p.alertHailZone,
    share: pct(p.alertEalPortfolioShare),
    radius: p.accumulationRadiusKm,
    threshold: eur(p.accumulationReinsureThresholdEur),
    utilisation: pct(p.alertOvercapacity),
    confidence: pct(p.alertLowBoundaryConfidence),
  };
}

function AlertBadge({
  level,
}: Readonly<{ level: Alert["level"] }>): React.JSX.Element {
  const { t } = useTranslation();
  return level === "critical" ? (
    <Badge variant="destructive" className="shrink-0">
      {t("dashboard.alertLevel.critical")}
    </Badge>
  ) : (
    <Badge variant="secondary" className="shrink-0">
      {t("dashboard.alertLevel.warning")}
    </Badge>
  );
}

function alertMessage(alert: Alert, t: TFunction): string {
  switch (alert.kind) {
    case "high-hail-zone":
      return t("dashboard.alert.highHailZone", { zone: alert.value ?? "–" });
    case "high-eal":
      return t("dashboard.alert.highEal", {
        share: (alert.value ?? 0).toFixed(0),
      });
    case "accumulation":
      return t("dashboard.alert.accumulation", {
        count: alert.memberIds?.length ?? 0,
        exposure: eur(alert.value),
      });
    case "overcapacity":
      return t("dashboard.alert.overcapacity", {
        utilisation: num(alert.value),
      });
    case "low-boundary-confidence":
      return t("dashboard.alert.lowBoundaryConfidence", {
        source: alert.source ? boundarySourceLabel(t, alert.source) : "–",
      });
    case "no-detection":
      return t("dashboard.alert.noDetection");
    case "estimated-hail-zone":
      return t("dashboard.alert.estimatedHailZone", {
        zone: alert.value ?? "–",
      });
  }
}
