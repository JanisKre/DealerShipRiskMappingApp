import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Pause, Play, RotateCcw, X } from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import { HintButton } from "@renderer/components/ui/hint-button";
import { Slider } from "@renderer/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import { eurCompact, uiLocale } from "@renderer/lib/format";
import { useHailEventImpact } from "@renderer/lib/useHailEventImpact";
import {
  REPLAY_SPEEDS,
  useHailReplayStore,
  type ReplaySpeed,
} from "@renderer/store/hailReplayStore";

/** Local date and time of a replay moment. */
export function replayTimeLabel(ms: number): string {
  return new Date(ms).toLocaleString(uiLocale(), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Local date of a replay moment. */
export function replayDateLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(uiLocale(), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** Local clock time of a replay moment. */
export function replayClockLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString(uiLocale(), {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Playback bar at the bottom of the map while a timed hail event is
 * loaded: play / pause, the time slider, speed, and a running count of the
 * locations reached so far with their stress-test loss.
 */
export function HailReplayBar(): React.JSX.Element | null {
  const { t } = useTranslation();
  const detail = useHailReplayStore((s) => s.detail);
  const time = useHailReplayStore((s) => s.time);
  const playing = useHailReplayStore((s) => s.playing);
  const speed = useHailReplayStore((s) => s.speed);
  const setTime = useHailReplayStore((s) => s.setTime);
  const setPlaying = useHailReplayStore((s) => s.setPlaying);
  const setSpeed = useHailReplayStore((s) => s.setSpeed);
  const setDetail = useHailReplayStore((s) => s.setDetail);
  const impact = useHailEventImpact();

  const start = detail?.summary.start ?? 0;
  const end = detail?.summary.end ?? 0;
  // The clock runs a few minutes past the last step so it fades out.
  const stop = end + 5 * 60 * 1000;

  // Clock: advances the replay time on animation frames while playing.
  const timeRef = useRef(time);
  timeRef.current = time;
  useEffect(() => {
    if (!playing) return undefined;
    const msPerSecond =
      REPLAY_SPEEDS.find((s) => s.id === speed)?.msPerSecond ?? 360_000;
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
    const hits = (impact?.hits ?? []).filter((h) => h.firstAt <= time);
    return {
      count: hits.length,
      lossEur: hits.reduce((s, h) => s + h.lossEur, 0),
    };
  }, [impact, time]);

  if (!detail || !detail.summary.timed) return null;

  const atEnd = time >= stop;
  return (
    <div className="pointer-events-auto flex w-[min(40rem,100%)] flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 shadow-lg">
      <HintButton
        size="icon"
        variant="default"
        className="size-8 shrink-0"
        aria-label={
          playing
            ? t("hailReplay.pause")
            : atEnd
              ? t("hailReplay.restart")
              : t("hailReplay.play")
        }
        onClick={() => {
          if (atEnd) setTime(start);
          setPlaying(!playing);
        }}
      >
        {playing ? (
          <Pause className="size-4" />
        ) : atEnd ? (
          <RotateCcw className="size-4" />
        ) : (
          <Play className="size-4" />
        )}
      </HintButton>
      <div className="min-w-40 flex-1">
        <Slider
          aria-label={t("hailReplay.timeline")}
          min={start}
          max={stop}
          step={60_000}
          value={Math.min(stop, Math.max(start, time))}
          onValueChange={(v) => {
            setPlaying(false);
            setTime(v);
          }}
        />
        <div className="mt-1 flex justify-between gap-2 text-[11px] tabular-nums text-muted-foreground">
          <span className="font-medium text-foreground">
            {replayTimeLabel(Math.min(time, end))}
          </span>
          <span>
            {t("hailReplay.reachedSoFar", {
              count: sofar.count,
              loss: eurCompact(sofar.lossEur),
            })}
          </span>
        </div>
      </div>
      <Select value={speed} onValueChange={(v) => setSpeed(v as ReplaySpeed)}>
        <SelectTrigger
          className="h-8 w-24 shrink-0 bg-background px-2 text-xs"
          aria-label={t("hailReplay.speed")}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {REPLAY_SPEEDS.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {t(`hailReplay.speeds.${s.id}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="icon"
        variant="ghost"
        className="size-8 shrink-0"
        aria-label={t("hailReplay.close")}
        title={t("hailReplay.close")}
        onClick={() => setDetail(null)}
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}
