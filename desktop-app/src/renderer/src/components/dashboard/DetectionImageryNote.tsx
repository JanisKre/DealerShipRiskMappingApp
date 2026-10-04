import { useTranslation } from "react-i18next";
import { Satellite } from "lucide-react";
import type { DetectionResult } from "@shared/types";
import {
  IMAGERY_STALE_AFTER_YEARS,
  imageryAgeYears,
} from "@shared/imagery-metadata";
import { cn } from "@renderer/lib/utils";

/**
 * Which image the vehicle count was made on. Analyses from before automatic
 * source selection carry no record; the note then says so instead of
 * implying a date.
 */
export function DetectionImageryNote({
  detection,
}: Readonly<{ detection?: DetectionResult }>): React.JSX.Element | null {
  const { t, i18n } = useTranslation();
  if (!detection) return null;
  const imagery = detection.imagery;
  if (!imagery) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Satellite className="size-3.5 shrink-0" />
        {t("dashboard.detailDialog.imageryUnrecorded")}
      </p>
    );
  }

  const c = imagery.chosen;
  const date = c.capturedAt
    ? new Intl.DateTimeFormat(i18n.language, {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(new Date(`${c.capturedAt}T00:00:00Z`))
    : t("map.legend.imageryUnknown");
  const ageYears = c.capturedAt ? imageryAgeYears(c.capturedAt) : null;
  const stale = ageYears != null && ageYears >= IMAGERY_STALE_AFTER_YEARS;
  const resolution =
    c.resolutionM != null
      ? ` · ${new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }).format(c.resolutionM)} m`
      : "";

  return (
    <div className="flex items-start gap-1.5 text-xs">
      <Satellite className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div>
        <span className="text-muted-foreground">
          {t("dashboard.detailDialog.imageryCountedOn")}{" "}
        </span>
        <span className="font-medium">{c.label}</span>
        {" · "}
        <span
          className={cn(stale && "text-amber-600 dark:text-amber-400")}
        >
          {date}
          {stale && ` (${t("map.legend.imageryAge", { count: ageYears })})`}
        </span>
        {resolution}
        <span className="text-muted-foreground">
          {" — "}
          {t(`map.legend.imageryReasons.${imagery.reason}`)}
        </span>
      </div>
    </div>
  );
}
