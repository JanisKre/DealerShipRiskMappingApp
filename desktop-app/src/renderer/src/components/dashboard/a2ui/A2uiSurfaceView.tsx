import { createContext, useContext, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  A2uiComponent,
  A2uiDimension,
  A2uiFilter,
  A2uiMeasure,
  A2uiSurface,
  A2uiTableColumn,
} from "@shared/a2ui";
import {
  applyFilter,
  evaluateCall,
  niceTicks,
  NONE_KEY,
  OTHER_KEY,
  type CallResult,
  type LocationRow,
  sharedFilter,
  type SeriesPoint,
} from "@shared/a2ui-data";
import type { AnalyzedDealership } from "@shared/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@renderer/components/ui/card";
import { ChartContainer } from "@renderer/components/ui/chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@renderer/components/ui/table";
import { eur, num, pct } from "@renderer/lib/format";
import { hailZoneColor } from "@renderer/lib/riskColor";
import { HailZoneBadge } from "../HailZoneBadge";

/**
 * Renders an A2UI surface of the dashboard catalog with the app's own
 * components. Every value is computed here from the portfolio by the
 * catalog functions; each card names the selection it shows, so a figure is
 * never detached from what it covers.
 */
/**
 * How cards present themselves on this surface: when every data component
 * uses the same selection, the selection is stated once above the cards
 * instead of under each of them.
 */
const ViewContext = createContext<{ sharedSelection: boolean }>({
  sharedSelection: false,
});

function normalizeTitle(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export function A2uiSurfaceView({
  surface,
  dealerships,
  onOpenLocation,
}: Readonly<{
  surface: A2uiSurface;
  dealerships: AnalyzedDealership[];
  onOpenLocation: (id: string) => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const byId = useMemo(() => {
    const map = new Map(surface.components.map((c) => [c.id, c]));
    // The tab already carries the title; a leading heading that repeats it
    // is dropped (models like to add one).
    const root = map.get("root");
    if (root && (root.component === "Column" || root.component === "Row")) {
      const first = map.get(root.children[0]);
      if (
        root.children.length > 1 &&
        first?.component === "Heading" &&
        normalizeTitle(first.text) === normalizeTitle(surface.title)
      )
        map.set("root", { ...root, children: root.children.slice(1) });
    }
    return map;
  }, [surface]);
  const shared = useMemo(
    () =>
      sharedFilter(
        surface.components.flatMap(
          (c): Array<{ args: { filter?: A2uiFilter } }> =>
            c.component === "KpiCard"
              ? [c.value]
              : c.component === "BarChart" || c.component === "PieChart"
                ? [c.data]
                : c.component === "Table"
                  ? [c.rows]
                  : [],
        ),
      ),
    [surface],
  );
  const located = dealerships.filter((d) => d.lat != null && d.lon != null);
  const selected = shared ? applyFilter(located, shared.filter).length : 0;
  return (
    <ViewContext.Provider value={{ sharedSelection: shared != null }}>
      <div className="@container space-y-4">
        {shared && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="rounded-md border bg-muted/40 px-2 py-0.5 font-medium">
              {describeFilter(t, shared.filter)}
            </span>
            <span className="text-muted-foreground">
              {t("a2ui.selectionCount", {
                count: selected,
                total: located.length,
              })}
            </span>
          </p>
        )}
        <Node
          id="root"
          byId={byId}
          dealerships={dealerships}
          onOpenLocation={onOpenLocation}
        />
      </div>
    </ViewContext.Provider>
  );
}

/** Rows of charts or tables: side by side only where they keep room. */
const ROW_COLUMNS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 @3xl:grid-cols-2",
  3: "grid-cols-1 @3xl:grid-cols-2 @6xl:grid-cols-3",
  4: "grid-cols-1 @3xl:grid-cols-2 @7xl:grid-cols-4",
};
/** Rows of key figures: compact, two abreast even on narrow screens. */
const KPI_ROW_COLUMNS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-2 @xl:grid-cols-3",
  4: "grid-cols-2 @3xl:grid-cols-4",
};

function Node({
  id,
  byId,
  dealerships,
  onOpenLocation,
}: Readonly<{
  id: string;
  byId: Map<string, A2uiComponent>;
  dealerships: AnalyzedDealership[];
  onOpenLocation: (id: string) => void;
}>): React.JSX.Element | null {
  const c = byId.get(id);
  if (!c) return null;
  const child = (childId: string): React.JSX.Element => (
    <Node
      key={childId}
      id={childId}
      byId={byId}
      dealerships={dealerships}
      onOpenLocation={onOpenLocation}
    />
  );
  switch (c.component) {
    case "Column":
      return <div className="space-y-4">{c.children.map(child)}</div>;
    case "Row": {
      const figures = c.children.every(
        (childId) => byId.get(childId)?.component === "KpiCard",
      );
      const columns = figures ? KPI_ROW_COLUMNS : ROW_COLUMNS;
      return (
        <div
          className={`grid items-stretch gap-4 ${columns[c.children.length] ?? columns[4]}`}
        >
          {c.children.map(child)}
        </div>
      );
    }
    case "Heading":
      return <h3 className="pt-2 text-lg font-semibold">{c.text}</h3>;
    case "Text":
      return <p className="text-sm text-muted-foreground">{c.text}</p>;
    case "KpiCard":
      return (
        <KpiCard
          title={c.title}
          result={evaluateCall(c.value, dealerships)}
          filter={c.value.args.filter}
        />
      );
    case "BarChart":
      return (
        <ChartCard title={c.title} filter={c.data.args.filter}>
          <SeriesBars
            result={evaluateCall(c.data, dealerships)}
            onOpenLocation={onOpenLocation}
          />
        </ChartCard>
      );
    case "PieChart":
      return (
        <ChartCard title={c.title} filter={c.data.args.filter}>
          <SeriesPie result={evaluateCall(c.data, dealerships)} />
        </ChartCard>
      );
    case "Table":
      return (
        <ChartCard title={c.title} filter={c.rows.args.filter}>
          <LocationTable
            result={evaluateCall(c.rows, dealerships)}
            columns={c.columns}
            onOpenLocation={onOpenLocation}
          />
        </ChartCard>
      );
  }
}

// --- Labels -------------------------------------------------------------

function formatMeasure(measure: A2uiMeasure, value: number): string {
  return measure === "eal" || measure === "exposure" ? eur(value) : num(value);
}

/** Short axis labels: "250.000 €" stays, "22.150.000 €" becomes "22 Mio. €". */
function formatAxis(
  measure: A2uiMeasure,
  value: number,
  locale: string,
): string {
  if (Math.abs(value) < 1_000_000) return formatMeasure(measure, value);
  return new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
    ...(measure === "eal" || measure === "exposure"
      ? { style: "currency", currency: "EUR" }
      : {}),
  }).format(value);
}

/** "Zone ≥ 4 · Bestand · Vertriebspartner Nord" — or "Gesamtes Portfolio". */
export function describeFilter(
  t: TFunction,
  filter: A2uiFilter | undefined,
): string {
  if (!filter) return t("a2ui.filter.all");
  const parts: string[] = [];
  const { minHailZone: min, maxHailZone: max } = filter;
  if (min != null && max != null)
    parts.push(
      min === max
        ? t("dashboard.zoneShort", { zone: min })
        : t("a2ui.filter.zoneRange", { min, max }),
    );
  else if (min != null) parts.push(t("a2ui.filter.zoneMin", { zone: min }));
  else if (max != null) parts.push(t("a2ui.filter.zoneMax", { zone: max }));
  if (filter.business)
    parts.push(
      filter.business === "existing"
        ? t("dashboard.detailDialog.businessExisting")
        : t("dashboard.detailDialog.businessNew"),
    );
  if (filter.salesPartner)
    parts.push(t("a2ui.filter.salesPartner", { value: filter.salesPartner }));
  if (filter.subPortfolio)
    parts.push(t("a2ui.filter.subPortfolio", { value: filter.subPortfolio }));
  if (filter.group) parts.push(t("a2ui.filter.group", { value: filter.group }));
  if (filter.boundaryReview) parts.push(t("a2ui.filter.boundaryReview"));
  return parts.length > 0 ? parts.join(" · ") : t("a2ui.filter.all");
}

function groupLabel(
  t: TFunction,
  by: A2uiDimension | "location",
  key: string,
): string {
  if (key === OTHER_KEY) return t("a2ui.other");
  if (key === NONE_KEY)
    return by === "hailZone" ? t("a2ui.noZone") : t("a2ui.none");
  if (by === "hailZone") return t("dashboard.zoneShort", { zone: key });
  if (by === "business")
    return key === "existing"
      ? t("dashboard.detailDialog.businessExisting")
      : t("dashboard.detailDialog.businessNew");
  return key;
}

function measureLabel(t: TFunction, measure: A2uiMeasure): string {
  return t(`a2ui.measure.${measure}`);
}

// --- Cards --------------------------------------------------------------

function KpiCard({
  title,
  result,
  filter,
}: Readonly<{
  title: string;
  result: CallResult;
  filter: A2uiFilter | undefined;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const { sharedSelection } = useContext(ViewContext);
  if (result.kind !== "value") return <></>;
  const value = formatMeasure(result.measure, result.value);
  const caption =
    result.count === 0
      ? t("a2ui.emptyShort")
      : sharedSelection
        ? null
        : `${describeFilter(t, filter)} · ${t("a2ui.locations", { count: result.count })}`;
  return (
    <Card className="hover:shadow-md">
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{title}</div>
        <div className="mt-2 truncate text-xl font-semibold tabular-nums">
          {value}
        </div>
        {caption && (
          <div className="mt-0.5 text-xs text-muted-foreground">{caption}</div>
        )}
      </CardContent>
    </Card>
  );
}

function ChartCard({
  title,
  filter,
  children,
}: Readonly<{
  title: string;
  filter: A2uiFilter | undefined;
  children: React.ReactNode;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const { sharedSelection } = useContext(ViewContext);
  return (
    <Card className="min-w-0">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {!sharedSelection && (
          <CardDescription className="text-xs">
            {describeFilter(t, filter)}
          </CardDescription>
        )}
      </CardHeader>
      {/* Charts sit in the middle when a neighbour in the row is taller. */}
      <CardContent className="flex min-w-0 flex-1 flex-col justify-center p-4 pt-0">
        {children}
      </CardContent>
    </Card>
  );
}

function Empty(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <p className="py-6 text-center text-sm text-muted-foreground">
      {t("a2ui.empty")}
    </p>
  );
}

function TooltipBox({
  title,
  lines,
}: Readonly<{ title: string; lines: string[] }>): React.JSX.Element {
  return (
    <div className="max-w-64 rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
      <div className="mb-0.5 font-medium">{title}</div>
      {lines.map((line) => (
        <div key={line} className="text-muted-foreground">
          {line}
        </div>
      ))}
    </div>
  );
}

const truncate = (text: string, max = 24): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

function SeriesBars({
  result,
  onOpenLocation,
}: Readonly<{
  result: CallResult;
  onOpenLocation: (id: string) => void;
}>): React.JSX.Element {
  const { t, i18n } = useTranslation();
  if (result.kind !== "series") return <></>;
  if (result.points.length === 0) return <Empty />;
  const total = result.points.reduce((sum, p) => sum + p.value, 0);
  const ticks = niceTicks(Math.max(...result.points.map((p) => p.value)));
  const data = result.points.map((p) => ({
    ...p,
    label: groupLabel(t, result.by, p.key),
  }));
  const color = (p: SeriesPoint): string =>
    result.by === "hailZone" && p.key !== NONE_KEY
      ? hailZoneColor(Number(p.key))
      : "var(--chart-1)";
  const tooltip = (
    <Tooltip
      cursor={{ fillOpacity: 0.08 }}
      content={({ active, payload }) => {
        const p = payload?.[0]?.payload as
          | (SeriesPoint & { label: string })
          | undefined;
        if (!active || !p) return null;
        return (
          <TooltipBox
            title={p.label}
            lines={[
              `${measureLabel(t, result.measure)}: ${formatMeasure(result.measure, p.value)}`,
              ...(result.by !== "location" && total > 0
                ? [t("a2ui.share", { share: pct(p.value / total) })]
                : []),
              ...(p.id ? [t("a2ui.clickToOpen")] : []),
            ]}
          />
        );
      }}
    />
  );

  // Rankings read best as horizontal bars with the names on the left.
  if (result.by === "location") {
    return (
      <ChartContainer
        config={{ value: { label: measureLabel(t, result.measure) } }}
        className="aspect-auto w-full"
        style={{ height: Math.max(120, data.length * 28 + 24) }}
      >
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 0, right: 12, left: 0, bottom: 0 }}
          onClick={(state) => {
            const id = (state?.activePayload?.[0]?.payload as SeriesPoint)?.id;
            if (id) onOpenLocation(id);
          }}
          className="cursor-pointer"
        >
          <CartesianGrid horizontal={false} strokeOpacity={0.15} />
          <XAxis
            type="number"
            domain={[0, ticks[ticks.length - 1]]}
            ticks={ticks}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10 }}
            tickFormatter={(v: number) =>
              formatAxis(result.measure, v, i18n.language)
            }
          />
          <YAxis
            type="category"
            dataKey="label"
            width={150}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11 }}
            tickFormatter={(v: string) => truncate(v)}
          />
          {tooltip}
          <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive={false}>
            {data.map((p) => (
              <Cell key={p.key + (p.id ?? "")} fill={color(p)} />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    );
  }
  return (
    <ChartContainer
      config={{ value: { label: measureLabel(t, result.measure) } }}
      className="aspect-auto h-56 w-full"
    >
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeOpacity={0.15} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 10 }}
          interval={0}
          tickFormatter={(v: string) => truncate(v, 14)}
        />
        <YAxis
          domain={[0, ticks[ticks.length - 1]]}
          ticks={ticks}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 10 }}
          width={72}
          tickFormatter={(v: number) =>
            formatAxis(result.measure, v, i18n.language)
          }
        />
        {tooltip}
        <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false}>
          {data.map((p) => (
            <Cell key={p.key} fill={color(p)} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

const PIE_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function SeriesPie({
  result,
}: Readonly<{ result: CallResult }>): React.JSX.Element {
  const { t } = useTranslation();
  if (result.kind !== "series") return <></>;
  const points = result.points.filter((p) => p.value > 0);
  if (points.length === 0) return <Empty />;
  const total = points.reduce((sum, p) => sum + p.value, 0);
  const data = points.map((p, i) => ({
    ...p,
    label: groupLabel(t, result.by, p.key),
    fill:
      result.by === "hailZone" && p.key !== NONE_KEY
        ? hailZoneColor(Number(p.key))
        : p.key === OTHER_KEY || p.key === NONE_KEY
          ? "var(--muted-foreground)"
          : PIE_COLORS[i % PIE_COLORS.length],
  }));
  return (
    <div className="flex flex-col items-center gap-3 @md:flex-row">
      <ChartContainer config={{}} className="aspect-square h-44 shrink-0">
        <PieChart>
          <Tooltip
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as
                | (typeof data)[number]
                | undefined;
              if (!active || !p) return null;
              return (
                <TooltipBox
                  title={p.label}
                  lines={[
                    `${measureLabel(t, result.measure)}: ${formatMeasure(result.measure, p.value)}`,
                    t("a2ui.share", { share: pct(p.value / total) }),
                  ]}
                />
              );
            }}
          />
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            innerRadius="55%"
            outerRadius="95%"
            stroke="var(--card)"
            strokeWidth={data.length > 1 ? 2 : 0}
            isAnimationActive={false}
          >
            {data.map((p) => (
              <Cell key={p.key} fill={p.fill} />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
      <ul className="w-full min-w-0 space-y-1 text-xs">
        {data.map((p) => (
          <li key={p.key} className="flex items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: p.fill }}
            />
            <span className="min-w-0 flex-1 break-words">{p.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {formatMeasure(result.measure, p.value)} · {pct(p.value / total)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const DEFAULT_COLUMNS: A2uiTableColumn[] = [
  "name",
  "hailZone",
  "eal",
  "exposure",
  "vehicles",
];

function cell(
  t: TFunction,
  column: A2uiTableColumn,
  row: LocationRow,
): React.ReactNode {
  switch (column) {
    case "name":
      return <span className="font-medium">{row.name}</span>;
    case "hailZone":
      return row.hailZone != null ? <HailZoneBadge zone={row.hailZone} /> : "—";
    case "eal":
      return eur(row.eal);
    case "exposure":
      return eur(row.exposure);
    case "vehicles":
      return num(row.vehicles);
    case "business":
      return row.business === "existing"
        ? t("dashboard.detailDialog.businessExisting")
        : t("dashboard.detailDialog.businessNew");
    case "salesPartner":
      return row.salesPartner ?? "—";
    case "subPortfolio":
      return row.subPortfolio ?? "—";
    case "group":
      return row.group ?? "—";
  }
}

const NUMERIC: ReadonlySet<A2uiTableColumn> = new Set([
  "eal",
  "exposure",
  "vehicles",
]);

function LocationTable({
  result,
  columns = DEFAULT_COLUMNS,
  onOpenLocation,
}: Readonly<{
  result: CallResult;
  columns?: A2uiTableColumn[];
  onOpenLocation: (id: string) => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  if (result.kind !== "rows") return <></>;
  if (result.rows.length === 0) return <Empty />;
  // The name is how a row is recognised and opened; keep it first.
  const shown: A2uiTableColumn[] = [
    "name",
    ...columns.filter((c) => c !== "name"),
  ];
  return (
    <div className="space-y-2">
      <div className="max-h-[28rem] overflow-auto rounded-md border">
        <Table>
          <TableHeader className="sticky top-0 bg-background">
            <TableRow>
              {shown.map((column) => (
                <TableHead
                  key={column}
                  className={
                    NUMERIC.has(column)
                      ? "whitespace-nowrap text-right"
                      : "whitespace-nowrap"
                  }
                >
                  {t(`a2ui.column.${column}`)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.rows.map((row) => (
              <TableRow
                key={row.id}
                className="cursor-pointer"
                tabIndex={0}
                onClick={() => onOpenLocation(row.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onOpenLocation(row.id);
                }}
              >
                {shown.map((column) => (
                  <TableCell
                    key={column}
                    className={
                      NUMERIC.has(column)
                        ? "text-right tabular-nums"
                        : "whitespace-normal"
                    }
                  >
                    {cell(t, column, row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {result.count > result.rows.length && (
        <p className="text-xs text-muted-foreground">
          {t("a2ui.tableMore", {
            shown: result.rows.length,
            count: result.count,
            measure: measureLabel(t, result.measure),
          })}
        </p>
      )}
    </div>
  );
}
