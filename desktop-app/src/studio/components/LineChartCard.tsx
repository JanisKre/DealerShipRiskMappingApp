import { useTranslation } from "react-i18next";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@renderer/components/ui/chart";
import { fmt, niceTicks } from "@studio/numbers";

export interface Series {
  key: string;
  label: string;
  color: string;
  points: [number, number][];
}

/**
 * One measure over one x-axis, a line per run. Colour follows the run (fixed
 * by name), a legend is always shown, the tooltip lists every run at the
 * hovered x with `valueFormat` (more digits than the axis). The y-axis gets
 * even 1-2-5 ticks with as many decimals as they need; runs with one or two
 * points are drawn as dots, so they never vanish.
 */
export function RunLines({
  series,
  xLabel,
  xFormat = (x) => fmt(x),
  valueFormat,
  className,
}: {
  series: Series[];
  xLabel: string;
  xFormat?: (x: number) => string;
  valueFormat: (y: number) => string;
  className?: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  if (!series.some((s) => s.points.length)) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        {t("chart.empty")}
      </p>
    );
  }
  const ys = series.flatMap((s) => s.points.map((p) => p[1]));
  const y = niceTicks(Math.min(...ys), Math.max(...ys));
  const xs = [
    ...new Set(series.flatMap((s) => s.points.map((p) => p[0]))),
  ].sort((a, b) => a - b);
  // Many x values (epochs): even ticks from the first value on, not every value.
  const xTicks =
    xs.length > 12
      ? [
          xs[0],
          ...niceTicks(xs[0], xs[xs.length - 1], 6).ticks.filter(
            (x) => x > xs[0] && x <= xs[xs.length - 1],
          ),
        ]
      : xs;
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
            ticks={xTicks}
            tickFormatter={xFormat}
            padding={{ left: 14, right: 8 }}
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
            width={48}
            ticks={y.ticks}
            domain={[y.ticks[0], y.ticks[y.ticks.length - 1]]}
            tickFormatter={(v: number) => fmt(v, y.digits)}
            tickLine={false}
            axisLine={false}
            stroke="var(--muted-foreground)"
            allowDataOverflow
          />
          <ChartTooltip
            content={({ active, payload, label }) => (
              <ChartTooltipContent
                active={active}
                label={`${xLabel} ${xFormat(Number(label))}`}
                payload={payload?.map((p) => ({
                  name: config[String(p.dataKey)]?.label as string,
                  value: valueFormat(Number(p.value)),
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
              dot={
                s.points.length <= 2
                  ? { r: 3.5, strokeWidth: 0, fill: s.color }
                  : false
              }
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
