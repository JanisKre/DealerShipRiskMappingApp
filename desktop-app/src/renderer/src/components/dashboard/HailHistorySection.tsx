import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceArea,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CalendarDays,
  CloudHail,
  Info,
  Loader2,
  MapPin,
  RefreshCw,
  TriangleAlert,
  X,
} from "lucide-react";
import type {
  AnalyzedDealership,
  HailHistory,
  HailHistoryStation,
} from "@shared/types";
import { Button } from "@renderer/components/ui/button";
import { ChartContainer } from "@renderer/components/ui/chart";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@renderer/components/ui/popover";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@renderer/components/ui/toggle-group";
import { num, pct } from "@renderer/lib/format";
import { cn } from "@renderer/lib/utils";
import {
  countTicks,
  hailFigures,
  hailNotes,
  monthBars,
  newerStation,
  RECENT_YEARS,
  yearBars,
  type HailNote,
  type MonthBar,
  type YearBar,
  type YearRange,
} from "./hailHistoryView";

/** Per-session memo so stepping through locations does not refetch. */
const memo = new Map<string, Promise<HailHistory>>();

function key(lat: number, lon: number): string {
  return `${lat.toFixed(3)},${lon.toFixed(3)}`;
}

/** Hail history of a location (main process caches it for days as well). */
export function loadHailHistory(
  lat: number,
  lon: number,
): Promise<HailHistory> {
  const k = key(lat, lon);
  let pending = memo.get(k);
  if (!pending) {
    pending = window.api.hailHistory(lat, lon);
    // A failed lookup must not stick for the rest of the session.
    pending.catch(() => memo.delete(k));
    memo.set(k, pending);
  }
  return pending;
}

export function useHailHistory(
  lat: number,
  lon: number,
): {
  history: HailHistory | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
} {
  const [state, setState] = useState<{
    history: HailHistory | null;
    loading: boolean;
    error: string | null;
  }>({ history: null, loading: true, error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ history: null, loading: true, error: null });
    loadHailHistory(lat, lon)
      .then((history) => {
        if (!cancelled) setState({ history, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setState({
            history: null,
            loading: false,
            error: err instanceof Error ? err.message : String(err),
          });
      });
    return () => {
      cancelled = true;
    };
  }, [lat, lon, attempt]);

  return { ...state, retry: () => setAttempt((n) => n + 1) };
}

type View = "years" | "months";
type Selection =
  { kind: "year"; year: number } | { kind: "month"; month: number };

/** Hail bars, the highlighted one, and years without observations. */
const BAR_COLOR = "var(--chart-1)";
const BAR_SELECTED = "var(--primary)";
const GAP_COLOR = "var(--muted-foreground)";

/**
 * Observed hail days near a location, explorable: a station switch, four key
 * figures, a chart by year (with gaps marked where the station did not
 * observe) or by month, a tooltip per bar, and a click on a bar lists its
 * hail days. Notes below say what limits the figures for this station; the
 * ⓘ explains the data source. Context only — never part of the EAL.
 */
export function HailHistorySection({
  d,
}: Readonly<{ d: AnalyzedDealership }>): React.JSX.Element {
  const { t } = useTranslation();
  const { history, loading, error, retry } = useHailHistory(d.lat, d.lon);
  const [stationId, setStationId] = useState<string | null>(null);
  const stations = history?.stations ?? [];
  const station =
    stations.find((s) => s.stationId === stationId) ?? stations[0] ?? null;

  // A new location starts on its nearest station.
  useEffect(() => setStationId(null), [d.id]);

  return (
    <section className="space-y-3 text-sm" aria-labelledby="hail-history-title">
      <div className="flex items-center gap-1.5">
        <CloudHail className="size-4 text-muted-foreground" />
        <h4 id="hail-history-title" className="font-semibold">
          {t("hailHistory.title")}
        </h4>
        <SourcePopover radius={history?.searchRadiusKm ?? 30} />
      </div>

      {loading ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          {t("hailHistory.loading")}
        </p>
      ) : error ? (
        <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1">{t("hailHistory.failed")}</span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 gap-1 px-2 text-xs"
            onClick={retry}
          >
            <RefreshCw className="size-3" />
            {t("hailHistory.retry")}
          </Button>
        </div>
      ) : !station ? (
        <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          {t("hailHistory.none", { radius: history?.searchRadiusKm ?? 30 })}
        </p>
      ) : (
        <>
          <StationList
            stations={stations}
            selectedId={station.stationId}
            onSelect={setStationId}
          />
          <StationHistory
            key={station.stationId}
            station={station}
            newer={newerStation(stations, station)}
            onSwitch={setStationId}
          />
        </>
      )}
    </section>
  );
}

/**
 * The nearest stations as rows, one per line so long names never clip: name,
 * distance, observed period and mean hail days, which also lets the
 * underwriter compare them at a glance. One station is shown the same way,
 * without the choice.
 */
function StationList({
  stations,
  selectedId,
  onSelect,
}: Readonly<{
  stations: HailHistoryStation[];
  selectedId: string;
  onSelect: (id: string) => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const row = (s: HailHistoryStation, selected: boolean): React.JSX.Element => (
    <>
      <MapPin
        className={cn(
          "size-3.5 shrink-0",
          selected ? "text-primary" : "text-muted-foreground",
        )}
      />
      <span className="min-w-0 flex-1 break-words text-left font-medium">
        {s.name}
      </span>
      <span className="shrink-0 text-right text-xs font-normal text-muted-foreground tabular-nums">
        {t("hailHistory.stationMeta", {
          distance: num(s.distanceKm, 1),
          from: s.firstYear,
          to: s.lastYear,
          days: num(s.hailDaysPerYear, 1),
        })}
      </span>
    </>
  );
  if (stations.length === 1) {
    return (
      <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
        {row(stations[0], true)}
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">
        {t("hailHistory.stationPickerHint", { count: stations.length })}
      </p>
      <ToggleGroup
        type="single"
        value={selectedId}
        onValueChange={(value) => value && onSelect(value)}
        orientation="vertical"
        className="w-full flex-col items-stretch gap-1"
        aria-label={t("hailHistory.stationPicker")}
      >
        {stations.map((s) => (
          <ToggleGroupItem
            key={s.stationId}
            value={s.stationId}
            className="h-auto w-full flex-none justify-start gap-2 whitespace-normal rounded-md border border-transparent px-3 py-2 text-sm first:rounded-md last:rounded-md hover:text-foreground data-[state=on]:border-primary/50 data-[state=on]:bg-primary/5 data-[state=on]:text-foreground"
          >
            {row(s, s.stationId === selectedId)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

function SourcePopover({
  radius,
}: Readonly<{ radius: number }>): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={t("hailHistory.aboutLabel")}
        >
          <Info className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={8}
        className="w-80 space-y-2 p-3 text-xs leading-relaxed"
      >
        <p className="font-medium">{t("hailHistory.about.title")}</p>
        <p>{t("hailHistory.about.what", { radius })}</p>
        <p>{t("hailHistory.about.hailDay")}</p>
        <p className="text-muted-foreground">{t("hailHistory.about.limits")}</p>
        <p className="text-muted-foreground">{t("hailHistory.about.eal")}</p>
        <p className="text-muted-foreground">{t("hailHistory.about.source")}</p>
      </PopoverContent>
    </Popover>
  );
}

function StationHistory({
  station,
  newer,
  onSwitch,
}: Readonly<{
  station: HailHistoryStation;
  /** A nearby station with a later record, offered as a switch. */
  newer: HailHistoryStation | null;
  onSwitch: (stationId: string) => void;
}>): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const [view, setView] = useState<View>("years");
  const [range, setRange] = useState<YearRange>("all");
  const [selection, setSelection] = useState<Selection | null>(null);
  const figures = useMemo(() => hailFigures(station), [station]);
  const notes = useMemo(
    () => hailNotes(station, new Date().getFullYear()),
    [station],
  );
  const span = station.lastYear - station.firstYear + 1;
  const months = useMemo(
    () =>
      Array.from({ length: 12 }, (_, m) =>
        new Date(Date.UTC(2020, m, 1)).toLocaleDateString(i18n.language, {
          month: "short",
          timeZone: "UTC",
        }),
      ),
    [i18n.language],
  );
  const monthNames = useMemo(
    () =>
      Array.from({ length: 12 }, (_, m) =>
        new Date(Date.UTC(2020, m, 1)).toLocaleDateString(i18n.language, {
          month: "long",
          timeZone: "UTC",
        }),
      ),
    [i18n.language],
  );

  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Figure
          label={t("hailHistory.figure.perYear")}
          value={num(figures.perYear, 1)}
          hint={t("hailHistory.figure.perYearHint", {
            from: station.firstYear,
            to: station.lastYear,
          })}
        />
        <Figure
          label={t("hailHistory.figure.yearsWithHail")}
          value={pct(
            figures.yearsObserved > 0
              ? figures.yearsWithHail / figures.yearsObserved
              : 0,
          )}
          hint={t("hailHistory.figure.yearsWithHailHint", {
            count: figures.yearsWithHail,
            total: figures.yearsObserved,
          })}
        />
        <Figure
          label={t("hailHistory.figure.peak")}
          value={
            figures.peak
              ? t("hailHistory.days", { count: figures.peak.days })
              : "—"
          }
          hint={
            figures.peak
              ? t("hailHistory.figure.peakHint", { year: figures.peak.year })
              : undefined
          }
          onClick={
            figures.peak
              ? () => {
                  setView("years");
                  setRange("all");
                  setSelection({ kind: "year", year: figures.peak!.year });
                }
              : undefined
          }
        />
        <Figure
          label={t("hailHistory.figure.last")}
          value={
            figures.lastHail ? formatDay(figures.lastHail, i18n.language) : "—"
          }
          hint={
            figures.mainMonths.length === 0
              ? undefined
              : figures.mainMonths.length <= 3
                ? t("hailHistory.figure.season", {
                    months: figures.mainMonths.map((m) => months[m]).join(", "),
                  })
                : t("hailHistory.figure.seasonSpread")
          }
        />
      </dl>

      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={view}
          onValueChange={(value) => {
            if (!value) return;
            setView(value as View);
            setSelection(null);
          }}
          aria-label={t("hailHistory.viewLabel")}
        >
          <ToggleGroupItem value="years" className="flex-none px-2.5 text-xs">
            {t("hailHistory.view.years")}
          </ToggleGroupItem>
          <ToggleGroupItem value="months" className="flex-none px-2.5 text-xs">
            {t("hailHistory.view.months")}
          </ToggleGroupItem>
        </ToggleGroup>
        {view === "years" && span > RECENT_YEARS && (
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={range}
            onValueChange={(value) => {
              if (!value) return;
              setRange(value as YearRange);
              setSelection(null);
            }}
            aria-label={t("hailHistory.rangeLabel")}
          >
            <ToggleGroupItem value="all" className="flex-none px-2.5 text-xs">
              {t("hailHistory.range.all", {
                from: station.firstYear,
                to: station.lastYear,
              })}
            </ToggleGroupItem>
            <ToggleGroupItem
              value="recent"
              className="flex-none px-2.5 text-xs"
            >
              {t("hailHistory.range.recent", { count: RECENT_YEARS })}
            </ToggleGroupItem>
          </ToggleGroup>
        )}
        <span className="ml-auto text-[11px] text-muted-foreground">
          {t("hailHistory.clickHint")}
        </span>
      </div>

      {view === "years" ? (
        <YearChart
          bars={yearBars(station, range)}
          mean={station.hailDaysPerYear}
          selectedYear={selection?.kind === "year" ? selection.year : null}
          onSelect={(year) =>
            setSelection((current) =>
              current?.kind === "year" && current.year === year
                ? null
                : { kind: "year", year },
            )
          }
        />
      ) : (
        <MonthChart
          bars={monthBars(station)}
          labels={months}
          names={monthNames}
          selectedMonth={selection?.kind === "month" ? selection.month : null}
          onSelect={(month) =>
            setSelection((current) =>
              current?.kind === "month" && current.month === month
                ? null
                : { kind: "month", month },
            )
          }
        />
      )}
      {view === "years" && (
        <Legend
          showGap={yearBars(station, range).some((bar) => bar.days == null)}
        />
      )}

      {selection && (
        <SelectionDetail
          station={station}
          selection={selection}
          monthName={
            selection.kind === "month" ? monthNames[selection.month] : ""
          }
          onClose={() => setSelection(null)}
        />
      )}

      <Notes notes={notes} newer={newer} onSwitch={onSwitch} />
    </div>
  );
}

function Figure({
  label,
  value,
  hint,
  onClick,
}: Readonly<{
  label: string;
  value: string;
  hint?: string;
  onClick?: () => void;
}>): React.JSX.Element {
  const body = (
    <>
      <dt className="text-[11px] leading-tight text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-base font-semibold leading-snug tabular-nums">
        {value}
      </dd>
      {hint && (
        <dd className="mt-0.5 text-[11px] leading-tight text-muted-foreground">
          {hint}
        </dd>
      )}
    </>
  );
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border px-2.5 py-2 text-left transition-colors hover:bg-accent"
    >
      {body}
    </button>
  ) : (
    <div className="rounded-lg border px-2.5 py-2">{body}</div>
  );
}

/** Ticks on round years so the axis reads as a time line. */
function yearTicks(bars: YearBar[]): number[] {
  if (bars.length === 0) return [];
  const first = bars[0].year;
  const last = bars[bars.length - 1].year;
  const step = last - first > 40 ? 10 : last - first > 15 ? 5 : 2;
  const ticks: number[] = [];
  for (let y = Math.ceil(first / step) * step; y <= last; y += step)
    ticks.push(y);
  return ticks;
}

function YearChart({
  bars,
  mean,
  selectedYear,
  onSelect,
}: Readonly<{
  bars: YearBar[];
  mean: number;
  selectedYear: number | null;
  onSelect: (year: number) => void;
}>): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const max = Math.max(1, ...bars.map((b) => b.days ?? 0));
  const ticks = countTicks(max);
  const data = bars.map((b) => ({ ...b, value: b.days ?? 0 }));
  // Runs of years without observations become one grey band, so a gap
  // never reads as "no hail".
  const gaps: Array<[number, number]> = [];
  for (const bar of bars) {
    if (bar.days != null) continue;
    const last = gaps[gaps.length - 1];
    if (last && last[1] === bar.year - 1) last[1] = bar.year;
    else gaps.push([bar.year, bar.year]);
  }
  return (
    <ChartContainer
      config={{ value: { label: t("hailHistory.axisDays") } }}
      className="aspect-auto h-48 w-full"
    >
      <BarChart
        accessibilityLayer
        data={data}
        margin={{ top: 14, right: 44, left: 0, bottom: 0 }}
        barCategoryGap={1}
      >
        <CartesianGrid vertical={false} strokeOpacity={0.15} />
        {gaps.map(([from, to]) => (
          <ReferenceArea
            key={from}
            x1={from - 0.5}
            x2={to + 0.5}
            fill={GAP_COLOR}
            fillOpacity={0.12}
            strokeOpacity={0}
            ifOverflow="hidden"
          />
        ))}
        <XAxis
          dataKey="year"
          type="number"
          domain={[bars[0]?.year - 0.5, bars[bars.length - 1]?.year + 0.5]}
          ticks={yearTicks(bars)}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 10 }}
          allowDecimals={false}
        />
        <YAxis
          allowDecimals={false}
          domain={[0, ticks[ticks.length - 1]]}
          ticks={ticks}
          width={44}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 10 }}
          label={{
            value: t("hailHistory.axisDays"),
            angle: -90,
            position: "insideLeft",
            offset: 12,
            style: { fontSize: 10, textAnchor: "middle" },
            className: "fill-muted-foreground",
          }}
        />
        <Tooltip
          cursor={{ fillOpacity: 0.08 }}
          content={({ active, payload }) => {
            const bar = payload?.[0]?.payload as YearBar | undefined;
            if (!active || !bar) return null;
            return (
              <TooltipCard title={String(bar.year)}>
                {bar.days == null ? (
                  <span className="text-muted-foreground">
                    {t("hailHistory.notObserved")}
                  </span>
                ) : (
                  <>
                    <span className="font-medium">
                      {bar.days === 0
                        ? t("hailHistory.zeroDays")
                        : t("hailHistory.days", { count: bar.days })}
                    </span>
                    {bar.dates.length > 0 && (
                      <span className="text-muted-foreground">
                        {bar.dates
                          .map((date) => formatDayShort(date, i18n.language))
                          .join(", ")}
                      </span>
                    )}
                  </>
                )}
              </TooltipCard>
            );
          }}
        />
        <ReferenceLine
          y={mean}
          stroke="var(--muted-foreground)"
          strokeDasharray="4 3"
          ifOverflow="extendDomain"
          label={{
            value: t("hailHistory.meanLabel", { days: num(mean, 1) }),
            position: "right",
            fontSize: 10,
            className: "fill-muted-foreground",
          }}
        />
        <Bar
          dataKey="value"
          isAnimationActive={false}
          background={{ fill: "transparent" }}
          className="cursor-pointer"
          onClick={(_, index) => {
            const year = data[index]?.year;
            if (year != null) onSelect(year);
          }}
        >
          {data.map((bar) => (
            <Cell
              key={bar.year}
              fill={bar.year === selectedYear ? BAR_SELECTED : BAR_COLOR}
              fillOpacity={
                selectedYear == null || bar.year === selectedYear ? 1 : 0.45
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

function MonthChart({
  bars,
  labels,
  names,
  selectedMonth,
  onSelect,
}: Readonly<{
  bars: MonthBar[];
  labels: string[];
  names: string[];
  selectedMonth: number | null;
  onSelect: (month: number) => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const data = bars.map((b) => ({ ...b, label: labels[b.month] }));
  const monthTicks = countTicks(Math.max(1, ...bars.map((b) => b.days)));
  return (
    <ChartContainer
      config={{ days: { label: t("hailHistory.axisDays") } }}
      className="aspect-auto h-48 w-full"
    >
      <BarChart
        accessibilityLayer
        data={data}
        margin={{ top: 14, right: 8, left: 0, bottom: 0 }}
      >
        <CartesianGrid vertical={false} strokeOpacity={0.15} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 10 }}
          interval={0}
        />
        <YAxis
          allowDecimals={false}
          domain={[0, monthTicks[monthTicks.length - 1]]}
          ticks={monthTicks}
          width={44}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 10 }}
          label={{
            value: t("hailHistory.axisDaysTotal"),
            angle: -90,
            position: "insideLeft",
            offset: 12,
            style: { fontSize: 10, textAnchor: "middle" },
            className: "fill-muted-foreground",
          }}
        />
        <Tooltip
          cursor={{ fillOpacity: 0.08 }}
          content={({ active, payload }) => {
            const bar = payload?.[0]?.payload as MonthBar | undefined;
            if (!active || !bar) return null;
            return (
              <TooltipCard title={names[bar.month]}>
                <span className="font-medium">
                  {t("hailHistory.days", { count: bar.days })}
                </span>
                <span className="text-muted-foreground">
                  {t("hailHistory.monthShare", { share: pct(bar.share) })}
                </span>
              </TooltipCard>
            );
          }}
        />
        <Bar
          dataKey="days"
          radius={[3, 3, 0, 0]}
          isAnimationActive={false}
          background={{ fill: "transparent" }}
          className="cursor-pointer"
          onClick={(_, index) => {
            const month = data[index]?.month;
            if (month != null) onSelect(month);
          }}
        >
          {data.map((bar) => (
            <Cell
              key={bar.month}
              fill={bar.month === selectedMonth ? BAR_SELECTED : BAR_COLOR}
              fillOpacity={
                selectedMonth == null || bar.month === selectedMonth ? 1 : 0.45
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

function Legend({
  showGap,
}: Readonly<{ showGap: boolean }>): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm bg-[var(--chart-1)]" />
        {t("hailHistory.legend.days")}
      </span>
      {showGap && (
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-muted-foreground/15" />
          {t("hailHistory.legend.gap")}
        </span>
      )}
      <span className="inline-flex items-center gap-1.5">
        <span className="w-3 border-t border-dashed border-muted-foreground" />
        {t("hailHistory.legend.mean")}
      </span>
    </div>
  );
}

function TooltipCard({
  title,
  children,
}: Readonly<{ title: string; children: React.ReactNode }>): React.JSX.Element {
  return (
    <div className="max-w-60 rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
      <div className="mb-0.5 font-medium">{title}</div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

/** Hail days of the clicked year or month, newest first. */
function SelectionDetail({
  station,
  selection,
  monthName,
  onClose,
}: Readonly<{
  station: HailHistoryStation;
  selection: Selection;
  monthName: string;
  onClose: () => void;
}>): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  const all = station.hailDates ?? [];
  const observed = station.hailDaysByYear.find(
    (e) => selection.kind === "year" && e.year === selection.year,
  );
  const dates = (
    selection.kind === "year"
      ? all.filter((date) => date.startsWith(`${selection.year}-`))
      : all.filter((date) => Number(date.slice(5, 7)) - 1 === selection.month)
  )
    .slice()
    .reverse();
  const shown = showAll ? dates : dates.slice(0, 12);
  const title =
    selection.kind === "year"
      ? String(selection.year)
      : t("hailHistory.detail.monthTitle", { month: monthName });

  let summary: string;
  if (selection.kind === "year" && !observed)
    summary = t("hailHistory.notObserved");
  else if (dates.length === 0) summary = t("hailHistory.detail.noHail");
  else
    summary =
      selection.kind === "year"
        ? t("hailHistory.days", { count: dates.length })
        : t("hailHistory.detail.monthSummary", {
            count: dates.length,
            years: new Set(dates.map((date) => date.slice(0, 4))).size,
          });

  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2">
      <div className="flex items-center gap-2">
        <CalendarDays className="size-3.5 text-muted-foreground" />
        <span className="font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{summary}</span>
        <Button
          size="icon"
          variant="ghost"
          className="ml-auto size-6"
          onClick={onClose}
          aria-label={t("hailHistory.detail.close")}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      {dates.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {shown.map((date) => (
            <li
              key={date}
              className="rounded-md border bg-background px-2 py-0.5 text-xs tabular-nums"
            >
              {formatDayLong(date, i18n.language)}
            </li>
          ))}
          {dates.length > shown.length && (
            <li>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                onClick={() => setShowAll(true)}
              >
                {t("hailHistory.detail.more", {
                  count: dates.length - shown.length,
                })}
              </Button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function noteText(t: TFunction, note: HailNote): string {
  switch (note.kind) {
    case "ended":
      return t("hailHistory.notes.ended", {
        year: note.lastYear,
        count: note.yearsAgo,
      });
    case "far":
      return t("hailHistory.notes.far", {
        distance: num(note.distanceKm, 0),
      });
    case "short":
      return t("hailHistory.notes.short", { count: note.years });
    case "gaps":
      return t("hailHistory.notes.gaps", { count: note.missing });
  }
}

/** What limits the figures of this station, then the standing EAL note. */
function Notes({
  notes,
  newer,
  onSwitch,
}: Readonly<{
  notes: HailNote[];
  newer: HailHistoryStation | null;
  onSwitch: (stationId: string) => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <ul className="space-y-1 text-xs">
      {notes.map((note) => (
        <li
          key={note.kind}
          className={cn(
            "flex items-start gap-2 rounded-md border-l-4 bg-muted/30 px-2.5 py-1.5",
            note.kind === "ended" || note.kind === "far"
              ? "border-l-amber-500"
              : "border-l-sky-500",
          )}
        >
          {note.kind === "ended" || note.kind === "far" ? (
            <TriangleAlert className="mt-px size-3.5 shrink-0 text-amber-500" />
          ) : (
            <Info className="mt-px size-3.5 shrink-0 text-sky-500" />
          )}
          <span className="min-w-0 flex-1">
            {noteText(t, note)}
            {note.kind === "ended" && newer && (
              <>
                {" "}
                {t("hailHistory.notes.newer", {
                  name: newer.name,
                  year: newer.lastYear,
                })}
              </>
            )}
          </span>
          {note.kind === "ended" && newer && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 shrink-0 px-2 text-xs"
              onClick={() => onSwitch(newer.stationId)}
            >
              {t("hailHistory.notes.switch")}
            </Button>
          )}
        </li>
      ))}
      <li className="flex items-start gap-2 px-2.5 text-muted-foreground">
        <Info className="mt-px size-3.5 shrink-0" />
        <span>{t("hailHistory.notes.context")}</span>
      </li>
    </ul>
  );
}

function formatDay(iso: string, locale: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, {
    timeZone: "UTC",
  });
}

function formatDayShort(iso: string, locale: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function formatDayLong(iso: string, locale: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
