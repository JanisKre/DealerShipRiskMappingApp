import { useMemo } from "react";
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
  const results = useMemo(
    () => ([10, 50, 100] as const).map((rp) => computePML(dealerships, rp)),
    [dealerships],
  );
  const worst = results[results.length - 1];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Probable Maximum Loss (PML)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          {results.map((r) => (
            <div key={r.returnPeriod} className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">
                {r.returnPeriod}-year event
              </div>
              <div className="mt-1 text-lg font-semibold">
                {eur(r.estimatedLossEur)}
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Worst {worst.clusterRadiusKm} km cluster:{" "}
          {num(worst.dealershipsInScenario)} locations. Loss fraction
          increases with the return period.
        </p>
      </CardContent>
    </Card>
  );
}
