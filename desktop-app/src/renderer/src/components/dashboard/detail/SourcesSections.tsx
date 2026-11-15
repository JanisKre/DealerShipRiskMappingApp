import { useState } from "react";
import { useTranslation } from "react-i18next";
import i18next, { type TFunction } from "i18next";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import type { AnalyzedDealership } from "@shared/types";
import { sourceLabel } from "@shared/natcat-catalog";
import { Button } from "@renderer/components/ui/button";
import { useAppStore } from "@renderer/store/appStore";
import { pct } from "@renderer/lib/format";
import { estimateHailZoneFromScore } from "@shared/risk-math";
import { formatIsoDate } from "./shared";
import { boundaryRoleLabel } from "./boundaryText";

/**
 * Risk-model provenance: confidence at a glance, with the full limitations
 * and evidence-source list (required to stay reproducible/source-aware)
 * behind a single "Show details" disclosure rather than always spelled out.
 */
export function ModelConfidenceSummary({
  d,
}: {
  d: AnalyzedDealership;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  if (!d.risk) return null;
  const limitations = d.risk.limitations ?? [];
  const evidence = d.risk.evidence ?? [];

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <h4 className="font-semibold">{t("ui.modelConfidence")}</h4>
        <span className="text-muted-foreground">
          {pct(d.risk.confidence, 0)}
          {d.risk.modelVersion ? ` · ${d.risk.modelVersion}` : ""}
        </span>
      </div>
      {evidence.length > 0 && (
        <details className="rounded-md border text-xs">
          <summary className="px-2 py-1.5 font-medium text-muted-foreground">
            {t("dashboard.detailDialog.sourcesUsedCount", {
              count: evidence.length,
            })}
          </summary>
          <ul className="space-y-1 border-t px-2 py-2">
            {evidence.map((item) => (
              <li
                key={`${item.source}-${item.method}`}
                className="flex justify-between gap-3"
              >
                <span className="min-w-0">
                  <span className="font-medium">
                    {localizedRiskText(t, item.source)}
                  </span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {localizedRiskText(t, item.method)}
                    {item.fallbackUsed
                      ? t("dashboard.detailDialog.evidenceFallbackSuffix")
                      : ""}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {pct(item.confidence, 0)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {limitations.length > 0 && (
        <details className="rounded-md border text-xs">
          <summary className="px-2 py-1.5 font-medium text-muted-foreground">
            {t("dashboard.detailDialog.limitationsToggle", {
              count: limitations.length,
            })}
          </summary>
          <ul className="list-disc space-y-1 border-t py-2 pl-6 pr-2 text-muted-foreground">
            {limitations.map((limitation) => (
              <li key={limitation}>{localizedRiskText(t, limitation)}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Localizes persisted provenance text while keeping unknown provider text intact. */
function localizedRiskText(t: TFunction, text: string): string {
  const exact: Record<string, string> = {
    "Hazard values are location-level proxies and should be validated before underwriting decisions":
      "dashboard.detailDialog.riskText.hazardProxy",
    "Not a catastrophe-model or engineering assessment":
      "dashboard.detailDialog.riskText.notEngineeringAssessment",
    "92-day weather window with screening proxies":
      "dashboard.detailDialog.riskText.weatherWindow",
    "synthetic radius fallback":
      "dashboard.detailDialog.riskText.syntheticBoundaryMethod",
    "geospatial boundary lookup":
      "dashboard.detailDialog.riskText.boundaryLookupMethod",
    "Manual boundary review recommended":
      "dashboard.detailDialog.riskText.manualBoundaryReview",
    "area-based estimate": "dashboard.detailDialog.riskText.areaEstimateMethod",
    "aerial object detection":
      "dashboard.detailDialog.riskText.aerialDetectionMethod",
    "Vehicle count is estimated; install the detector model":
      "dashboard.detailDialog.riskText.vehicleEstimate",
    "Synthetic lot boundary used":
      "dashboard.detailDialog.riskText.syntheticBoundary",
    "Boundary requires review before underwriting use":
      "dashboard.detailDialog.riskText.boundaryReviewRequired",
    "Boundary sources do not sufficiently agree":
      "dashboard.detailDialog.riskText.boundaryDisagreement",
    "Vehicle exposure is estimated because no ML model is installed":
      "dashboard.detailDialog.riskText.noMlModel",
    "Hail zone estimated from weather data; no postcode hail zone available":
      "dashboard.detailDialog.riskText.hailZoneEstimated",
    "Hail EAL frequency and severity parameters are uncalibrated placeholders":
      "dashboard.detailDialog.riskText.hailEalPlaceholders",
    "Hail EAL vehicle count derived from the declared asset value":
      "dashboard.detailDialog.riskText.hailVehiclesFromAssetValue",
    "Postcode hail zones": "dashboard.detailDialog.riskText.postcodeHailZones",
    "postcode hail-zone lookup":
      "dashboard.detailDialog.riskText.postcodeHailZoneMethod",
    "hail zone estimated from weather-based hail score":
      "dashboard.detailDialog.riskText.estimatedHailZoneMethod",
    "cascade stage 1: cadastral parcels holding the vehicle lot":
      "dashboard.detailDialog.riskText.cascadeVehicleParcels",
    "cascade stage 2: outline of the detected vehicle lot":
      "dashboard.detailDialog.riskText.cascadeVehicleHull",
    "cascade stage 3: car-dealer area at the point":
      "dashboard.detailDialog.riskText.cascadeOsmDealerArea",
    "cascade stage 4: cadastral parcel containing the point":
      "dashboard.detailDialog.riskText.cascadeParcel",
  };
  const key = exact[text];
  if (key) return t(key);
  // The vehicle detector describes itself technically ("dealer_vehicles
  // ONNX", "sliding-window oriented aerial vehicle detection at 0.1 m/px…").
  if (/^dealer_vehicles\b/.test(text))
    return t("dashboard.detailDialog.riskText.vehicleDetectorSource");
  const detector = text.match(
    /^sliding-window oriented aerial vehicle detection at ([\d.]+) m\/px/,
  );
  if (detector)
    return t("dashboard.detailDialog.riskText.vehicleDetectorMethod", {
      resolution: detector[1].replace(".", ","),
    });
  const screening = text.match(/^Risk model (.+) is a screening model$/);
  if (screening)
    return t("dashboard.detailDialog.riskText.screeningModel", {
      version: screening[1],
    });
  const confirmed = text.match(
    /^Boundary confirmed by visual review on (\d{4}-\d{2}-\d{2}), not a cadastral survey$/,
  );
  if (confirmed)
    return t("dashboard.detailDialog.riskText.boundaryConfirmed", {
      date: formatIsoDate(confirmed[1], i18next.language),
    });
  const role = text.match(
    /^Boundary represents (.+), not a confirmed operational lot$/,
  );
  if (role)
    return t("dashboard.detailDialog.riskText.boundaryRole", {
      role: boundaryRoleLabel(t, role[1]),
    });
  return text;
}

export function NatCatSection({
  d,
}: {
  d: AnalyzedDealership;
}): React.JSX.Element {
  const { t } = useTranslation();
  const refreshNatCat = useAppStore((state) => state.refreshNatCat);
  const [refreshing, setRefreshing] = useState(false);
  const assessment = d.natCat ?? d.risk?.natCat;

  async function refresh(): Promise<void> {
    setRefreshing(true);
    try {
      await refreshNatCat(d.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshing(false);
    }
  }

  const refreshButton = (
    <Button
      size="sm"
      variant="ghost"
      className="h-7 shrink-0 gap-1 text-xs"
      disabled={refreshing}
      onClick={() => void refresh()}
    >
      <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
      {refreshing
        ? t("dashboard.detailDialog.natCatRefreshing")
        : t("dashboard.detailDialog.natCatRefresh")}
    </Button>
  );

  // Without an external source there is nothing to show but that fact.
  if (!assessment)
    return (
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{t("dashboard.detailDialog.natCatNone")}</span>
        {refreshButton}
      </div>
    );

  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-semibold">
          {t("dashboard.detailDialog.natCatTitle")}
        </h4>
        {refreshButton}
      </div>
      <>
        <div className="text-xs text-muted-foreground">
          {assessment.evidence.source} · {assessment.dataVersion ?? "unknown"}
        </div>
        <div className="grid gap-1 text-xs sm:grid-cols-2">
          {assessment.hazards.map((hazard) => (
            <div key={`${hazard.peril}-${hazard.unit}`}>
              {t("dashboard.detailDialog.natCatHazard", {
                peril: hazard.peril,
                zone: estimateHailZoneFromScore(hazard.score),
                unit: hazard.unit,
              })}
              {/* Source per value in assessments combined by older builds. */}
              {assessment.provider === "composite" && hazard.provider && (
                <span className="text-muted-foreground">
                  {" "}
                  · {sourceLabel(hazard.provider)}
                </span>
              )}
            </div>
          ))}
        </div>
        {assessment.evidence.fallbackUsed && (
          <ul className="list-inside list-disc text-xs text-muted-foreground marker:text-warning-foreground">
            {assessment.evidence.limitations
              .filter((note) => note.includes(" used instead"))
              .map((note) => (
                <li key={note}>{note}</li>
              ))}
          </ul>
        )}
        {Object.entries(assessment.attributes).map(([name, value]) => (
          <div key={name} className="text-xs text-muted-foreground">
            {t("dashboard.detailDialog.natCatAttribute", {
              name,
              value: String(value),
            })}
          </div>
        ))}
      </>
    </div>
  );
}
