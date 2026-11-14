import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  Building2,
  ChevronDown,
  ChevronUp,
  CloudHail,
  FileUp,
  History,
  Loader2,
  MapPin,
  PenLine,
  RefreshCw,
  RotateCcw,
  Save,
  Shuffle,
  Trash2,
  X,
} from "lucide-react";
import type { HailEventSummary } from "@shared/hail-events";
import {
  SIM_HEADINGS,
  SIM_STRENGTHS,
  type SimHeading,
  type SimStrength,
} from "@shared/hail-sim";
import { Button } from "@renderer/components/ui/button";
import { HintButton } from "@renderer/components/ui/hint-button";
import { Input } from "@renderer/components/ui/input";
import { Label } from "@renderer/components/ui/label";
import { Slider } from "@renderer/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@renderer/components/ui/tabs";
import { eur, eurCompact, num } from "@renderer/lib/format";
import {
  useHailEventImpact,
  useNearestMiss,
  usePortfolioTargets,
} from "@renderer/lib/useHailEventImpact";
import { useHailSimActions } from "@renderer/lib/useHailSimActions";
import { useAppStore } from "@renderer/store/appStore";
import {
  useHailReplayStore,
  type HailPanelTab,
} from "@renderer/store/hailReplayStore";
import { HAIL_CLASS_COLOR } from "./HailEventReplayLayer";
import {
  HailReplayBar,
  replayClockLabel,
  replayDateLabel,
} from "./HailReplayBar";
import {
  PANEL_ACTION_CLASS,
  PANEL_CONTROL_CLASS,
  PANEL_HINT_CLASS,
  PANEL_LABEL_CLASS,
} from "./panelStyles";

/** How far an event can be moved, km in each direction. */
const MAX_SHIFT_KM = 150;
/** Reached locations listed; the rest are counted. */
const LISTED_HITS = 12;
/** A famous storm to start the historic tab with (validated in the data). */
const ANDREAS_DAY = "2013-07-28";

function yesterday(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Field with a label, the panel's standard layout. */
function Field({
  id,
  label,
  children,
}: Readonly<{
  id: string;
  label: string;
  children: React.ReactNode;
}>): React.JSX.Element {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className={PANEL_LABEL_CLASS}>
        {label}
      </Label>
      {children}
    </div>
  );
}

function StrengthSelect({
  id,
  value,
  onChange,
}: Readonly<{
  id: string;
  value: SimStrength;
  onChange: (v: SimStrength) => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Select value={value} onValueChange={(v) => onChange(v as SimStrength)}>
      <SelectTrigger id={id} className={PANEL_CONTROL_CLASS}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(SIM_STRENGTHS) as SimStrength[]).map((s) => (
          <SelectItem key={s} value={s}>
            {t(`hailReplay.strengths.${s}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** One big figure of the result. */
function Figure({
  label,
  value,
  tone,
}: Readonly<{
  label: string;
  value: string;
  tone?: "loss";
}>): React.JSX.Element {
  return (
    <div className="min-w-0 rounded-md bg-muted/60 px-2 py-1.5">
      <div className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={`truncate text-sm font-semibold tabular-nums ${tone === "loss" ? "text-destructive" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * Hail simulation on the map: generate storms (over Germany, aimed at the
 * portfolio, or from a clicked point), draw a track, load a historic storm
 * day from the DWD radar climatology, or replay the live radar archive and
 * saved scenarios. The loaded event plays on the map; below, what it does
 * to the portfolio, and a "what if" shift.
 */
export function HailSimPanel(): React.JSX.Element {
  const { t } = useTranslation();
  const s = useHailReplayStore();
  const actions = useHailSimActions();
  const impact = useHailEventImpact();
  const nearest = useNearestMiss();
  const targets = usePortfolioTargets();
  const dealerships = useAppStore((st) => st.dealerships);
  const select = useAppStore((st) => st.select);
  const fileRef = useRef<HTMLInputElement>(null);
  const { refresh } = actions;

  // The list is loaded when the panel opens.
  useEffect(() => {
    if (s.panelOpen && !s.list && !s.listLoading) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.panelOpen]);

  const byId = useMemo(
    () => new Map(dealerships.map((d) => [d.id, d])),
    [dealerships],
  );

  if (!s.panelOpen) {
    return (
      <Button
        variant="outline"
        className="pointer-events-auto h-9 gap-1.5 bg-card shadow-lg"
        onClick={() => s.setPanelOpen(true)}
      >
        <CloudHail className="size-4 text-primary" />
        {t("hailReplay.open")}
      </Button>
    );
  }

  // While a map click is expected the panel shrinks to a strip, so the
  // map is free to click on.
  if (s.mapMode) {
    return (
      <div
        className="pointer-events-auto w-80 space-y-2 rounded-lg border bg-card p-3 shadow-lg"
        data-testid="hail-panel"
      >
        <div className="flex items-start gap-1.5">
          {s.mapMode === "draw" ? (
            <PenLine className="mt-0.5 size-4 shrink-0 text-primary" />
          ) : (
            <MapPin className="mt-0.5 size-4 shrink-0 text-primary" />
          )}
          <p className="text-xs leading-snug">
            {s.mapMode === "draw"
              ? t("hailReplay.drawHint")
              : t("hailReplay.pickStartHint")}
          </p>
        </div>
        <div className="flex gap-1.5">
          {s.mapMode === "draw" && (
            <Button
              size="sm"
              className="h-8 flex-1"
              disabled={s.drawPoints.length < 2}
              onClick={() => actions.simulateAlong(s.drawPoints)}
            >
              {t("hailReplay.drawDone", { count: s.drawPoints.length })}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-8 flex-1"
            onClick={() => s.setMapMode(null)}
          >
            {t("hailReplay.drawCancel")}
          </Button>
        </div>
      </div>
    );
  }

  const detail = s.detail;
  const events = s.list?.events ?? [];
  const radarEvents = events.filter((e) => e.source === "radar");
  const stored = events.filter((e) => e.source !== "radar");
  const canSave =
    detail?.summary.source === "simulation" ||
    detail?.summary.source === "drawn";

  function eventRow(e: HailEventSummary): React.JSX.Element {
    const active = detail?.summary.id === e.id;
    const label =
      e.source === "radar" || e.source === "radklim"
        ? replayDateLabel(e.start)
        : (e.name ?? t("hailReplay.importDefaultName"));
    return (
      <li key={e.id} className="flex items-center gap-1">
        <button
          type="button"
          className={`flex min-w-0 flex-1 items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs hover:bg-accent ${active ? "bg-accent font-medium" : ""}`}
          onClick={() => void actions.open(e.id)}
        >
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ background: HAIL_CLASS_COLOR[e.maxClass] }}
          />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {t(`hailReplay.sources.${e.source}`)}
          </span>
        </button>
        {e.source !== "radar" && (
          <HintButton
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label={t("hailReplay.deleteEvent")}
            onClick={() => void actions.remove(e.id)}
          >
            <Trash2 className="size-3" />
          </HintButton>
        )}
      </li>
    );
  }

  return (
    <div
      className="pointer-events-auto flex max-h-full w-80 min-h-0 flex-col rounded-lg border bg-card shadow-lg"
      data-testid="hail-panel"
    >
      <div className="flex items-center gap-1.5 border-b px-3 py-2">
        <CloudHail className="size-4 text-primary" />
        <span className="flex-1 text-sm font-semibold">
          {t("hailReplay.title")}
        </span>
        <HintButton
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={
            s.collapsed ? t("hailReplay.expand") : t("hailReplay.collapse")
          }
          onClick={() => s.setCollapsed(!s.collapsed)}
        >
          {s.collapsed ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronUp className="size-4" />
          )}
        </HintButton>
        <HintButton
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={t("hailReplay.close")}
          onClick={() => s.setPanelOpen(false)}
        >
          <X className="size-4" />
        </HintButton>
      </div>

      <div className="min-h-0 space-y-3 overflow-y-auto px-3 py-2.5">
        {!s.collapsed && (
          <Tabs
            value={s.tab}
            onValueChange={(v) => s.setTab(v as HailPanelTab)}
          >
            <TabsList className="grid h-auto w-full grid-cols-4">
              <TabsTrigger value="simulate" className="px-1 text-xs">
                {t("hailReplay.tabs.simulate")}
              </TabsTrigger>
              <TabsTrigger value="draw" className="px-1 text-xs">
                {t("hailReplay.tabs.draw")}
              </TabsTrigger>
              <TabsTrigger value="history" className="px-1 text-xs">
                {t("hailReplay.tabs.history")}
              </TabsTrigger>
              <TabsTrigger value="library" className="px-1 text-xs">
                {t("hailReplay.tabs.library")}
              </TabsTrigger>
            </TabsList>

            {/* Generate storms */}
            <TabsContent value="simulate" className="space-y-2.5">
              <div className="grid grid-cols-2 gap-2">
                <Field id="sim-strength" label={t("hailReplay.strength")}>
                  <StrengthSelect
                    id="sim-strength"
                    value={s.sim.strength}
                    onChange={(strength) => s.setSim({ strength })}
                  />
                </Field>
                <Field id="sim-heading" label={t("hailReplay.heading")}>
                  <Select
                    value={s.sim.heading}
                    onValueChange={(v) =>
                      s.setSim({ heading: v as SimHeading })
                    }
                  >
                    <SelectTrigger
                      id="sim-heading"
                      className={PANEL_CONTROL_CLASS}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(SIM_HEADINGS) as SimHeading[]).map((h) => (
                        <SelectItem key={h} value={h}>
                          {t(`hailReplay.headings.${h}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <Field
                id="sim-storms"
                label={t("hailReplay.storms", { count: s.sim.storms })}
              >
                <Slider
                  id="sim-storms"
                  min={1}
                  max={12}
                  step={1}
                  value={s.sim.storms}
                  onValueChange={(storms) => s.setSim({ storms })}
                />
              </Field>
              <div className="space-y-1.5">
                <Button
                  size="sm"
                  className={PANEL_ACTION_CLASS}
                  disabled={targets.length === 0}
                  onClick={() => actions.simulateOutbreak("portfolio")}
                >
                  <Building2 className="size-3.5" />
                  {t("hailReplay.simPortfolio")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className={PANEL_ACTION_CLASS}
                  onClick={() => actions.simulateOutbreak("germany")}
                >
                  <Shuffle className="size-3.5" />
                  {t("hailReplay.simGermany")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className={PANEL_ACTION_CLASS}
                  onClick={() => s.setMapMode("pickStart")}
                >
                  <MapPin className="size-3.5" />
                  {t("hailReplay.pickStart")}
                </Button>
              </div>
              {targets.length === 0 && (
                <p className={PANEL_HINT_CLASS}>
                  {t("hailReplay.noPortfolio")}
                </p>
              )}
            </TabsContent>

            {/* Draw a track */}
            <TabsContent value="draw" className="space-y-2.5">
              <div className="grid grid-cols-2 gap-2">
                <Field id="draw-strength" label={t("hailReplay.strength")}>
                  <StrengthSelect
                    id="draw-strength"
                    value={s.draw.strength}
                    onChange={(strength) => s.setDraw({ strength })}
                  />
                </Field>
                <Field id="draw-speed" label={t("hailReplay.speedKmh")}>
                  <Select
                    value={String(s.draw.speedKmh)}
                    onValueChange={(v) => s.setDraw({ speedKmh: Number(v) })}
                  >
                    <SelectTrigger
                      id="draw-speed"
                      className={PANEL_CONTROL_CLASS}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[30, 50, 70].map((v) => (
                        <SelectItem key={v} value={String(v)}>
                          {v} km/h
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <Button
                size="sm"
                variant="outline"
                className={PANEL_ACTION_CLASS}
                onClick={() => s.setMapMode("draw")}
              >
                <PenLine className="size-3.5" />
                {t("hailReplay.drawTrack")}
              </Button>
              <p className={PANEL_HINT_CLASS}>{t("hailReplay.drawHint")}</p>
            </TabsContent>

            {/* Historic storm days (DWD RADKLIM) */}
            <TabsContent value="history" className="space-y-2.5">
              <p className={PANEL_HINT_CLASS}>
                {t("hailReplay.historicIntro")}
              </p>
              <Button
                size="sm"
                variant="outline"
                className={PANEL_ACTION_CLASS}
                disabled={s.historicLoading}
                onClick={() => {
                  s.setHistoricDay(ANDREAS_DAY);
                  void actions.loadHistoric(ANDREAS_DAY);
                }}
              >
                <History className="size-3.5" />
                {t("hailReplay.presetAndreas")}
              </Button>
              <div className="flex items-end gap-1.5">
                <Field id="historic-day" label={t("hailReplay.historicDay")}>
                  <Input
                    id="historic-day"
                    type="date"
                    className={PANEL_CONTROL_CLASS}
                    min="2001-01-01"
                    max={yesterday()}
                    value={s.historicDay}
                    onChange={(e) => s.setHistoricDay(e.target.value)}
                  />
                </Field>
                <Button
                  size="sm"
                  className="h-8 shrink-0"
                  disabled={s.historicLoading || !s.historicDay}
                  onClick={() => void actions.loadHistoric(s.historicDay)}
                >
                  {s.historicLoading ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    t("hailReplay.historicLoad")
                  )}
                </Button>
              </div>
              {s.historicLoading && (
                <p className={PANEL_HINT_CLASS}>
                  {t("hailReplay.historicLoading")}
                </p>
              )}
            </TabsContent>

            {/* Radar archive, historic days, saved and imported events */}
            <TabsContent value="library" className="space-y-2.5">
              <div className="flex items-center justify-between gap-1">
                <span className={`${PANEL_LABEL_CLASS} font-medium`}>
                  {t("hailReplay.libraryStored")}
                </span>
                <HintButton
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  aria-label={t("hailReplay.refresh")}
                  onClick={() => void refresh()}
                  disabled={s.listLoading}
                >
                  {s.listLoading ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <RefreshCw className="size-3" />
                  )}
                </HintButton>
              </div>
              {stored.length > 0 ? (
                <ul className="max-h-36 space-y-0.5 overflow-y-auto">
                  {stored.map(eventRow)}
                </ul>
              ) : (
                <p className={PANEL_HINT_CLASS}>
                  {t("hailReplay.libraryEmpty")}
                </p>
              )}
              <span className={`${PANEL_LABEL_CLASS} block font-medium`}>
                {t("hailReplay.libraryRadar")}
              </span>
              {radarEvents.length > 0 ? (
                <ul className="max-h-36 space-y-0.5 overflow-y-auto">
                  {radarEvents.map(eventRow)}
                </ul>
              ) : null}
              {s.listError && <p className={PANEL_HINT_CLASS}>{s.listError}</p>}
              {s.list && (
                <p className={PANEL_HINT_CLASS}>
                  {s.list.archiveFrom
                    ? t("hailReplay.archive", {
                        from: replayDateLabel(Date.parse(s.list.archiveFrom)),
                        to: replayDateLabel(
                          Date.parse(s.list.archiveTo ?? s.list.archiveFrom),
                        ),
                        steps: num(s.list.steps),
                      })
                    : t("hailReplay.archiveEmpty")}
                  {s.list.syncing && ` ${t("hailReplay.syncing")}`}
                </p>
              )}
              <input
                ref={fileRef}
                type="file"
                accept=".geojson,.json,application/geo+json,application/json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void actions.importFile(file);
                }}
              />
              <Button
                variant="outline"
                size="sm"
                className={PANEL_ACTION_CLASS}
                onClick={() => fileRef.current?.click()}
              >
                <FileUp className="size-3.5" />
                {t("hailReplay.importFootprint")}
              </Button>
            </TabsContent>
          </Tabs>
        )}

        {s.detailLoading && (
          <p className={PANEL_HINT_CLASS}>
            <Loader2 className="mr-1 inline size-3 animate-spin" />
            {t("hailReplay.loadingEvent")}
          </p>
        )}

        {detail && impact && (
          <div
            className="space-y-2.5 border-t pt-2.5"
            data-testid="hail-result"
          >
            <div className="flex items-start gap-1.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">
                  {detail.summary.source === "radar" ||
                  detail.summary.source === "radklim"
                    ? replayDateLabel(detail.summary.start)
                    : detail.summary.name}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {t(`hailReplay.sources.${detail.summary.source}`)} ·{" "}
                  {t("hailReplay.tracks", { count: detail.summary.tracks })} ·{" "}
                  {t(`radarHail.class.${detail.summary.maxClass}`)}
                </div>
              </div>
              {canSave && (
                <HintButton
                  variant="outline"
                  size="icon"
                  className="size-7"
                  aria-label={t("hailReplay.saveScenario")}
                  onClick={() => void actions.saveCurrent()}
                >
                  <Save className="size-3.5" />
                </HintButton>
              )}
              <HintButton
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={t("hailReplay.unload")}
                onClick={() => s.setDetail(null)}
              >
                <X className="size-3.5" />
              </HintButton>
            </div>

            <HailReplayBar />

            <div className="grid grid-cols-3 gap-1.5">
              <Figure
                label={t("hailReplay.figureReached")}
                value={num(impact.hits.length)}
              />
              <Figure
                label={t("hailReplay.figureExposure")}
                value={eurCompact(impact.totalExposureEur)}
              />
              <Figure
                label={t("hailReplay.stressLoss")}
                value={eurCompact(impact.totalLossEur)}
                tone="loss"
              />
            </div>

            {!s.collapsed && (
              <>
                {impact.hits.length === 0 && nearest && (
                  <p className="text-xs text-muted-foreground">
                    {t("hailReplay.nearestMiss", {
                      name: nearest.name,
                      km: nearest.km,
                    })}
                  </p>
                )}

                {impact.hits.length > 0 && (
                  <ul
                    aria-label={t("hailReplay.hitsList")}
                    className="max-h-40 space-y-0.5 overflow-y-auto"
                  >
                    {impact.hits.slice(0, LISTED_HITS).map((hit) => (
                      <li key={hit.id}>
                        <button
                          type="button"
                          className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-accent"
                          onClick={() => select(hit.id)}
                        >
                          <span
                            className="size-2 shrink-0 rounded-full"
                            style={{
                              background: HAIL_CLASS_COLOR[hit.hailClass],
                            }}
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {byId.get(hit.id)?.name ?? hit.id}
                          </span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {detail.summary.timed &&
                              `${replayClockLabel(hit.firstAt)} · `}
                            {eur(hit.lossEur)}
                          </span>
                        </button>
                      </li>
                    ))}
                    {impact.hits.length > LISTED_HITS && (
                      <li className="px-1 text-[11px] text-muted-foreground">
                        {t("hailReplay.moreHits", {
                          count: impact.hits.length - LISTED_HITS,
                        })}
                      </li>
                    )}
                  </ul>
                )}

                <div className="space-y-2 rounded-md border p-2">
                  <div className="flex items-center justify-between gap-1">
                    <span className={`${PANEL_LABEL_CLASS} font-medium`}>
                      {t("hailReplay.whatIf")}
                    </span>
                    {(s.shift.eastKm !== 0 || s.shift.northKm !== 0) && (
                      <HintButton
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        aria-label={t("hailReplay.resetShift")}
                        onClick={() => s.setShift({ eastKm: 0, northKm: 0 })}
                      >
                        <RotateCcw className="size-3" />
                      </HintButton>
                    )}
                  </div>
                  <Field
                    id="hail-shift-north"
                    label={t("hailReplay.shiftNorth", {
                      km: num(s.shift.northKm),
                    })}
                  >
                    <Slider
                      id="hail-shift-north"
                      min={-MAX_SHIFT_KM}
                      max={MAX_SHIFT_KM}
                      step={5}
                      value={s.shift.northKm}
                      onValueChange={(v) =>
                        s.setShift({ ...s.shift, northKm: v })
                      }
                    />
                  </Field>
                  <Field
                    id="hail-shift-east"
                    label={t("hailReplay.shiftEast", {
                      km: num(s.shift.eastKm),
                    })}
                  >
                    <Slider
                      id="hail-shift-east"
                      min={-MAX_SHIFT_KM}
                      max={MAX_SHIFT_KM}
                      step={5}
                      value={s.shift.eastKm}
                      onValueChange={(v) =>
                        s.setShift({ ...s.shift, eastKm: v })
                      }
                    />
                  </Field>
                  <Field
                    id="hail-radius"
                    label={t("hailReplay.radius", { km: num(s.radiusKm) })}
                  >
                    <Slider
                      id="hail-radius"
                      min={0}
                      max={10}
                      step={0.5}
                      value={s.radiusKm}
                      onValueChange={(v) => s.setRadiusKm(v)}
                    />
                  </Field>
                </div>

                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  {(["mixed", "hail", "large"] as const).map((c) => (
                    <span key={c} className="flex items-center gap-1">
                      <span
                        className="size-2 rounded-full"
                        style={{ background: HAIL_CLASS_COLOR[c] }}
                      />
                      {t(`radarHail.class.${c}`)}
                    </span>
                  ))}
                </div>
                <p className={PANEL_HINT_CLASS}>
                  {t(`hailReplay.notes.${detail.summary.source}`)}{" "}
                  {t("hailReplay.lossNote")}
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
