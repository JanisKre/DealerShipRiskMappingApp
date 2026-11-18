import { useTranslation } from "react-i18next";
import type {
  AnalyzedDealership,
  EalBreakdown,
  HailRiskTier,
} from "@shared/types";
import { eur, num } from "@renderer/lib/format";
import { displayedHailVehicleSource } from "@shared/risk-math";
import { Disclosure } from "./shared";

/** Locale keys for the stored (English) hail risk tier values. */
const RISK_TIER_KEYS: Record<HailRiskTier, string> = {
  "Very Low": "veryLow",
  Low: "low",
  Moderate: "moderate",
  High: "high",
  "Very High": "veryHigh",
};

/**
 * How the EAL in the header was derived: the formula and the one sentence
 * that qualifies it. Where each input comes from, the placeholder note in
 * full and the range over time sit one click away.
 */
export function HailOverview({
  d,
}: {
  d: AnalyzedDealership;
}): React.JSX.Element {
  const { t } = useTranslation();
  const eb = d.risk?.ealBreakdown;
  const detail = eb?.hailDetail;
  if (!eb) return <></>;
  return (
    <div className="space-y-2 text-sm">
      <h4 className="text-sm font-semibold">
        {t("dashboard.hailEalDetail.title")}
      </h4>
      {detail ? (
        <>
          <p className="rounded-md bg-muted/40 px-3 py-2 font-medium tabular-nums">
            {t("dashboard.hailEalDetail.formula", {
              vehicles: num(detail.vehicles),
              frequency: num(detail.frequency, 3),
              severity: eur(detail.meanSeverityEur),
              eal: eur(eb.hail),
            })}
          </p>
          {/* λ, p and S are placeholders until calibrated (UX-06): the
              qualification stays in view, the long form is below. */}
          <p className="text-xs text-muted-foreground">
            {t("dashboard.hailEalDetail.screeningShort")}
          </p>
          {/* A range counted over archived images is a result, not a
              footnote: it stays in view once it exists. */}
          {detail.stockRange && (
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
          )}
          <Disclosure title={t("dashboard.hailEalDetail.inputsToggle")}>
            <HailEalInputs d={d} eb={eb} />
          </Disclosure>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("dashboard.hailEalDetail.legacy", { eal: eur(eb.total) })}
        </p>
      )}
    </div>
  );
}

/** Source of each input of N × λ_z × S̄, the caveats and the range over time. */
function HailEalInputs({
  d,
  eb,
}: Readonly<{
  d: AnalyzedDealership;
  eb: EalBreakdown;
}>): React.JSX.Element | null {
  const { t } = useTranslation();
  const detail = eb.hailDetail;
  if (!detail) return null;
  return (
    <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
      <li>
        {t(
          `dashboard.hailEalDetail.vehicleSource.${displayedHailVehicleSource(detail.vehicleSource, d.detection)}`,
        )}
      </li>
      <li>
        {t(`dashboard.hailEalDetail.zoneSource.${detail.zoneSource}`)}
        {/* The zone itself is the badge in the header; only the tariff
            class adds information here. */}
        {d.hailRiskTier &&
          ` ${t("dashboard.detailDialog.hailZoneKasko", {
            tier: t(
              `dashboard.detailDialog.riskTier.${RISK_TIER_KEYS[d.hailRiskTier]}`,
            ),
          })}.`}
      </li>
      <li>{t("dashboard.hailEalDetail.severityNote")}</li>
      <li>{t("dashboard.hailEalDetail.placeholdersShort")}</li>
      {!detail.stockRange && (
        <li>{t("dashboard.hailEalDetail.stockRangeMissing")}</li>
      )}
    </ul>
  );
}
