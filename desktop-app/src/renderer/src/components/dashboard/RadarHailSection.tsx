import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Radar, RefreshCw } from "lucide-react";
import type { AnalyzedDealership } from "@shared/types";
import type { RadarHailResult } from "@shared/radar-hail";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import { num } from "@renderer/lib/format";

/** Re-reads the archive while a background sync fills it. */
const SYNC_POLL_MS = 15_000;

/**
 * Days on which a DWD radar hail cell (KONRAD3D) passed over the location,
 * from the app's local archive. DWD keeps only 48 hours, so the list starts
 * with the first use of the app. Context only — never part of the EAL.
 */
export function RadarHailSection({
  d,
}: Readonly<{ d: AnalyzedDealership }>): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const [result, setResult] = useState<RadarHailResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setFailed(false);
    try {
      setResult(await window.api.radarHail(d.lat, d.lon));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [d.lat, d.lon]);

  useEffect(() => {
    setResult(null);
    void load();
  }, [load]);

  // The first sync fetches 48 hours of files; show them as they arrive.
  useEffect(() => {
    if (!result?.syncing) return;
    const timer = setTimeout(() => void load(), SYNC_POLL_MS);
    return () => clearTimeout(timer);
  }, [result, load]);

  const locale = i18n.language;
  const time = (iso: string): string =>
    new Date(iso).toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
    });
  const day = (iso: string): string =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, {
      timeZone: "UTC",
    });

  return (
    <section className="space-y-2 text-sm" aria-labelledby="radar-hail-title">
      <div className="flex items-center gap-1.5">
        <Radar className="size-4 text-muted-foreground" />
        <h4 id="radar-hail-title" className="font-semibold">
          {t("radarHail.title")}
        </h4>
        {result?.syncing && (
          <Loader2
            className="size-3.5 animate-spin text-muted-foreground"
            aria-label={t("radarHail.syncing")}
          />
        )}
      </div>
      {loading && !result ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          {t("radarHail.loading")}
        </p>
      ) : failed || !result ? (
        <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1">{t("radarHail.failed")}</span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 gap-1 px-2 text-xs"
            onClick={() => void load()}
          >
            <RefreshCw className="size-3" />
            {t("hailHistory.retry")}
          </Button>
        </div>
      ) : (
        <>
          {result.days.length === 0 ? (
            <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
              {result.archiveFrom
                ? t("radarHail.none", {
                    from: new Date(result.archiveFrom).toLocaleDateString(
                      locale,
                    ),
                    radius: num(result.radiusKm),
                  })
                : t("radarHail.empty")}
            </p>
          ) : (
            <ul className="divide-y rounded-md border text-xs">
              {result.days.map((x) => (
                <li
                  key={x.date}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5"
                >
                  <span className="font-medium tabular-nums">
                    {day(x.date)}
                  </span>
                  <Badge
                    variant={x.hailClass === "mixed" ? "outline" : "secondary"}
                  >
                    {t(`radarHail.class.${x.hailClass}`)}
                  </Badge>
                  <span className="tabular-nums text-muted-foreground">
                    {time(x.firstAt)}–{time(x.lastAt)} ·{" "}
                    {x.distanceKm === 0
                      ? t("radarHail.overSite")
                      : t("radarHail.distance", {
                          km: num(x.distanceKm, 1),
                        })}{" "}
                    · {num(x.maxDbz, 0)} dBZ
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            {result.archiveFrom
              ? t("radarHail.archive", {
                  from: new Date(result.archiveFrom).toLocaleDateString(locale),
                  to: new Date(result.archiveTo!).toLocaleDateString(locale),
                })
              : null}{" "}
            {!result.synced && !result.syncing && t("radarHail.offline")}{" "}
            {t("radarHail.note")}
          </p>
        </>
      )}
    </section>
  );
}
