import * as React from "react";
import { Button } from "@renderer/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@renderer/components/ui/tooltip";

/**
 * Icon button with an instant tooltip. Native `title` tooltips are not shown
 * in Electron, so the label comes from the aria-label via Radix Tooltip.
 * Use it for every icon-only button. Needs a `TooltipProvider` above it.
 */
function HintButton({
  "aria-label": label,
  side = "bottom",
  ...props
}: Readonly<
  React.ComponentProps<typeof Button> & {
    "aria-label": string;
    side?: React.ComponentProps<typeof TooltipContent>["side"];
  }
>): React.JSX.Element {
  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        {/* span keeps the tooltip working while the button is disabled */}
        <span className="inline-flex shrink-0">
          <Button {...props} aria-label={label} />
        </span>
      </TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}

export { HintButton };
