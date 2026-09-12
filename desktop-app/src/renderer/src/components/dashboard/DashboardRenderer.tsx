import { Component, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import type {
  AnalyzedDealership,
  DashboardSpec,
  DashboardWidget,
} from "@shared/types";
import {
  computeDashboardData,
  type DashboardData,
  type SeriesPoint,
} from "@shared/dashboard-aggregates";
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
import { CoverageCard } from "@renderer/components/dashboard/CoverageCard";
import { DealershipTable } from "@renderer/components/dashboard/DealershipTable";
import { InsightsPanel } from "@renderer/components/dashboard/InsightsPanel";
import { SeasonalProfile } from "@renderer/components/dashboard/SeasonalProfile";
import { eur, num } from "@renderer/lib/format";
import { cn } from "@renderer/lib/utils";

/** Categorical chart palette (independent of the traffic-light score scale). */
const PALETTE = [
  "#6366f1",
  "#0ea5e9",
  "#f97316",
  "#dc2626",
  "#16a34a",
  "#a855f7",
  "#eab308",
  "#64748b",
];

/** KPI source → rendered value (formatting matches SummaryCards). */
function kpiValue(source: string, kpi: DashboardData["kpi"]): string | null {
  switch (source) {
    case "kpi.count":
      return num(kpi.count);
    case "kpi.totalEal":
      return eur(kpi.totalEal);
    case "kpi.totalExposure":
      return eur(kpi.totalExposure);
    case "kpi.avgScore":
      return `${kpi.avgScore.toFixed(0)}/100`;
    case "kpi.totalVehicles":
      return num(kpi.totalVehicles);
    case "kpi.extremeCount":
      return num(kpi.extremeCount);
    default:
      return null;
  }
}

/** Series source → uniform {label,value} points (or null on no match). */
function seriesFor(source: string, data: DashboardData): SeriesPoint[] | null {
  switch (source) {
    case "riskDistribution":
      return data.riskDistribution;
    case "topEal":
      return data.topEal;
    case "topScore":
      return data.topScore;
    case "perilCoverage":
      return data.perilCoverage;
    case "seasonalProfile":
      return data.seasonalProfile.map((p) => ({
        label: p.month,
        value: p.total,
      }));
    default:
      return null;
  }
}

function KpiWidget({
  title,
  value,
}: Readonly<{ title: string; value: string }>): React.JSX.Element {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-muted-foreground text-xs">{title}</div>
        <div className="mt-2 text-xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

function ChartCard({
  title,
  children,
}: Readonly<{ title: string; children: ReactNode }>): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function BarWidget({
  title,
  series,
}: Readonly<{ title: string; series: SeriesPoint[] }>): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <ChartCard title={title}>
      <ChartContainer
        config={{ value: { label: t("ui.value"), color: PALETTE[0] } }}
        className="aspect-video max-h-72 w-full"
      >
        <BarChart
          data={series}
          layout="vertical"
          margin={{ left: 8, right: 16 }}
        >
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="label"
            width={120}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey="value" fill="var(--color-value)" radius={4} />
        </BarChart>
      </ChartContainer>
    </ChartCard>
  );
}

function LineWidget({
  title,
  series,
}: Readonly<{ title: string; series: SeriesPoint[] }>): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <ChartCard title={title}>
      <ChartContainer
        config={{ value: { label: t("ui.value"), color: PALETTE[0] } }}
        className="aspect-video max-h-72 w-full"
      >
        <LineChart data={series} margin={{ left: 8, right: 16, top: 8 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Line
            dataKey="value"
            stroke="var(--color-value)"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ChartContainer>
    </ChartCard>
  );
}

function PieWidget({
  title,
  series,
}: Readonly<{ title: string; series: SeriesPoint[] }>): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <ChartCard title={title}>
      <ChartContainer
        config={{ value: { label: t("ui.value") } }}
        className="aspect-square max-h-64"
      >
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent />} />
          <Pie
            data={series}
            dataKey="value"
            nameKey="label"
            innerRadius={55}
            outerRadius={90}
          >
            {series.map((e, i) => (
              <Cell key={e.label} fill={PALETTE[i % PALETTE.length]} />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
      <div className="mt-2 flex flex-wrap justify-center gap-3 text-xs">
        {series.map((e, i) => (
          <div key={e.label} className="flex items-center gap-1.5">
            <span
              className="size-2.5 rounded-full"
              style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
            />
            {e.label} ({e.value})
          </div>
        ))}
      </div>
    </ChartCard>
  );
}

/** Catches render errors of a single widget without killing the whole dashboard. */
class WidgetErrorBoundary extends Component<
  { children: ReactNode; errorLabel: string },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; errorLabel: string }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }
  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            {this.props.errorLabel}
          </CardContent>
        </Card>
      );
    }
    return this.props.children;
  }
}

interface Props {
  spec: DashboardSpec;
  dealerships: AnalyzedDealership[];
  onSelect: (d: AnalyzedDealership) => void;
}

/**
 * Renders a {@link DashboardSpec}: a dispatcher per widget based on `type`,
 * wrapped in an error boundary. All numbers come deterministically from
 * {@link computeDashboardData}; the LLM only supplies structure. Unknown
 * types/sources are silently skipped.
 */
export function DashboardRenderer({
  spec,
  dealerships,
  onSelect,
}: Readonly<Props>): React.JSX.Element {
  const { t } = useTranslation();
  const data = useMemo(() => computeDashboardData(dealerships), [dealerships]);

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
      {spec.widgets.map((w) => {
        const node = renderWidget(w, data, dealerships, onSelect);
        if (!node) return null;
        const isKpi = w.type === "kpi";
        return (
          <div
            key={w.id}
            className={cn(
              isKpi ? "col-span-1 lg:col-span-2" : "col-span-2 lg:col-span-6",
            )}
          >
            <WidgetErrorBoundary errorLabel={t("ui.widgetError")}>
              {node}
            </WidgetErrorBoundary>
          </div>
        );
      })}
    </div>
  );
}

/** Widget dispatcher. Returns `null` if the type/source is not renderable. */
function renderWidget(
  w: DashboardWidget,
  data: DashboardData,
  dealerships: AnalyzedDealership[],
  onSelect: (d: AnalyzedDealership) => void,
): ReactNode {
  switch (w.type) {
    case "kpi": {
      if (!w.source) return null;
      const value = kpiValue(w.source, data.kpi);
      return value == null ? null : <KpiWidget title={w.title} value={value} />;
    }
    case "barChart": {
      const series = w.source ? seriesFor(w.source, data) : null;
      if (!series) return null;
      return <BarWidget title={w.title} series={applyLimit(series, w.limit)} />;
    }
    case "lineChart": {
      const series = w.source ? seriesFor(w.source, data) : null;
      if (!series) return null;
      return (
        <LineWidget title={w.title} series={applyLimit(series, w.limit)} />
      );
    }
    case "pieChart": {
      const series = w.source ? seriesFor(w.source, data) : null;
      if (!series) return null;
      return <PieWidget title={w.title} series={applyLimit(series, w.limit)} />;
    }
    case "table":
      return <DealershipTable dealerships={dealerships} onSelect={onSelect} />;
    case "insights":
      return <InsightsPanel dealerships={dealerships} onSelect={onSelect} />;
    case "coverage":
      return <CoverageCard dealerships={dealerships} />;
    case "seasonal":
      return <SeasonalProfile dealerships={dealerships} />;
    case "text":
      return w.text ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{w.title}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {w.text}
          </CardContent>
        </Card>
      ) : null;
    default:
      return null;
  }
}

function applyLimit(series: SeriesPoint[], limit?: number): SeriesPoint[] {
  return limit && limit > 0 ? series.slice(0, limit) : series;
}
