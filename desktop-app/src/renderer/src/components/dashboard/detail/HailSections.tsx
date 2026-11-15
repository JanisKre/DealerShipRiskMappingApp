import { useTranslation } from "react-i18next";
import type {
  AnalyzedDealership,
  EalBreakdown,
  HailRiskTier,
} from "@shared/types";
import { eur, num } from "@renderer/lib/format";
import { displayedHailVehicleSource } from "@shared/risk-math";

/** Locale keys for the stored (English) hail risk tier values. */
const RISK_TIER_KEYS: Record<HailRiskTier, string> = {
  "Very Low": "veryLow",
  Low: "low",
  Moderate: "moderate",
  High: "high",
  "Very High": "veryHigh",
};

/** Hail zone and how the EAL in the header was derived. */
export function HailOverview({
  d,
}: {
  d: AnalyzedDealership;
}): React.JSX.Element {
  const { t } = useTranslation();
  const eb = d.risk?.ealBreakdown;
  return (
    <div className="space-y-3 text-sm">
      {eb && <HailEalSection eb={eb} detection={d.detection} />}
      {/* The zone itself is the badge in the header; only the tariff class
          adds information here. */}
      {d.hailRiskTier && (
        <p className="text-xs text-muted-foreground">
          {t("dashboard.detailDialog.hailZoneKasko", {
            tier: t(
              `dashboard.detailDialog.riskTier.${RISK_TIER_KEYS[d.hailRiskTier]}`,
            ),
          })}
        </p>
      )}
    </div>
  );
}

/** Shows how the hail EAL was derived: N × λ_z × S̄, with each input's source. */
function HailEalSection({
  eb,
  detection,
}: Readonly<{
  eb: EalBreakdown;
  detection: AnalyzedDealership["detection"];
}>): React.JSX.Element {
  const { t } = useTranslation();
  const detail = eb.hailDetail;
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold">
        {t("dashboard.hailEalDetail.title")}
      </h4>
      {detail ? (
        <>
          {/* One line instead of three cards that repeated the sentence. */}
          <p className="rounded-md bg-muted/40 px-3 py-2 font-medium tabular-nums">
            {t("dashboard.hailEalDetail.formula", {
              vehicles: num(detail.vehicles),
              frequency: num(detail.frequency, 3),
              severity: eur(detail.meanSeverityEur),
              eal: eur(eb.hail),
            })}
          </p>
          <p className="text-xs text-muted-foreground">
            {t(
              `dashboard.hailEalDetail.vehicleSource.${displayedHailVehicleSource(detail.vehicleSource, detection)}`,
            )}{" "}
            {t(`dashboard.hailEalDetail.zoneSource.${detail.zoneSource}`)}{" "}
            {t("dashboard.hailEalDetail.severityNote")}
          </p>
          {/* λ, p and S are placeholders until calibrated (UX-06). */}
          <p className="text-xs text-muted-foreground">
            {t("parameters.hailEal.placeholders")}
          </p>
          {detail.stockRange ? (
            <p className="text-xs tabular-nums">
              {t("dashboard.hailEalDetail.stockRange", {
                count: detail.stockRange.images,
                low: eur(detail.stockRange.ealLow),
                median: eur(detail.stockRange.ealMedian),
                high: eur(detail.stockRange.ealHigh),
                vehiclesLow: num(detail.stockRange.vehiclesLow),
                vehiclesHigh: num(detail.stockRange.vehiclesHigh),
              })}{" "}
              {detail.stockRange.snapshot !== "typical" &&
                t(
                  `dashboard.hailEalDetail.stockSnapshot.${detail.stockRange.snapshot}`,
                )}{" "}
              {detail.stockRange.scaledToManual &&
                t("dashboard.hailEalDetail.stockScaled")}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("dashboard.hailEalDetail.stockRangeMissing")}
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("dashboard.hailEalDetail.legacy", { eal: eur(eb.total) })}
        </p>
      )}
    </div>
  );
}
