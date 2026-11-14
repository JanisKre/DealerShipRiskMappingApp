import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  Move,
  Pause,
  Play,
  RotateCcw,
  Save,
  X,
} from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import { HintButton } from "@renderer/components/ui/hint-button";
import { Label } from "@renderer/components/ui/label";
import { Slider } from "@renderer/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import { eur, eurCompact, num, uiLocale } from "@renderer/lib/format";
import {
  useHailEventImpact,
  useNearestMiss,
} from "@renderer/lib/useHailEventImpact";
import { useHailSimActions } from "@renderer/lib/useHailSimActions";
import { useAppStore } from "@renderer/store/appStore";
import {
  REPLAY_SPEEDS,
  useHailReplayStore,
  type ReplaySpeed,
} from "@renderer/store/hailReplayStore";
import { HAIL_CLASS_COLOR } from "./HailEventReplayLayer";
import { replayClockLabel, replayDateLabel } from "@renderer/lib/hailTime";

/** Reached locations listed; the rest are counted. */
const LISTED_HITS = 12;
const CARD_CLASS =
  "flex max-h-full min-h-0 w-full flex-col rounded-lg border bg-card text-sm shadow-lg";

/** A figure: so far (large) and in total (small) while the storm plays. */
function Figure({
  label,
  now,
  total,
  tone,
}: Readonly<{
  label: string;
  now: string;
  total: string;
  tone?: "loss";
}>): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="min-w-0">
      <div className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={`truncate text-base font-semibold tabular-nums ${tone === "loss" ? "text-destructive" : ""}`}
      >
        {now}
      </div>
      <div className="truncate text-[11px] tabular-nums text-muted-foreground">
        {t("hailReplay.ofTotal", { total })}
      </div>
    </div>
  );
}

/**
 * The hail event on the map, at the top of the map: what is playing, the
 * player, and what the storm has done to the portfolio so far — with the
 * reached locations, the reach and the shift behind "details". While the
 * map waits for a click (start point, track), the card says what to do.
 */
export function HailEventCard(): React.JSX.Element | null {
  const { t } = useTranslation();
  const s = useHailReplayStore();
  const actions = useHailSimActions();
  const impact = useHailEventImpact();
  const nearest = useNearestMiss();
  const dealerships = useAppStore((st) => st.dealerships);
  const select = useAppStore((st) => st.select);
  const byId = useMemo(
    () => new Map(dealerships.map((d) => [d.id, d])),
    [dealerships],
  );

  /** "14 km south, 5 km east": the shift in words, zero parts left out. */
  function shiftLabel(northKm: number, eastKm: number): string {
    const part = (km: number, plus: string, minus: string): string | null => {
      const r = Math.round(Math.abs(km));
      return r === 0
        ? null
        : t("hailReplay.kmDir", { km: num(r), dir: t(km > 0 ? plus : minus) });
    };
    return (
      [
        part(northKm, "hailReplay.dirN", "hailReplay.dirS"),
        part(eastKm, "hailReplay.dirE", "hailReplay.dirW"),
      ]
        .filter(Boolean)
        .join(", ") || t("hailReplay.kmDir", { km: "0", dir: "" }).trim()
    );
  }

  /** Money as a short figure: 0,6 Mio. € instead of a cut-off 600.000 €. */
  function money(v: number): string {
    if (v >= 100_000 && v < 1_000_000)
      return t("hailReplay.millions", {
        value: (v / 1e6).toLocaleString(uiLocale(), {
          maximumFractionDigits: 2,
        }),
      });
    return eurCompact(v);
  }

  const detail = s.detail;
  const start = detail?.summary.start ?? 0;
  const end = detail?.summary.end ?? 0;
  // The clock runs a few minutes past the last step so the storm fades.
  const stop = end + 5 * 60 * 1000;

  // Clock: advances the replay time on animation frames while playing.
  const timeRef = useRef(s.time);
  timeRef.current = s.time;
  const { playing, speed, setTime, setPlaying } = s;
  useEffect(() => {
    if (!playing) return undefined;
    const msPerSecond =
      REPLAY_SPEEDS.find((x) => x.id === speed)?.msPerSecond ?? 480_000;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number): void => {
      const next = timeRef.current + ((now - last) / 1000) * msPerSecond;
      last = now;
      if (next >= stop) {
        setTime(stop);
        setPlaying(false);
        return;
      }
      setTime(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, stop, setTime, setPlaying]);

  const sofar = useMemo(() => {
    const timed = detail?.summary.timed ?? false;
    const hits = (impact?.hits ?? []).filter(
      (h) => !timed || h.firstAt <= s.time,
    );
    return {
      count: hits.length,
      exposure: hits.reduce((x, h) => x + h.exposureEur, 0),
      loss: hits.reduce((x, h) => x + h.lossEur, 0),
    };
  }, [impact, s.time, detail]);

  // Waiting for a map click: say what to do.
  if (s.mapMode) {
    return (
      <div
        className={`${CARD_CLASS} space-y-2 px-3 py-2.5`}
        data-testid="hail-hint"
      >
        <p className="text-sm">
          {s.mapMode === "draw"
            ? t("hailReplay.drawHint")
            : t("hailReplay.pickStartHint")}
        </p>
        <div className="flex justify-end gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => s.setMapMode(null)}>
            {t("hailReplay.drawCancel")}
          </Button>
          {s.mapMode === "draw" && (
            <Button
              size="sm"
              disabled={s.drawPoints.length < 2}
              onClick={() => actions.simulateAlong(s.drawPoints)}
            >
              {t("hailReplay.drawDone", { count: s.drawPoints.length })}
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (s.historicLoading || s.detailLoading) {
    return (
      <div className={`${CARD_CLASS} flex items-center gap-2 px-3 py-2.5`}>
        <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
        <span className="text-sm">
          {s.historicLoading
            ? t("hailReplay.historicLoading")
            : t("hailReplay.loadingEvent")}
        </span>
      </div>
    );
  }

  if (!detail || !impact) return null;

  const { summary } = detail;
  const canSave = summary.source === "simulation" || summary.source === "drawn";
  const shifted = s.shift.eastKm !== 0 || s.shift.northKm !== 0;
  const atEnd = s.time >= stop;
  const title =
    summary.source === "radar" || summary.source === "radklim"
      ? replayDateLabel(summary.start)
      : summary.name;

  return (
    <div className={CARD_CLASS} data-testid="hail-result">
      <div className="flex items-start gap-2 px-3 pt-2.5">
        <span
          className="mt-1.5 size-2.5 shrink-0 rounded-full"
          style={{ background: HAIL_CLASS_COLOR[summary.maxClass] }}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{title}</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {t(`hailReplay.sources.${summary.source}`)} ·{" "}
            {t("hailReplay.tracks", { count: summary.tracks })} ·{" "}
            {t(`radarHail.class.${summary.maxClass}`)}
          </div>
        </div>
        {canSave && (
          <HintButton
            variant="ghost"
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
          <X className="size-4" />
        </HintButton>
      </div>

      {summary.timed && (
        <div className="flex items-center gap-2 px-3 pt-2">
          <HintButton
            size="icon"
            className="size-8 shrink-0 rounded-full"
            aria-label={
              s.playing
                ? t("hailReplay.pause")
                : atEnd
                  ? t("hailReplay.restart")
                  : t("hailReplay.play")
            }
            onClick={() => {
              if (atEnd) s.setTime(start);
              s.setPlaying(!s.playing);
            }}
          >
            {s.playing ? (
              <Pause className="size-4" />
            ) : atEnd ? (
              <RotateCcw className="size-4" />
            ) : (
              <Play className="size-4" />
            )}
          </HintButton>
          <span className="w-11 shrink-0 text-xs font-medium tabular-nums">
            {replayClockLabel(Math.min(s.time, end))}
          </span>
          <Slider
            aria-label={t("hailReplay.timeline")}
            className="min-w-0 flex-1"
            min={start}
            max={stop}
            step={60_000}
            value={Math.min(stop, Math.max(start, s.time))}
            onValueChange={(v) => {
              s.setPlaying(false);
              s.setTime(v);
            }}
          />
          <Select
            value={s.speed}
            onValueChange={(v) => s.setSpeed(v as ReplaySpeed)}
          >
            <SelectTrigger
              className="h-7 w-[5.5rem] shrink-0 bg-background px-2 text-xs"
              aria-label={t("hailReplay.speed")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REPLAY_SPEEDS.map((x) => (
                <SelectItem key={x.id} value={x.id}>
                  {t(`hailReplay.speeds.${x.id}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 px-3 pt-2.5">
        <Figure
          label={t("hailReplay.figureReached")}
          now={num(sofar.count)}
          total={num(impact.hits.length)}
        />
        <Figure
          label={t("hailReplay.figureExposure")}
          now={money(sofar.exposure)}
          total={money(impact.totalExposureEur)}
        />
        <Figure
          label={t("hailReplay.stressLoss")}
          now={money(sofar.loss)}
          total={money(impact.totalLossEur)}
          tone="loss"
        />
      </div>

      <div className="flex justify-end px-1.5 pb-1">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 px-2 text-xs"
          aria-expanded={s.detailsOpen}
          onClick={() => s.setDetailsOpen(!s.detailsOpen)}
        >
          {t("hailReplay.details")}
          {s.detailsOpen ? (
            <ChevronUp className="size-3.5" />
          ) : (
            <ChevronDown className="size-3.5" />
          )}
        </Button>
      </div>

      {impact.hits.length === 0 && nearest && (
        <p className="px-3 pb-2.5 text-xs text-muted-foreground">
          {t("hailReplay.nearestMiss", { name: nearest.name, km: nearest.km })}
        </p>
      )}

      {s.detailsOpen && (
        <div className="min-h-0 space-y-2.5 overflow-y-auto border-t px-3 py-2.5">
          {impact.hits.length > 0 && (
            <ul aria-label={t("hailReplay.hitsList")} className="space-y-0.5">
              {impact.hits.slice(0, LISTED_HITS).map((hit) => {
                const reached = !summary.timed || hit.firstAt <= s.time;
                return (
                  <li key={hit.id}>
                    <button
                      type="button"
                      className={`flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-accent ${reached ? "" : "opacity-50"}`}
                      onClick={() => select(hit.id)}
                    >
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ background: HAIL_CLASS_COLOR[hit.hailClass] }}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {byId.get(hit.id)?.name ?? hit.id}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {summary.timed && `${replayClockLabel(hit.firstAt)} · `}
                        {eur(hit.lossEur)}
                      </span>
                    </button>
                  </li>
                );
              })}
              {impact.hits.length > LISTED_HITS && (
                <li className="px-1 text-[11px] text-muted-foreground">
                  {t("hailReplay.moreHits", {
                    count: impact.hits.length - LISTED_HITS,
                  })}
                </li>
              )}
            </ul>
          )}

          <div className="flex items-center gap-2 rounded-md bg-muted/60 px-2 py-1.5 text-xs">
            <Move className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              {shifted
                ? t("hailReplay.shiftedBy", {
                    what: shiftLabel(s.shift.northKm, s.shift.eastKm),
                  })
                : t("hailReplay.dragHint")}
            </span>
            {shifted && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 gap-1 px-1.5 text-xs"
                onClick={() => s.setShift({ eastKm: 0, northKm: 0 })}
              >
                <RotateCcw className="size-3" />
                {t("hailReplay.resetShift")}
              </Button>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="hail-radius" className="text-xs">
              {t("hailReplay.radius", { km: num(s.radiusKm) })}
            </Label>
            <Slider
              id="hail-radius"
              min={0}
              max={10}
              step={0.5}
              value={s.radiusKm}
              onValueChange={(v) => s.setRadiusKm(v)}
            />
          </div>

          <p className="text-[11px] leading-snug text-muted-foreground">
            {t(`hailReplay.notes.${summary.source}`)} {t("hailReplay.lossNote")}
          </p>
        </div>
      )}
    </div>
  );
}
