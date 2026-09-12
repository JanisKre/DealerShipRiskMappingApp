import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { AnalyzedDealership } from "@shared/types";
import { computePML } from "@shared/risk-math";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@renderer/components/ui/card";
import { eur, num } from "@renderer/lib/format";

/**
 * Probable Maximum Loss (PML) per return period (10/50/100 years).
 * Uses the worst 100 km cluster in the portfolio (computePML from risk-math).
 */
export function PmlCard({
  dealerships,
}: {
  dealerships: AnalyzedDealership[];
}): React.JSX.Element {
  const { t } = useTranslation();
  const results = useMemo(
    () => ([10, 50, 100] as const).map((rp) => computePML(dealerships, rp)),
    [dealerships],
  );
  const worst = results[results.length - 1];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("dashboard.pml")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          {results.map((r) => (
            <div key={r.returnPeriod} className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">
                {t("ui.returnPeriodEvent", { years: r.returnPeriod })}
              </div>
              <div className="mt-1 text-lg font-semibold">
                {eur(r.estimatedLossEur)}
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {t("ui.worstCluster", { radius: worst.clusterRadiusKm })}:{" "}
          {num(worst.dealershipsInScenario)} {t("dashboard.locations")}.{" "}
          {t("ui.lossFractionIncreases")}
        </p>
      </CardContent>
    </Card>
  );
}
