import { useEffect, useState } from "react";
import { RISK_MODEL_VERSION } from "@shared/constants";
import { useTranslation } from "react-i18next";
import type { AnalyzedDealership } from "@shared/types";
import { ealCoverage, hasEalBasis } from "@shared/estimates";
import { eur } from "@renderer/lib/format";
import { useAppStore } from "@renderer/store/appStore";

/** What the edited parameters change in the portfolio's totals. */

/** Portfolio totals the parameters drive, for the impact bar. */
function portfolioTotals(dealerships: AnalyzedDealership[]): {
  eal: number;
  exposure: number;
  counted: number;
  analyzed: number;
} {
  let eal = 0;
  let exposure = 0;
  for (const d of dealerships) {
    if (!d.risk) continue;
    exposure += d.risk.exposureEur ?? 0;
    if (hasEalBasis(d)) eal += d.risk.eal;
  }
  const { withBasis, analyzed } = ealCoverage(dealerships);
  return { eal, exposure, counted: withBasis, analyzed };
}

function signedPercent(now: number, before: number): string | null {
  if (before <= 0 || Math.abs(now - before) < 0.5) return null;
  const change = ((now - before) / before) * 100;
  return `${change > 0 ? "+" : ""}${change.toFixed(Math.abs(change) < 10 ? 1 : 0)} %`;
}

/**
 * What the values on this page mean for the open portfolio, and how much
 * that moved since the page was opened, so a change is seen, not guessed.
 */
export function ImpactBar(): React.JSX.Element | null {
  const { t } = useTranslation();
  const dealerships = useAppStore((s) => s.dealerships);
  const updating = useAppStore((s) => s.parametersUpdating);
  const totals = portfolioTotals(dealerships);
  // Results of an older risk model are not what these values give; they are
  // recalculated with the first change. A change against them would show
  // the model update as the effect of the edit.
  const stale = dealerships.some(
    (d) => d.risk && d.risk.modelVersion !== RISK_MODEL_VERSION,
  );
  const [baseline, setBaseline] = useState({ totals, stale });
  useEffect(() => {
    if (baseline.stale && !stale && !updating)
      setBaseline({ totals, stale: false });
  }, [baseline.stale, stale, updating, totals]);
  if (totals.analyzed === 0) return null;
  const comparable = !baseline.stale && !stale;
  const ealDelta = comparable
    ? signedPercent(totals.eal, baseline.totals.eal)
    : null;
  const exposureDelta = comparable
    ? signedPercent(totals.exposure, baseline.totals.exposure)
    : null;
  return (
    <div
      role="status"
      className="sticky bottom-4 z-10 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border bg-card/95 px-4 py-2.5 text-sm shadow-lg backdrop-blur"
    >
      <span className="font-medium">
        {stale
          ? t("parameters.impact.titleStale")
          : t("parameters.impact.title")}
      </span>
      <span className="tabular-nums">
        {t("parameters.impact.eal")}{" "}
        <strong>{totals.counted > 0 ? eur(totals.eal) : "–"}</strong>
        {ealDelta && (
          <span className="ml-1 text-xs text-muted-foreground">
            ({ealDelta})
          </span>
        )}
      </span>
      <span className="tabular-nums">
        {t("parameters.impact.exposure")}{" "}
        <strong>{eur(totals.exposure)}</strong>
        {exposureDelta && (
          <span className="ml-1 text-xs text-muted-foreground">
            ({exposureDelta})
          </span>
        )}
      </span>
      <span className="text-xs text-muted-foreground">
        {updating
          ? t("parameters.recalculating")
          : t("parameters.impact.coverage", {
              counted: totals.counted,
              analyzed: totals.analyzed,
            })}
      </span>
    </div>
  );
}
