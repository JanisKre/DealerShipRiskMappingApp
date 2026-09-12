import { useMemo } from "react";
import type { AnalyzedDealership } from "@shared/types";
import { computeCoverage } from "@shared/analytics";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@renderer/components/ui/card";
import { pct } from "@renderer/lib/format";
import { perilLabel, perilColor } from "@renderer/lib/perilLabel";

/**
 * Coverage/concentration tile: avg. score + share of highly exposed
 * locations per peril (bar), plus diversification metrics
 * (HHI, effective location count, share of the strongest cluster cell).
 */
export function CoverageCard({
  dealerships,
}: Readonly<{ dealerships: AnalyzedDealership[] }>): React.JSX.Element {
  const report = useMemo(() => computeCoverage(dealerships), [dealerships]);
  const perils = [...report.perils].sort((a, b) => b.avgScore - a.avgScore);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Peril Coverage & Concentration
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-2">
          {perils.map((p) => (
            <li key={p.peril} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5">
                  <span
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: perilColor(p.peril) }}
                  />
                  {perilLabel(p.peril)}
                </span>
                <span className="text-muted-foreground">
                  Avg {p.avgScore.toFixed(0)} · {pct(p.highShare)} high
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(100, p.avgScore)}%`,
                    backgroundColor: perilColor(p.peril),
                  }}
                />
              </div>
            </li>
          ))}
        </ul>

        <div className="grid grid-cols-2 gap-3 border-t pt-3 text-sm">
          <Stat
            label="Diversification (HHI)"
            value={report.concentration.herfindahl.toFixed(3)}
            hint={`≈ ${report.concentration.effectiveLocations.toFixed(1)} eff. locations`}
          />
          <Stat
            label="Largest Cluster Cell"
            value={pct(report.concentration.topCellShare)}
            hint="Share of EAL"
          />
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  hint,
}: Readonly<{
  label: string;
  value: string;
  hint?: string;
}>): React.JSX.Element {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
