import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@renderer/components/ui/chart";

export interface Series {
  key: string;
  label: string;
  color: string;
  points: [number, number][];
}

/**
 * One measure over one x-axis, a line per run. Colour follows the run (fixed
 * by name), a legend is always shown, the tooltip lists every run at the
 * hovered x.
 */
export function RunLines({
  series,
  xLabel,
  xFormat = (x) => String(x),
  yFormat = (y) => y.toFixed(2),
  yDomain,
  className,
}: {
  series: Series[];
  xLabel: string;
  xFormat?: (x: number) => string;
  yFormat?: (y: number) => string;
  yDomain?: [number | "auto", number | "auto"];
  className?: string;
}): React.JSX.Element {
  if (!series.some((s) => s.points.length)) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        Noch keine Messwerte.
      </p>
    );
  }
  const xs = [
    ...new Set(series.flatMap((s) => s.points.map((p) => p[0]))),
  ].sort((a, b) => a - b);
  const data = xs.map((x) => {
    const row: Record<string, number> = { x };
    for (const s of series) {
      const p = s.points.find((q) => q[0] === x);
      if (p) row[s.key] = p[1];
    }
    return row;
  });
  const config: ChartConfig = Object.fromEntries(
    series.map((s) => [s.key, { label: s.label, color: s.color }]),
  );
  return (
    <div className={className}>
      <ChartContainer config={config} className="aspect-auto h-60 w-full">
        <LineChart
          data={data}
          margin={{ top: 8, right: 12, bottom: 18, left: 0 }}
        >
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="x"
            type="number"
            domain={["dataMin", "dataMax"]}
            ticks={xs.length > 12 ? undefined : xs}
            tickFormatter={xFormat}
            tickLine={false}
            axisLine={false}
            stroke="var(--muted-foreground)"
            label={{
              value: xLabel,
              position: "insideBottom",
              offset: -12,
              fill: "var(--muted-foreground)",
              fontSize: 11,
            }}
          />
          <YAxis
            width={44}
            tickFormatter={yFormat}
            tickLine={false}
            axisLine={false}
            stroke="var(--muted-foreground)"
            domain={yDomain ?? ["auto", "auto"]}
          />
          <ChartTooltip
            content={({ active, payload, label }) => (
              <ChartTooltipContent
                active={active}
                label={`${xLabel} ${xFormat(Number(label))}`}
                payload={payload?.map((p) => ({
                  name: config[String(p.dataKey)]?.label as string,
                  value: yFormat(Number(p.value)),
                  color: String(p.color),
                }))}
              />
            )}
          />
          {series.map((s) => (
            <Line
              key={s.key}
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ChartContainer>
      <div className="text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-[3px] w-3 rounded-full"
              style={{ background: s.color }}
            />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
