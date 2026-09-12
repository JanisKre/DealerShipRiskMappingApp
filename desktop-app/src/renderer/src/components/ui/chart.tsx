import * as React from "react";
import * as RechartsPrimitive from "recharts";
import { cn } from "@renderer/lib/utils";

/**
 * Schlanker Chart-Wrapper (recharts v2). `ChartContainer` stellt einen
 * ResponsiveContainer bereit und injiziert je Serie eine CSS-Variable
 * `--color-<key>`, sodass Tooltips/Legende dieselben Farben nutzen.
 */

export interface ChartConfig {
  [key: string]: { label?: React.ReactNode; color?: string };
}

interface ChartContextValue {
  config: ChartConfig;
}

const ChartContext = React.createContext<ChartContextValue | null>(null);

export function useChartConfig(): ChartConfig {
  const ctx = React.useContext(ChartContext);
  return ctx?.config ?? {};
}

const ChartContainer = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    config: ChartConfig;
    children: React.ComponentProps<
      typeof RechartsPrimitive.ResponsiveContainer
    >["children"];
  }
>(({ className, config, children, ...props }, ref) => {
  const styleVars = React.useMemo<React.CSSProperties>(() => {
    const vars: Record<string, string> = {};
    for (const [key, value] of Object.entries(config)) {
      if (value.color) vars[`--color-${key}`] = value.color;
    }
    return vars as React.CSSProperties;
  }, [config]);

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        ref={ref}
        className={cn("flex aspect-video justify-center text-xs", className)}
        style={styleVars}
        {...props}
      >
        <RechartsPrimitive.ResponsiveContainer>
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
});
ChartContainer.displayName = "ChartContainer";

const ChartTooltip = RechartsPrimitive.Tooltip;

/** Einfacher Tooltip-Inhalt im Card-Stil. */
function ChartTooltipContent({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string }>;
  label?: React.ReactNode;
}): React.JSX.Element | null {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
      {label != null && <div className="mb-1 font-medium">{label}</div>}
      <div className="flex flex-col gap-0.5">
        {payload.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: item.color ?? "currentColor" }}
            />
            <span className="text-muted-foreground">{item.name}</span>
            <span className="ml-auto font-mono font-medium">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export { ChartContainer, ChartTooltip, ChartTooltipContent };
