import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Info, TrendingUp } from "lucide-react";
import type { AnalyzedDealership } from "@shared/types";
import {
  anomalyMetricLabel,
  detectAnomalies,
  generateAlerts,
  type Alert,
} from "@shared/analytics";
import { Badge } from "@renderer/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@renderer/components/ui/card";
import { eur } from "@renderer/lib/format";
import { useAppStore } from "@renderer/store/appStore";

/**
 * Insights tile: rule-based alerts (extreme risk, EAL concentration,
 * over-utilisation, uncertain boundary, zero detection) plus statistical
 * outliers (z-score ≥ 2). Clicking an entry opens the detail dialog.
 */
export function InsightsPanel({
  dealerships,
  onSelect,
}: Readonly<{
  dealerships: AnalyzedDealership[];
  onSelect: (d: AnalyzedDealership) => void;
}>): React.JSX.Element | null {
  const { t } = useTranslation();
  const parameters = useAppStore((s) => s.parameters);
  const alerts = useMemo(
    () => generateAlerts(dealerships, {
      extremeScore: parameters.alertExtremeScore,
      overcapacity: parameters.alertOvercapacity,
      lowBoundaryConfidence: parameters.alertLowBoundaryConfidence,
      ealPortfolioShare: parameters.alertEalPortfolioShare,
    }),
    [dealerships, parameters],
  );
  const anomalies = useMemo(() => detectAnomalies(dealerships), [dealerships]);
  const byId = useMemo(
    () => new Map(dealerships.map((d) => [d.id, d])),
    [dealerships],
  );

  function open(id: string): void {
    const d = byId.get(id);
    if (d) onSelect(d);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="size-4 text-amber-500" /> Anomalies
          <span className="text-xs font-normal text-muted-foreground">
            {alerts.length} alerts · {anomalies.length} outliers
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {alerts.length === 0 && anomalies.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t("dashboard.noAnomalies")}
          </p>
        )}
        {alerts.length > 0 && (
          <ul className="space-y-1.5">
            {alerts.slice(0, 8).map((a, i) => (
              <li key={`${a.dealershipId}-${a.kind}-${i}`}>
                <button
                  type="button"
                  onClick={() => open(a.dealershipId)}
                  className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  <AlertBadge level={a.level} />
                  <span className="flex-1">
                    <span className="font-medium">{a.name}</span> — {a.message}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {anomalies.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <TrendingUp className="size-3.5" /> Statistical Outliers
            </div>
            <ul className="space-y-1">
              {anomalies.slice(0, 6).map((an, i) => (
                <li key={`${an.dealershipId}-${an.metric}-${i}`}>
                  <button
                    type="button"
                    onClick={() => open(an.dealershipId)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent"
                  >
                    <Info className="size-3.5 shrink-0 text-sky-500" />
                    <span className="flex-1">
                      <span className="font-medium">{an.name}</span>:{" "}
                      {anomalyMetricLabel(an.metric)}{" "}
                      {an.metric === "eal"
                        ? eur(an.value)
                        : an.value.toFixed(an.metric === "utilisation" ? 2 : 0)}
                    </span>
                    <span
                      className={`text-xs tabular-nums ${
                        an.severity === "high"
                          ? "text-destructive"
                          : "text-muted-foreground"
                      }`}
                    >
                      {an.zScore > 0 ? "+" : ""}
                      {an.zScore.toFixed(1)}σ
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AlertBadge({
  level,
}: Readonly<{ level: Alert["level"] }>): React.JSX.Element {
  return level === "critical" ? (
    <Badge variant="destructive" className="shrink-0">
      Critical
    </Badge>
  ) : (
    <Badge variant="secondary" className="shrink-0">
      Warning
    </Badge>
  );
}
