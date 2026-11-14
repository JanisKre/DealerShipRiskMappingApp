import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { History, Loader2, Square } from "lucide-react";
import type { AnalyzedDealership } from "@shared/types";
import {
  buildChangeReport,
  changeReportCounts,
  changeReportFacts,
  type ChangeLookup,
  type LocationChange,
} from "@shared/change-report";
import { AiExplanation } from "@renderer/components/ai/AiExplanation";
import { Button } from "@renderer/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@renderer/components/ui/card";
import { Progress } from "@renderer/components/ui/progress";
import { useAppStore } from "@renderer/store/appStore";
import { isReviewCurrent, reviewReasons } from "./reviewQueue";
import { TileInfo } from "./TileInfo";

/** Lookups running at once; each is a local archive read plus a few metadata requests. */
const CONCURRENCY = 4;
/** Zoom of the imagery lookup: the vehicle-detection zoom. */
const IMAGERY_ZOOM = 19;
const INITIAL_ROWS = 8;

interface ReportState {
  rows: LocationChange[];
  checked: number;
  failed: number;
  finishedAt: string;
}

/**
 * "What changed since the last analysis?" on request: newer aerial imagery
 * sharp enough for vehicle detection, radar hail within 1 km after the
 * analysis, and open review points. Works without AI; with an AI provider
 * the finished table can be summarised in a few sentences.
 */
export function ChangeReportPanel({
  dealerships,
  onSelect,
}: Readonly<{
  dealerships: AnalyzedDealership[];
  onSelect: (d: AnalyzedDealership) => void;
}>): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const parameters = useAppStore((s) => s.parameters);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [report, setReport] = useState<ReportState | null>(null);
  const [showAll, setShowAll] = useState(false);
  const cancelled = useRef(false);
  const byId = useMemo(
    () => new Map(dealerships.map((d) => [d.id, d])),
    [dealerships],
  );

  // A report describes one portfolio: another one starts without it, and
  // leaving the page stops a running check.
  const sessionId = useAppStore((s) => s.sessionId);
  useEffect(() => {
    setReport(null);
    return () => {
      cancelled.current = true;
    };
  }, [sessionId]);

  async function run(): Promise<void> {
    const sites = dealerships.filter(
      (d) => d.risk != null && d.lat != null && d.lon != null,
    );
    cancelled.current = false;
    setRunning(true);
    setShowAll(false);
    setProgress({ done: 0, total: sites.length });
    const lookups: ChangeLookup[] = [];
    let failed = 0;
    let next = 0;
    let done = 0;
    async function worker(): Promise<void> {
      while (!cancelled.current && next < sites.length) {
        const d = sites[next++];
        const lat = d.lat as number;
        const lon = d.lon as number;
        const [imagery, radar] = await Promise.all([
          window.api.selectImagery(lat, lon, IMAGERY_ZOOM).catch(() => null),
          window.api.radarHail(lat, lon).catch(() => null),
        ]);
        if (!imagery && !radar) failed++;
        lookups.push({
          dealership: d,
          imagery,
          radar,
          openReviewPoints: isReviewCurrent(d)
            ? 0
            : reviewReasons(t, d, dealerships, parameters).length,
        });
        done++;
        setProgress({ done, total: sites.length });
      }
    }
    try {
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, sites.length) }, worker),
      );
      if (!cancelled.current) {
        setReport({
          rows: buildChangeReport(lookups),
          checked: lookups.length,
          failed,
          finishedAt: new Date().toISOString(),
        });
      }
    } finally {
      setRunning(false);
    }
  }

  const counts = report ? changeReportCounts(report.rows) : null;
  const facts = useMemo(
    () =>
      report && report.rows.length > 0
        ? changeReportFacts(report.rows, report.checked)
        : null,
    [report],
  );
  const visible = report
    ? showAll
      ? report.rows
      : report.rows.slice(0, INITIAL_ROWS)
    : [];
  const date = (iso: string): string =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(i18n.language);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-base">
          <History className="size-4 text-primary" />
          {t("changeReport.title")}
          <TileInfo topic="changes" label={t("changeReport.title")} />
        </CardTitle>
        <CardDescription>
          {counts && report
            ? t("changeReport.summary", {
                count: counts.locations,
                checked: report.checked,
                hail: counts.radarHail,
                imagery: counts.newerImagery,
                review: counts.openReview,
              })
            : t("changeReport.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={running}
            onClick={() => void run()}
          >
            {running ? <Loader2 className="animate-spin" /> : <History />}
            {report ? t("changeReport.rerun") : t("changeReport.run")}
          </Button>
          {running && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                cancelled.current = true;
              }}
            >
              <Square /> {t("changeReport.cancel")}
            </Button>
          )}
        </div>
        {running && (
          <div className="space-y-1">
            <Progress
              value={
                progress.total ? (progress.done / progress.total) * 100 : 0
              }
            />
            <p className="text-xs text-muted-foreground">
              {t("changeReport.progress", progress)}
            </p>
          </div>
        )}
        {report && !running && (
          <>
            {report.failed > 0 && (
              <p className="text-xs text-warning-foreground">
                {t("changeReport.failed", { count: report.failed })}
              </p>
            )}
            {report.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("changeReport.none")}
              </p>
            ) : (
              <ul className="space-y-1">
                {visible.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                      onClick={() => {
                        const d = byId.get(row.id);
                        if (d) onSelect(d);
                      }}
                    >
                      <span className="font-medium">{row.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {[
                          row.hailDays.length > 0 &&
                            t("changeReport.hail", {
                              dates: row.hailDays
                                .map(
                                  (h) =>
                                    `${date(h.date)} (${t(`radarHail.class.${h.hailClass}`)})`,
                                )
                                .join(", "),
                            }),
                          row.newerImagery &&
                            t("changeReport.imagery", {
                              source: row.newerImagery.label,
                              date: date(row.newerImagery.capturedAt),
                              previous: date(
                                row.newerImagery.previousCapturedAt,
                              ),
                            }),
                          row.openReviewPoints > 0 &&
                            t("changeReport.review", {
                              count: row.openReviewPoints,
                            }),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {report.rows.length > INITIAL_ROWS && (
              <div className="flex justify-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAll((value) => !value)}
                >
                  {showAll
                    ? t("dashboard.showLess")
                    : t("dashboard.showAll", { count: report.rows.length })}
                </Button>
              </div>
            )}
            <AiExplanation
              topic="changes"
              facts={facts}
              label={t("changeReport.explain")}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
