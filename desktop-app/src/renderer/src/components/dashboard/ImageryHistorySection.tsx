import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Car, History, Loader2, MapPin } from "lucide-react";
import type { AnalyzedDealership } from "@shared/types";
import { DETECTION_ZOOM } from "@shared/constants";
import type { ImageryCandidate } from "@shared/imagery-sources";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import { Skeleton } from "@renderer/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@renderer/components/ui/table";
import { formatImageryDate, formatMeters } from "@renderer/lib/imageryFormat";
import { useImageryTimeline } from "@renderer/lib/useImageryTimeline";
import { useAppStore } from "@renderer/store/appStore";
import { useMapStore } from "@renderer/store/mapStore";

/** Same image as the one the vehicle count was made on (Esri-based counts only). */
function isCountBasis(
  c: ImageryCandidate,
  basis: ImageryCandidate | undefined,
): boolean {
  if (!basis || (basis.kind !== "esri" && basis.kind !== "esri-wayback")) {
    return false;
  }
  return (
    c.capturedAt != null &&
    c.capturedAt === basis.capturedAt &&
    c.resolutionM === basis.resolutionM
  );
}

/**
 * Dated versions of the Esri satellite image at a location (Esri World
 * Imagery Wayback), with a jump to the map showing that version.
 */
export function ImageryHistorySection({
  d,
  onClose,
}: Readonly<{
  d: AnalyzedDealership;
  onClose: () => void;
}>): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const select = useAppStore((s) => s.select);
  const setBasemap = useMapStore((s) => s.setBasemap);
  const setPinnedWayback = useMapStore((s) => s.setPinnedWayback);
  const point = useMemo(
    () => ({ lat: d.lat, lon: d.lon, zoom: DETECTION_ZOOM }),
    [d.lat, d.lon],
  );
  const { timeline, loading } = useImageryTimeline(point, true);
  const basis = d.detection?.imagery?.chosen;
  const countVehicleTimeline = useAppStore((s) => s.countVehicleTimeline);
  const [counting, setCounting] = useState(false);
  const vehicleTimeline = d.detection?.timeline;
  const countByCandidate = new Map(
    (vehicleTimeline?.counts ?? []).map((c) => [c.candidateId, c.vehicleCount]),
  );
  // The area heuristic used without a model cannot tell images apart.
  const canCount =
    d.detection != null && d.detection.model !== "stub-area-heuristic";

  async function countOverTime(): Promise<void> {
    setCounting(true);
    try {
      await countVehicleTimeline(d.id);
    } catch (error) {
      toast.error(t("dashboard.detailDialog.imageryHistory.countFailed"), {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setCounting(false);
    }
  }

  function showOnMap(c: ImageryCandidate): void {
    if (!c.wayback) return;
    setPinnedWayback(c.wayback);
    setBasemap("satellite");
    select(d.id);
    onClose();
    navigate("/");
  }

  return (
    <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3 text-sm">
      <h4 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <History className="size-3.5" />
        {t("dashboard.detailDialog.imageryHistory.title")}
      </h4>
      {loading && !timeline ? (
        <div className="space-y-1.5">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-2/3" />
        </div>
      ) : !timeline || timeline.candidates.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("dashboard.detailDialog.imageryHistory.empty")}
        </p>
      ) : (
        <>
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                <TableHead>
                  {t("dashboard.detailDialog.imageryHistory.captured")}
                </TableHead>
                <TableHead>
                  {t("dashboard.detailDialog.imageryHistory.resolution")}
                </TableHead>
                <TableHead>
                  {t("dashboard.detailDialog.imageryHistory.source")}
                </TableHead>
                <TableHead>
                  {t("dashboard.detailDialog.imageryHistory.version")}
                </TableHead>
                {vehicleTimeline && (
                  <TableHead className="text-right">
                    {t("dashboard.detailDialog.imageryHistory.vehicles")}
                  </TableHead>
                )}
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {timeline.candidates.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="whitespace-nowrap font-medium">
                    {c.capturedAt
                      ? formatImageryDate(c.capturedAt, i18n.language)
                      : t("map.legend.imageryUnknown")}
                    {isCountBasis(c, basis) && (
                      <Badge variant="outline" className="ml-1.5">
                        {t("dashboard.detailDialog.imageryHistory.countBasis")}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {c.resolutionM != null
                      ? formatMeters(c.resolutionM, i18n.language)
                      : "–"}
                  </TableCell>
                  <TableCell className="max-w-40 truncate">
                    {[c.esri?.collection, c.esri?.source]
                      .filter(Boolean)
                      .join(" · ") || "–"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {c.wayback
                      ? formatImageryDate(c.wayback.publishedAt, i18n.language)
                      : "–"}
                  </TableCell>
                  {vehicleTimeline && (
                    <TableCell className="text-right font-mono">
                      {countByCandidate.get(c.id) ?? "–"}
                    </TableCell>
                  )}
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-2 text-xs"
                      onClick={() => showOnMap(c)}
                      title={t("ui.showOnMap")}
                    >
                      <MapPin className="size-3.5" />
                      {t("dashboard.detailDialog.imageryHistory.showOnMap")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {vehicleTimeline && (
            <p className="text-xs">
              {t("dashboard.detailDialog.imageryHistory.countSummary", {
                count: vehicleTimeline.counts.length,
                median: vehicleTimeline.median,
                min: vehicleTimeline.min,
                max: vehicleTimeline.max,
              })}
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1 text-xs"
              disabled={!canCount || counting}
              onClick={() => void countOverTime()}
            >
              {counting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Car className="size-3.5" />
              )}
              {counting
                ? t("dashboard.detailDialog.imageryHistory.counting")
                : t("dashboard.detailDialog.imageryHistory.countButton")}
            </Button>
            {!canCount && (
              <span className="text-[11px] text-muted-foreground">
                {t("dashboard.detailDialog.imageryHistory.countNeedsModel")}
              </span>
            )}
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">
            {t("dashboard.detailDialog.imageryHistory.hint", {
              zoom: timeline.zoom,
            })}
            {timeline.truncated &&
              ` ${t("dashboard.detailDialog.imageryHistory.truncated")}`}
          </p>
        </>
      )}
    </div>
  );
}
