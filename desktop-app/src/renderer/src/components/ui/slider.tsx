import * as React from "react";
import { cn } from "@renderer/lib/utils";

/**
 * Simple slider without an external Radix dependency (@radix-ui/react-slider is not installed).
 * Styled like the other shadcn UI primitives: accent-color picks up the CSS primary.
 */
export interface SliderProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Current value (0..1). The parent component is controlled. */
  value?: number;
  onValueChange?: (value: number) => void;
}

export function Slider({
  className,
  value,
  onValueChange,
  min = 0,
  max = 1,
  step = 0.05,
  ...props
}: SliderProps): React.JSX.Element {
  return (
    <input
      type="range"
      className={cn(
        "h-2 w-full cursor-pointer appearance-none rounded-full bg-secondary",
        "[&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none",
        "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary",
        "[&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-primary",
        className,
      )}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onValueChange?.(Number(e.target.value))}
      {...props}
    />
  );
}
