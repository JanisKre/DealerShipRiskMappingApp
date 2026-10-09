import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AnalyzedDealership } from "@shared/types";
import { dealershipHailZone } from "@shared/risk-math";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@renderer/components/ui/card";
import { ChartContainer } from "@renderer/components/ui/chart";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@renderer/components/ui/toggle-group";
import { eur, num, pct } from "@renderer/lib/format";
import { hailZoneColor } from "@renderer/lib/riskColor";
import { TileInfo } from "./TileInfo";

type Metric = "count" | "exposure";

interface ZoneRow {
  zone: number;
  label: string;
  count: number;
  exposure: number;
  eal: number;
  estimated: number;
}

/**
 * How the portfolio spreads across hail zones 1–6, by number of locations or
 * by exposure. All six zones are always shown so portfolios stay comparable.
 */
export function HailZoneDistribution({
  dealerships,
}: Readonly<{ dealerships: AnalyzedDealership[] }>): React.JSX.Element {
  const { t } = useTranslation();
  const [metric, setMetric] = useState<Metric>("count");

  const { rows, totalExposure, unknown } = useMemo(() => {
    const rows: ZoneRow[] = [1, 2, 3, 4, 5, 6].map((zone) => ({
      zone,
      label: t("dashboard.zoneShort", { zone }),
      count: 0,
      exposure: 0,
      eal: 0,
      estimated: 0,
    }));
    let unknown = 0;
    for (const d of dealerships) {
      const hz = dealershipHailZone(d);
      if (!hz) {
        unknown += 1;
        continue;
      }
      const row = rows[hz.zone - 1];
      row.count += 1;
      row.exposure += d.risk?.exposureEur ?? 0;
      row.eal += d.risk?.eal ?? 0;
      if (hz.source === "estimated") row.estimated += 1;
    }
    const totalExposure = rows.reduce((a, r) => a + r.exposure, 0);
    return { rows, totalExposure, unknown };
  }, [dealerships, t]);

  const format = (value: number): string =>
    metric === "count" ? num(value) : eur(value);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-1.5 text-base">
            {t("dashboard.zones.title")}
            <TileInfo topic="zones" />
          </CardTitle>
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={metric}
            onValueChange={(value) => value && setMetric(value as Metric)}
          >
            <ToggleGroupItem value="count">
              {t("dashboard.locations")}
            </ToggleGroupItem>
            <ToggleGroupItem value="exposure">
              {t("dashboard.zones.byExposure")}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <CardDescription>{t("dashboard.zones.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={{ [metric]: { label: t("dashboard.locations") } }}
          className="aspect-auto h-56 w-full"
        >
          <BarChart data={rows} margin={{ top: 20, right: 8, left: 8 }}>
            <CartesianGrid vertical={false} strokeOpacity={0.15} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11 }}
            />
            <YAxis hide />
            <Tooltip
              cursor={{ fillOpacity: 0.08 }}
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as ZoneRow | undefined;
                if (!active || !row) return null;
                return (
                  <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
                    <div className="mb-1 font-medium">
                      {t("dashboard.hailZoneLabel", { zone: row.zone })}
                    </div>
                    <div>
                      {t("dashboard.zones.tooltipCount", { count: row.count })}
                    </div>
                    <div>
                      {t("dashboard.totalExposure")}: {eur(row.exposure)}
                      {totalExposure > 0 &&
                        ` (${pct(row.exposure / totalExposure)})`}
                    </div>
                    <div>
                      {t("dashboard.hailEal")}: {eur(row.eal)}
                    </div>
                    {row.estimated > 0 && (
                      <div className="text-muted-foreground">
                        {t("dashboard.zones.tooltipEstimated", {
                          count: row.estimated,
                        })}
                      </div>
                    )}
                  </div>
                );
              }}
            />
            <Bar dataKey={metric} radius={[4, 4, 0, 0]} maxBarSize={48}>
              {rows.map((row) => (
                <Cell key={row.zone} fill={hailZoneColor(row.zone)} />
              ))}
              <LabelList
                dataKey={metric}
                position="top"
                className="fill-foreground"
                fontSize={11}
                formatter={(value: number) => (value > 0 ? format(value) : "")}
              />
            </Bar>
          </BarChart>
        </ChartContainer>
        {unknown > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            {t("dashboard.zones.unknown", { count: unknown })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
