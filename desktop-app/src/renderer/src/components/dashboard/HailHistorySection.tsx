import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CloudHail, Loader2, RefreshCw } from "lucide-react";
import type { AnalyzedDealership, HailHistory } from "@shared/types";
import { Button } from "@renderer/components/ui/button";
import { TileInfo } from "./TileInfo";
import { num } from "@renderer/lib/format";
import { newerStation } from "./hailHistoryView";

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

/**
 * Observed hail days near a location, as one line: the station, how far it
 * is, the years it covers and its mean hail days per year. Of the stations
 * nearby the one whose record ends latest is shown, since a record that
 * stopped a century ago says little. The ⓘ explains the data source.
 * Context only — never part of the EAL.
 */
export function HailHistorySection({
  d,
}: Readonly<{ d: AnalyzedDealership }>): React.JSX.Element {
  const { t } = useTranslation();
  const { history, loading, error, retry } = useHailHistory(d.lat, d.lon);
  const stations = history?.stations ?? [];
  const station = stations[0]
    ? (newerStation(stations, stations[0]) ?? stations[0])
    : null;
  const radius = history?.searchRadiusKm ?? 30;

  return (
    <section
      className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
      aria-label={t("hailHistory.title")}
    >
      <CloudHail className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="shrink-0 font-medium">{t("hailHistory.title")}</span>
      <span className="ml-auto flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        {loading ? (
          <>
            <Loader2 className="size-3 animate-spin" />
            {t("hailHistory.summaryLoading")}
          </>
        ) : error ? (
          <>
            <span className="truncate">{t("hailHistory.failed")}</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 gap-1 px-2 text-xs"
              onClick={retry}
            >
              <RefreshCw className="size-3" />
              {t("hailHistory.retry")}
            </Button>
          </>
        ) : station ? (
          <span className="truncate">
            {t("hailHistory.summary", {
              station: station.name,
              distance: num(station.distanceKm, 1),
              from: station.firstYear,
              to: station.lastYear,
              days: num(station.hailDaysPerYear, 1),
            })}
          </span>
        ) : (
          <span className="truncate">{t("hailHistory.none", { radius })}</span>
        )}
      </span>
      <TileInfo label={t("hailHistory.about.title")}>
        <p className="font-medium">{t("hailHistory.about.title")}</p>
        <p>{t("hailHistory.about.what", { radius })}</p>
        <p>{t("hailHistory.about.hailDay")}</p>
        <p className="text-muted-foreground">{t("hailHistory.about.limits")}</p>
        <p className="text-muted-foreground">{t("hailHistory.about.eal")}</p>
        <p className="text-muted-foreground">{t("hailHistory.about.source")}</p>
      </TileInfo>
    </section>
  );
}
