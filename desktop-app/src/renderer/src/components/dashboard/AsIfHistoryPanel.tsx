import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Loader2, MapPin } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AnalyzedDealership } from "@shared/types";
import type {
  AsIfDay,
  AsIfHistory,
  AsIfSite,
  CandidateDays,
} from "@shared/as-if-history";
import { classDamageFromParameters } from "@shared/hail-events";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@renderer/components/ui/card";
import { ChartContainer } from "@renderer/components/ui/chart";
import { HintButton } from "@renderer/components/ui/hint-button";
import { Input } from "@renderer/components/ui/input";
import { Label } from "@renderer/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@renderer/components/ui/table";
import { eur, eurCompact, num, pct, uiLocale } from "@renderer/lib/format";
import { notify } from "@renderer/lib/notify";
import { useHailSimActions } from "@renderer/lib/useHailSimActions";
import { useAppStore } from "@renderer/store/appStore";
import { useHailReplayStore } from "@renderer/store/hailReplayStore";
import { TileInfo } from "./TileInfo";
import {
  dayLabel,
  daysByLoss,
  latestLoadableDay,
  nextToLoad,
  worstDay,
  worstYear,
  yearBars,
  type AsIfYearBar,
} from "./asIfView";

/** Days shown before "show all". */
const INITIAL_ROWS = 8;
/** Proposed days listed, and days loaded in one go. */
const CANDIDATE_ROWS = 10;
const BATCH_SIZE = 5;

/**
 * As-if history: the real storm days stored in the app applied to the
 * locations shown, with the loss per year and per day. Only loaded days are
 * evaluated, so the tile also proposes days worth loading (hail days at the
 * DWD stations near the portfolio) and loads them. A stress test: not the
 * hail EAL and not a catastrophe-model PML.
 */
export function AsIfHistoryPanel({
  dealerships,
  onSelect,
}: Readonly<{
  dealerships: AnalyzedDealership[];
  onSelect: (d: AnalyzedDealership) => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const parameters = useAppStore((s) => s.parameters);
  const radiusKm = useHailReplayStore((s) => s.radiusKm);
  const actions = useHailSimActions();

  const sites = useMemo<AsIfSite[]>(
    () =>
      dealerships
        .filter(
          (d) => d.risk && Number.isFinite(d.lat) && Number.isFinite(d.lon),
        )
        .map((d) => ({
          id: d.id,
          lat: d.lat,
          lon: d.lon,
          exposureEur: Math.max(0, d.risk?.exposureEur ?? 0),
        })),
    [dealerships],
  );
  const byId = useMemo(
    () => new Map(dealerships.map((d) => [d.id, d])),
    [dealerships],
  );
  const damage = useMemo(
    () => classDamageFromParameters(parameters),
    [parameters],
  );

  const [history, setHistory] = useState<AsIfHistory | null>(null);
  const [failed, setFailed] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [candidates, setCandidates] = useState<CandidateDays | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [dayInput, setDayInput] = useState("");
  /** Days being loaded: the one in progress and how many of the batch. */
  const [loading, setLoading] = useState<{
    day: string;
    index: number;
    total: number;
  } | null>(null);
  const cancelled = useRef(false);
  const requestId = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    const id = ++requestId.current;
    try {
      const result = await window.api.hailEventsAsIf({
        sites,
        damage,
        radiusKm,
      });
      if (id !== requestId.current) return;
      setHistory(result);
      setFailed(false);
    } catch (error) {
      if (id !== requestId.current) return;
      console.warn("As-if history failed", error);
      setFailed(true);
    }
  }, [sites, damage, radiusKm]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Proposed days belong to the locations they were asked for.
  useEffect(() => setCandidates(null), [sites]);

  async function loadDays(days: string[]): Promise<void> {
    if (days.length === 0 || loading) return;
    cancelled.current = false;
    let loaded = 0;
    for (const [index, day] of days.entries()) {
      if (cancelled.current) break;
      setLoading({ day, index: index + 1, total: days.length });
      try {
        const summary = await window.api.hailEventsLoadHistoric(day);
        loaded += 1;
        if (summary.cells === 0)
          notify.info(t("hailReplay.historicNone", { day }));
        setCandidates((current) =>
          current
            ? {
                ...current,
                days: current.days.map((c) =>
                  c.day === day ? { ...c, loaded: true } : c,
                ),
              }
            : current,
        );
        await refresh();
      } catch (error) {
        notify.error(
          t("dashboard.asIf.loadFailed", {
            day: dayLabel(day, uiLocale()),
          }),
          { cause: error },
        );
      }
    }
    setLoading(null);
    if (loaded > 0) void actions.refresh();
  }

  async function suggest(): Promise<void> {
    setSuggesting(true);
    try {
      setCandidates(await window.api.hailEventsSuggestDays(sites));
    } catch (error) {
      notify.error(t("dashboard.asIf.suggestFailed"), { cause: error });
    } finally {
      setSuggesting(false);
    }
  }

  async function showOnMap(day: AsIfDay): Promise<void> {
    const id = day.eventIds[0];
    if (!id) return;
    await actions.open(id, true);
    navigate("/map");
  }

  const days = useMemo(() => daysByLoss(history?.days ?? []), [history]);
  const bars = useMemo(() => yearBars(history?.years ?? []), [history]);
  const checkedYears = useMemo(
    () => new Set(bars.filter((bar) => bar.checked).map((bar) => bar.label)),
    [bars],
  );
  const topDay = worstDay(days);
  const topYear = worstYear(history?.years ?? []);
  const visible = showAll ? days : days.slice(0, INITIAL_ROWS);
  const locale = uiLocale();
  const title = t("dashboard.asIf.title");
  const proposed = candidates?.days.slice(0, CANDIDATE_ROWS) ?? [];
  const batch = nextToLoad(proposed, BATCH_SIZE);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          {title}
          <TileInfo
            topic="asIf"
            label={title}
            values={{
              radius: num(radiusKm, 1),
              low: pct(parameters.scenarioDamageLow),
              medium: pct(parameters.scenarioDamageMedium),
              high: pct(parameters.scenarioDamageHigh),
            }}
          />
        </CardTitle>
        <CardDescription>
          {failed
            ? t("dashboard.asIf.failed")
            : !history
              ? t("dashboard.asIf.computing")
              : history.totals.days === 0
                ? t("dashboard.asIf.empty")
                : t("dashboard.asIf.description", {
                    count: history.totals.days,
                    years: history.years.length,
                    hitDays: history.totals.hitDays,
                    sites: history.totals.sites,
                  })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {history && history.totals.days > 0 && (
          <>
            <dl className="grid gap-3 text-sm @3xl:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">
                  {t("dashboard.asIf.worstDay")}
                </dt>
                <dd className="font-medium tabular-nums">
                  {topDay
                    ? `${eur(topDay.lossEur)} · ${dayLabel(topDay.day, locale)}`
                    : t("dashboard.asIf.noLoss")}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  {t("dashboard.asIf.worstYear")}
                </dt>
                <dd className="font-medium tabular-nums">
                  {topYear
                    ? `${eur(topYear.lossEur)} · ${topYear.year}`
                    : t("dashboard.asIf.noLoss")}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  {t("dashboard.asIf.total", { count: history.totals.days })}
                </dt>
                <dd className="font-medium tabular-nums">
                  {eur(history.totals.lossEur)}
                </dd>
              </div>
            </dl>

            <ChartContainer
              config={{ lossEur: { label: t("dashboard.asIf.loss") } }}
              className="aspect-auto h-52 w-full"
            >
              <BarChart
                accessibilityLayer
                data={bars}
                margin={{ top: 20, right: 16, left: 16 }}
              >
                <CartesianGrid vertical={false} strokeOpacity={0.15} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  // A year without a loaded day is printed pale: not checked.
                  tick={({ x, y, payload }) => (
                    <text
                      x={x}
                      y={y}
                      dy={12}
                      textAnchor="middle"
                      fontSize={11}
                      className={
                        checkedYears.has(String(payload.value))
                          ? "fill-foreground"
                          : "fill-muted-foreground/50"
                      }
                    >
                      {payload.value}
                    </text>
                  )}
                />
                <YAxis hide />
                <Tooltip
                  cursor={{ fillOpacity: 0.08 }}
                  content={({ active, payload }) => {
                    const row = payload?.[0]?.payload as
                      AsIfYearBar | undefined;
                    if (!active || !row) return null;
                    return (
                      <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
                        <div className="mb-1 font-medium">{row.year}</div>
                        {row.checked ? (
                          <>
                            <div>
                              {t("dashboard.asIf.loss")}: {eur(row.lossEur)}
                            </div>
                            <div>
                              {t("dashboard.asIf.yearDays", {
                                count: row.days,
                                hitDays: row.hitDays,
                              })}
                            </div>
                            {row.worstDay && (
                              <div className="text-muted-foreground">
                                {t("dashboard.asIf.yearWorst", {
                                  day: dayLabel(row.worstDay, locale),
                                  loss: eur(row.worstDayLossEur),
                                })}
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="text-muted-foreground">
                            {t("dashboard.asIf.yearUnchecked")}
                          </div>
                        )}
                      </div>
                    );
                  }}
                />
                <Bar
                  dataKey="lossEur"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={40}
                  fill="var(--primary)"
                >
                  <LabelList
                    dataKey="lossEur"
                    position="top"
                    className="fill-foreground"
                    fontSize={11}
                    formatter={(value) =>
                      typeof value === "number" && value > 0
                        ? eurCompact(value)
                        : ""
                    }
                  />
                </Bar>
              </BarChart>
            </ChartContainer>
            <p className="text-xs text-muted-foreground">
              {t("dashboard.asIf.coverageNote")}
            </p>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-full min-w-48 whitespace-normal">
                    {t("dashboard.asIf.day")}
                  </TableHead>
                  <TableHead className="hidden @4xl:table-cell">
                    {t("dashboard.asIf.source")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("dashboard.locations")}
                  </TableHead>
                  <TableHead className="hidden @4xl:table-cell text-right">
                    {t("dashboard.asIf.exposureReached")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("dashboard.asIf.loss")}
                  </TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((day) => {
                  const label = dayLabel(day.day, locale);
                  const named = day.hits
                    .map((hit) => byId.get(hit.id))
                    .filter((d): d is AnalyzedDealership => d != null);
                  return (
                    <TableRow key={day.day}>
                      <TableCell className="max-w-0">
                        <span className="font-medium tabular-nums">
                          {label}
                        </span>
                        {day.maxClass && (
                          <span className="text-muted-foreground">
                            {" · "}
                            {t(`radarHail.class.${day.maxClass}`)}
                          </span>
                        )}
                        {named.length > 0 && (
                          <span className="block text-xs text-muted-foreground">
                            {named.slice(0, 3).map((d, i) => (
                              <span key={d.id}>
                                {i > 0 && ", "}
                                <button
                                  type="button"
                                  className="rounded-sm text-left hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                                  onClick={() => onSelect(d)}
                                >
                                  {d.name}
                                </button>
                              </span>
                            ))}
                            {day.hitCount > 3 &&
                              ` ${t("dashboard.accumulations.more", { count: day.hitCount - 3 })}`}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="hidden @4xl:table-cell">
                        {day.sources
                          .map((source) => t(`hailReplay.sources.${source}`))
                          .join(", ")}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {num(day.hitCount)}
                      </TableCell>
                      <TableCell className="hidden @4xl:table-cell text-right tabular-nums">
                        {day.hitCount > 0 ? eur(day.exposureEur) : "–"}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {day.hitCount > 0 ? eur(day.lossEur) : "–"}
                      </TableCell>
                      <TableCell className="text-right">
                        <HintButton
                          variant="ghost"
                          size="sm"
                          aria-label={t("dashboard.asIf.showOnMap", {
                            day: label,
                          })}
                          side="left"
                          onClick={() => void showOnMap(day)}
                        >
                          <MapPin />
                          <span className="hidden @7xl:inline">
                            {t("dashboard.accumulations.showOnMap")}
                          </span>
                        </HintButton>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {days.length > INITIAL_ROWS && (
              <div className="flex justify-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAll((value) => !value)}
                >
                  {showAll
                    ? t("dashboard.showLess")
                    : t("dashboard.showAll", { count: days.length })}
                </Button>
              </div>
            )}
          </>
        )}

        <div className="space-y-3 border-t pt-3">
          <div className="text-sm font-medium">
            {t("dashboard.asIf.loadTitle")}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="as-if-day" className="text-xs">
                {t("hailReplay.historicDay")}
              </Label>
              <Input
                id="as-if-day"
                type="date"
                className="h-8 w-40"
                min="2001-01-01"
                max={latestLoadableDay()}
                value={dayInput}
                onChange={(event) => setDayInput(event.target.value)}
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={!dayInput || loading != null}
              onClick={() => void loadDays([dayInput])}
            >
              {t("hailReplay.historicLoad")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={suggesting || loading != null || sites.length === 0}
              onClick={() => void suggest()}
            >
              {suggesting && <Loader2 className="animate-spin" />}
              {t("dashboard.asIf.suggest")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {loading
              ? t("dashboard.asIf.loading", {
                  day: dayLabel(loading.day, locale),
                  index: loading.index,
                  total: loading.total,
                })
              : suggesting
                ? t("dashboard.asIf.suggesting")
                : t("dashboard.asIf.loadHint")}
          </p>
          {loading && loading.total > 1 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                cancelled.current = true;
              }}
            >
              {t("dashboard.asIf.cancel")}
            </Button>
          )}

          {candidates && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {candidates.stationsUsed === 0
                  ? t("dashboard.asIf.noStations")
                  : t("dashboard.asIf.candidatesBasis", {
                      count: candidates.stationsUsed,
                      covered: candidates.sitesCovered,
                      total: candidates.sitesTotal,
                      first: candidates.firstYear ?? "–",
                      last: candidates.lastYear ?? "–",
                    })}
              </p>
              {proposed.length > 0 && (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-full whitespace-normal">
                          {t("dashboard.asIf.day")}
                        </TableHead>
                        <TableHead className="text-right">
                          {t("dashboard.asIf.candidateSites")}
                        </TableHead>
                        <TableHead className="hidden @4xl:table-cell text-right">
                          {t("dashboard.totalExposure")}
                        </TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {proposed.map((c) => (
                        <TableRow key={c.day}>
                          <TableCell className="font-medium tabular-nums">
                            {dayLabel(c.day, locale)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {num(c.sites)}
                          </TableCell>
                          <TableCell className="hidden @4xl:table-cell text-right tabular-nums">
                            {eur(c.exposureEur)}
                          </TableCell>
                          <TableCell className="text-right">
                            {c.loaded ? (
                              <Badge variant="secondary">
                                {t("dashboard.asIf.loaded")}
                              </Badge>
                            ) : (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={loading != null}
                                aria-label={t("dashboard.asIf.loadDay", {
                                  day: dayLabel(c.day, locale),
                                })}
                                onClick={() => void loadDays([c.day])}
                              >
                                {t("hailReplay.historicLoad")}
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {batch.length > 1 && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={loading != null}
                      onClick={() => void loadDays(batch)}
                    >
                      {t("dashboard.asIf.loadBatch", { days: batch.length })}
                    </Button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
