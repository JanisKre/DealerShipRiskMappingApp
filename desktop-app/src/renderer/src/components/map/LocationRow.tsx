import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ChevronRight, Loader2, ShieldCheck, Users } from "lucide-react";
import type { AnalyzedDealership } from "@shared/types";
import { dealershipHailZone } from "@shared/risk-math";
import { Checkbox } from "@renderer/components/ui/checkbox";
import { NoEalBadge } from "@renderer/components/dashboard/EstimateMark";
import { hasEalBasis } from "@shared/estimates";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@renderer/components/ui/tooltip";
import { cn } from "@renderer/lib/utils";
import { hailZoneColor } from "@renderer/lib/riskColor";
import { eur, num } from "@renderer/lib/format";

/** One row of the map's location list. */

/** A row including derived relationship info relative to the selected subject. */
export interface Row {
  d: AnalyzedDealership;
  /** Distance to the subject in km — null if nothing is selected or the row itself is the subject. */
  distanceKm: number | null;
  sameGroup: boolean;
  inRadius: boolean;
}

/** Neighbor summary text (avoids nested ternaries in JSX). */
export function neighborSummaryText(
  t: TFunction,
  count: number,
  radius: number,
): string {
  if (count === 0)
    return t("map.locationsPanel.neighborSummary.none", { radius });
  if (count === 1)
    return t("map.locationsPanel.neighborSummary.one", { radius });
  return t("map.locationsPanel.neighborSummary.other", { count, radius });
}

/** A clickable location row with a risk dot and relationship badges. */
export function LocationRow({
  row,
  selected,
  analyzing,
  batchRunning,
  showBusiness,
  onSelect,
  onOpenDetails,
  selectMode = false,
  checked = false,
  onToggleCheck,
}: Readonly<{
  row: Row;
  selected: boolean;
  /** The analysis of this location is running right now. */
  analyzing: boolean;
  /** A batch analysis is running (rows without a result are queued). */
  batchRunning: boolean;
  /** Business chips only help when the portfolio mixes both types. */
  showBusiness: boolean;
  onSelect: (id: string) => void;
  onOpenDetails: (id: string) => void;
  selectMode?: boolean;
  checked?: boolean;
  onToggleCheck?: (id: string) => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const { d, distanceKm, sameGroup, inRadius } = row;
  const hailZone = dealershipHailZone(d)?.zone;
  const dotColor = hailZone != null ? hailZoneColor(hailZone) : "#9ca3af";

  return (
    <li
      data-row-id={d.id}
      className={cn("flex items-stretch", selected && "bg-accent")}
    >
      {selectMode && (
        <label className="flex shrink-0 items-center pl-2.5">
          <Checkbox
            checked={checked}
            onCheckedChange={() => onToggleCheck?.(d.id)}
            aria-label={t("map.locationsPanel.selectFor", { name: d.name })}
          />
        </label>
      )}
      {/* Selection button (fills the row) */}
      <button
        type="button"
        className={cn(
          // select-none: a click on the name must not highlight its text.
          "flex min-w-0 flex-1 select-none items-start gap-2 px-2.5 py-2 text-left text-sm hover:bg-accent/60",
          FOCUS_RING_INSET,
        )}
        onClick={() => (selectMode ? onToggleCheck?.(d.id) : onSelect(d.id))}
        aria-pressed={selectMode ? checked : selected}
      >
        {/* Decorative: the zone is read out in the row text. */}
        <span
          aria-hidden
          className="mt-1 size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: dotColor }}
        />
        <div className="min-w-0 flex-1">
          {/* Full width for the name; the figure sits on the second line. */}
          <div className="truncate font-medium">{d.name}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
            {analyzing ? (
              <>
                <PendingSpinner pending />
                {t("map.locationsPanel.analyzing")}
              </>
            ) : !d.risk ? (
              t(
                batchRunning
                  ? "map.locationsPanel.pending"
                  : "map.locationsPanel.notAnalyzed",
              )
            ) : hasEalBasis(d) ? (
              t("map.locationsPanel.ealValue", { value: eur(d.risk.eal) })
            ) : (
              <NoEalBadge className="px-1.5 py-0 text-[11px]" />
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-1 empty:hidden">
            {d.group && (
              <Chip>
                <Users className="size-3" />
                {d.group}
              </Chip>
            )}
            {showBusiness && d.insured && (
              <Chip>
                <ShieldCheck className="size-3" />
                {t("map.locationsPanel.insuredChip")}
              </Chip>
            )}
            {d.boundary?.source === "synthetic" && (
              <Chip warning title={t("ui.fallbackBoundaryReview")}>
                {t("ui.fallbackBoundary")}
              </Chip>
            )}
            {distanceKm != null && (
              <Chip>
                {t("map.locationsPanel.distanceChip", {
                  distance: num(distanceKm, 1),
                })}
              </Chip>
            )}
            {sameGroup && (
              <Chip accent>{t("map.locationsPanel.sameGroupChip")}</Chip>
            )}
            {inRadius && (
              <Chip accent>{t("map.locationsPanel.inRadiusChip")}</Chip>
            )}
          </div>
        </div>
      </button>
      {/* Open details (separate button, not nested) — hidden while selecting */}
      {!selectMode && (
        <Tooltip delayDuration={150}>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={cn(
                "shrink-0 px-1.5 text-muted-foreground hover:text-foreground",
                FOCUS_RING_INSET,
              )}
              onClick={() => onOpenDetails(d.id)}
              aria-label={t("map.locationsPanel.viewDetailsFor", {
                name: d.name,
              })}
            >
              <ChevronRight className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">
            {t("map.locationsPanel.viewDetails")}
          </TooltipContent>
        </Tooltip>
      )}
    </li>
  );
}

/** Right side of the row: spinner while the analysis is running. */
function PendingSpinner({
  pending,
}: Readonly<{
  pending: boolean;
}>): React.JSX.Element | null {
  const { t } = useTranslation();
  if (!pending) return null;
  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <Loader2 className="size-3.5 animate-spin" />
      </TooltipTrigger>
      <TooltipContent side="left">
        {t("map.locationsPanel.analyzing")}
      </TooltipContent>
    </Tooltip>
  );
}

/** Small info chip; `accent` highlights relationship matches. */
function Chip({
  children,
  accent,
  warning,
  title,
}: Readonly<{
  children: React.ReactNode;
  accent?: boolean;
  warning?: boolean;
  title?: string;
}>): React.JSX.Element {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium",
        accent
          ? "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200"
          : warning
            ? "bg-warning/15 text-warning-foreground"
            : "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

/** Keyboard focus ring for raw buttons (spec: same as the `Button` ring). */
export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";
/** Inset variant for full-width rows, whose outer edge the list clips. */
export const FOCUS_RING_INSET =
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50";
