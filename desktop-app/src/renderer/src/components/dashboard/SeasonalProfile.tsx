import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { AnalyzedDealership, Peril } from "@shared/types";
import { PERILS } from "@shared/types";
import { computeSeasonalProfile } from "@shared/analytics";
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
import { perilColor } from "@renderer/lib/perilLabel";

/**
 * Seasonal risk profile: stacked areas per peril across 12 months. Based on
 * the portfolio's average score per peril, modulated with the known
 * Central European seasonality (see `computeSeasonalProfile`). Shows when
 * during the year portfolio risk accumulates (thunderstorm/hail/heat in
 * summer, storm/snow in the winter half-year).
 */
export function SeasonalProfile({
  dealerships,
}: Readonly<{ dealerships: AnalyzedDealership[] }>): React.JSX.Element {
  const { t } = useTranslation();
  const data = useMemo(
    () => computeSeasonalProfile(dealerships),
    [dealerships],
  );

  const config = useMemo(
    () =>
      Object.fromEntries(
        PERILS.map((p) => [
          p,
          {
            label: t(`dashboard.detailDialog.ealPeril.${p}`),
            color: perilColor(p),
          },
        ]),
      ),
    [t],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {t("dashboard.seasonalTitle")}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t("dashboard.seasonalDescription")}
        </p>
      </CardHeader>
      <CardContent>
        <ChartContainer config={config} className="aspect-[2/1] w-full">
          <AreaChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="month"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11 }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11 }}
              width={28}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            {PERILS.map((p: Peril) => (
              <Area
                key={p}
                type="monotone"
                dataKey={p}
                stackId="risk"
                stroke={perilColor(p)}
                fill={perilColor(p)}
                fillOpacity={0.35}
              />
            ))}
          </AreaChart>
        </ChartContainer>
        <div className="mt-2 flex flex-wrap justify-center gap-3 text-xs">
          {PERILS.map((p) => (
            <div key={p} className="flex items-center gap-1.5">
              <span
                className="size-2.5 rounded-full"
                style={{ backgroundColor: perilColor(p) }}
              />
              {t(`dashboard.detailDialog.ealPeril.${p}`)}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
