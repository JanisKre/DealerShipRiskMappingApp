import { useState } from "react";
import { useTranslation } from "react-i18next";
import { type TFunction } from "i18next";
import { ChevronDown, ChevronRight, TriangleAlert } from "lucide-react";
import type { AnalyzedDealership, RiskParameters } from "@shared/types";
import { Button } from "@renderer/components/ui/button";
import {
  IMAGERY_STALE_AFTER_YEARS,
  imageryAgeYears,
} from "@shared/imagery-metadata";
import { isAreaEstimatedDetection } from "@shared/risk-math";
import { hasEalBasis } from "@shared/estimates";
import type { HailVehicleSource } from "@shared/risk-math";
import { buildUnderwritingMessages } from "../UnderwritingMessages";
import { boundaryReviewText } from "./boundaryText";

export type DetailTab = "overview" | "site" | "contract" | "sources";

interface Attention {
  key: string;
  tone: "warning" | "danger";
  title: string;
  detail?: string;
  action?: { label: string; run: () => void };
}

/**
 * One notice as a single line: what is wrong and what to do. The longer
 * explanation opens on demand instead of filling the dialog by default.
 */
export function AttentionRow({
  item,
}: Readonly<{ item: Attention }>): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const danger = item.tone === "danger";
  return (
    <div
      className={`rounded-md border-l-4 bg-muted/30 px-2.5 py-1.5 text-sm ${
        danger ? "border-l-destructive" : "border-l-warning"
      }`}
    >
      <div className="flex items-center gap-2">
        <TriangleAlert
          className={`size-3.5 shrink-0 ${
            danger ? "text-destructive" : "text-warning-foreground"
          }`}
        />
        <span className="min-w-0 flex-1 truncate font-medium">
          {item.title}
        </span>
        {item.detail && (
          <Button
            variant="link"
            size="sm"
            className="h-6 shrink-0 gap-0.5 px-0 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            {t("dashboard.detailDialog.attentionWhy")}
            {open ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
          </Button>
        )}
        {item.action && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 shrink-0 px-2 text-xs"
            onClick={item.action.run}
          >
            {item.action.label}
          </Button>
        )}
      </div>
      {open && item.detail && (
        <p className="mt-1 pl-5.5 text-xs text-muted-foreground">
          {item.detail}
        </p>
      )}
    </div>
  );
}

/**
 * Where the vehicle figure in the header comes from. "aus dem Luftbild" only
 * for a model count; an area estimate is never presented as seen on the
 * aerial image (UW-03).
 */
export function vehicleHint(
  t: TFunction,
  source: HailVehicleSource,
  detection: AnalyzedDealership["detection"],
  locale?: string,
): string | undefined {
  if (!detection) return undefined;
  if (source === "manual") return t("dashboard.detailDialog.kpiVehiclesManual");
  if (source === "detected") {
    // "Counted, on which image": the two things asked first about the count.
    const capturedAt = detection.imagery?.chosen.capturedAt;
    const date = capturedAt ? new Date(capturedAt) : null;
    return date && !Number.isNaN(date.getTime())
      ? t("dashboard.detailDialog.kpiVehiclesDetectedOn", {
          date: date.toLocaleDateString(locale, {
            month: "2-digit",
            year: "numeric",
            timeZone: "UTC",
          }),
        })
      : t("dashboard.detailDialog.kpiVehiclesDetected");
  }
  if (isAreaEstimatedDetection(detection))
    return t("dashboard.detailDialog.kpiVehiclesAreaEstimate");
  if (source === "estimated" || source === "assetValue")
    return t("dashboard.detailDialog.kpiVehiclesEstimated");
  return undefined;
}

export function KeyFigure({
  label,
  value,
  hint,
  tone,
}: Readonly<{
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "warning";
}>): React.JSX.Element {
  return (
    <div
      className={`rounded-lg border px-2.5 py-2 ${
        tone === "warning" ? "border-warning/40 bg-warning/10" : ""
      }`}
    >
      <div className="truncate text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-base font-semibold">{value}</div>
      {hint && (
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {hint}
        </div>
      )}
    </div>
  );
}

/**
 * Notices that ask for an action. Positive or purely descriptive messages
 * ("low hail risk") are left out: the numbers above already say that.
 */
export function buildAttention(
  t: TFunction,
  d: AnalyzedDealership,
  dealerships: AnalyzedDealership[],
  parameters: RiskParameters,
  openSite: () => void,
  openSettings: () => void,
  /** Opens the image history; the site tab otherwise. */
  openImageryHistory: () => void = openSite,
): Attention[] {
  const items: Attention[] = [];
  if (d.boundary?.reviewRequired) {
    const because = boundaryReviewText(t, d.boundary, parameters);
    items.push({
      key: "boundary",
      tone: "warning",
      title: t("dashboard.detailDialog.attentionBoundaryTitle"),
      // "Prüfen, weil: …" has no full stop of its own.
      detail: because
        ? `${because.replace(/([^.!?])$/u, "$1.")} ${t("dashboard.detailDialog.attentionBoundaryDetail")}`
        : t("dashboard.detailDialog.attentionBoundaryDetail"),
      action: {
        label: t("dashboard.detailDialog.attentionBoundaryAction"),
        run: openSite,
      },
    });
  }
  // A reviewed count replaces the estimate, so nothing is left to set up.
  if (
    isAreaEstimatedDetection(d.detection) &&
    d.detection?.manualVehicleCount == null
  ) {
    items.push({
      key: "model",
      tone: "warning",
      title: t("dashboard.detailDialog.attentionModelTitle"),
      detail: t("dashboard.detailDialog.attentionModelDetail"),
      action: {
        label: t("dashboard.detailDialog.attentionModelAction"),
        run: openSettings,
      },
    });
  }
  const capturedAt = d.detection?.imagery?.chosen.capturedAt;
  const age = capturedAt ? imageryAgeYears(capturedAt) : null;
  if (age != null && age >= IMAGERY_STALE_AFTER_YEARS) {
    items.push({
      key: "imagery",
      tone: "warning",
      title: t("dashboard.detailDialog.attentionImageryTitle", { count: age }),
      detail: t("dashboard.detailDialog.attentionImageryDetail"),
      action: {
        label: t("dashboard.detailDialog.attentionImageryAction"),
        run: openImageryHistory,
      },
    });
  }
  for (const [index, message] of buildUnderwritingMessages(
    t,
    d,
    dealerships,
    parameters,
  ).entries()) {
    if (message.severity !== "warning" && message.severity !== "danger") {
      continue;
    }
    items.push({
      key: `uw-${index}`,
      tone: message.severity,
      title: message.title,
      detail: message.detail,
    });
  }
  return items;
}

/**
 * Position of this location when the portfolio is sorted by hail EAL,
 * highest first. Null below three locations, where a rank says nothing.
 */
export function portfolioRank(
  d: AnalyzedDealership,
  dealerships: AnalyzedDealership[],
): { rank: number; total: number } | null {
  // Only sites with a vehicle count have a hail EAL to rank by.
  if (!hasEalBasis(d)) return null;
  const own = d.risk?.eal;
  if (own == null) return null;
  const eals = dealerships
    .filter(hasEalBasis)
    .map((x) => x.risk?.eal)
    .filter((eal): eal is number => eal != null);
  if (eals.length < 3) return null;
  return {
    rank: eals.filter((eal) => eal > own).length + 1,
    total: eals.length,
  };
}
