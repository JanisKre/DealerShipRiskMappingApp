import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Badge } from "@renderer/components/ui/badge";
import { cn } from "@renderer/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@renderer/components/ui/tooltip";
import type { EstimateReason } from "./estimates";

/**
 * Muted "≈" before a figure that is an estimate (see `estimateReasons`),
 * with the reason in a tooltip and for screen readers.
 */
export function EstimateMark({
  reasons,
}: Readonly<{ reasons: EstimateReason[] }>): React.JSX.Element | null {
  const { t } = useTranslation();
  if (reasons.length === 0) return null;
  const text = reasons
    .map((reason) => t(`dashboard.table.estimate.${reason}`))
    .join(" ");
  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <span
          className="mr-0.5 cursor-help text-muted-foreground"
          aria-label={`${t("dashboard.table.estimate.mark")}: ${text}`}
        >
          ≈
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{text}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Stands in for the hail EAL of a location without a vehicle count: the
 * model gives no EAL there (N = 0 by design), so "0 €" would read as a
 * result. The tooltip says how to get one.
 */
export function NoEalBadge({
  className,
}: Readonly<{ className?: string }>): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-help">
          <Badge
            variant="outline"
            className={cn("font-normal text-muted-foreground", className)}
          >
            {t("dashboard.noEal.badge")}
          </Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">
        {t("dashboard.noEal.tooltip")}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * "≈" plus "davon X % geschätzt" next to an exposure-based figure
 * (accumulation, scenario) when part of the exposure is an estimate.
 */
export function estimatedShareSuffix(t: TFunction, share: number): string {
  if (share <= 0) return "";
  return t("dashboard.estimatedShare", {
    share: Math.round(share * 100),
  });
}
