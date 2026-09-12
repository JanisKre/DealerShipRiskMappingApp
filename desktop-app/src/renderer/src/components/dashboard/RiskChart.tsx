import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Bar, BarChart, Cell, Pie, PieChart, XAxis, YAxis } from "recharts";
import type { AnalyzedDealership } from "@shared/types";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@renderer/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@renderer/components/ui/chart";
import {
  riskColor,
  riskLevel,
  riskLevelColor,
  type RiskLevel,
} from "@renderer/lib/riskColor";

/**
 * Zwei Charts: links Donut der Risikoverteilung (LOW/MEDIUM/HIGH/EXTREME),
 * rechts Top-10-Standorte nach Score als horizontale Bars.
 */
export function RiskChart({
  dealerships,
}: {
  dealerships: AnalyzedDealership[];
}): React.JSX.Element {
  const { t } = useTranslation();
  const distribution = useMemo(() => {
    const buckets: Record<RiskLevel, number> = {
      LOW: 0,
      MEDIUM: 0,
      HIGH: 0,
      EXTREME: 0,
    };
    for (const d of dealerships)
      buckets[riskLevel(d.risk?.overallScore ?? 0)] += 1;
    return (Object.keys(buckets) as RiskLevel[])
      .map((level) => ({
        level,
        label: t(`risk.${level}`),
        value: buckets[level],
      }))
      .filter((e) => e.value > 0);
  }, [dealerships, t]);

  const top10 = useMemo(
    () =>
      [...dealerships]
        .sort(
          (a, b) => (b.risk?.overallScore ?? 0) - (a.risk?.overallScore ?? 0),
        )
        .slice(0, 10)
        .map((d) => ({
          name: d.name,
          score: Math.round(d.risk?.overallScore ?? 0),
        })),
    [dealerships],
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("dashboard.riskDistribution")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer
            config={{ value: { label: t("dashboard.locations") } }}
            className="aspect-square max-h-64"
          >
            <PieChart>
              <ChartTooltip content={<ChartTooltipContent />} />
              <Pie
                data={distribution}
                dataKey="value"
                nameKey="label"
                innerRadius={55}
                outerRadius={90}
              >
                {distribution.map((e) => (
                  <Cell key={e.level} fill={riskLevelColor(e.level)} />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>
          <div className="mt-2 flex flex-wrap justify-center gap-3 text-xs">
            {distribution.map((e) => (
              <div key={e.level} className="flex items-center gap-1.5">
                <span
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: riskLevelColor(e.level) }}
                />
                {e.label} ({e.value})
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("dashboard.topRisks")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer
            config={{ score: { label: t("common.score") } }}
            className="aspect-square max-h-64"
          >
            <BarChart
              data={top10}
              layout="vertical"
              margin={{ left: 8, right: 16 }}
            >
              <XAxis type="number" domain={[0, 100]} hide />
              <YAxis
                type="category"
                dataKey="name"
                width={120}
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="score" radius={4}>
                {top10.map((e) => (
                  <Cell key={e.name} fill={riskColor(e.score)} />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  );
}
