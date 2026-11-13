import { useTranslation } from "react-i18next";
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
