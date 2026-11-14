import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import i18next, { type TFunction } from "i18next";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  FileText,
  Globe,
  Loader2,
  Mail,
  MapPin,
  MoreHorizontal,
  Pencil,
  Phone,
  RefreshCw,
  RotateCcw,
  StickyNote,
  Tag,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import area from "@turf/area";
import type {
  AnalyzedDealership,
  BoundaryCandidate,
  DealershipChange,
  BoundaryResult,
  EalBreakdown,
  HailRiskTier,
  OsmDetails,
  RiskParameters,
  StructuredMemo,
} from "@shared/types";
import { asPolygon, outerRings } from "@shared/boundary-geometry-utils";
import { boundaryReviewReasons } from "@shared/boundary-review";
import { DEALERSHIP_NOTES_MAX_LENGTH } from "@shared/constants";
import {
  isUserWebsiteSource,
  WEBSITE_URL_MAX_LENGTH,
  websiteLabel,
} from "@shared/website";
import { sourceLabel } from "@shared/natcat-catalog";
import { boundarySourceLabel } from "@renderer/lib/boundarySource";
import { LlmErrorMessage } from "@renderer/components/ai/LlmSetupNotice";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import { HintButton } from "@renderer/components/ui/hint-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { Input } from "@renderer/components/ui/input";
import { Label } from "@renderer/components/ui/label";
import { Separator } from "@renderer/components/ui/separator";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@renderer/components/ui/toggle-group";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@renderer/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu";
import { useMapStore } from "@renderer/store/mapStore";
import { DeleteSelectedDialog } from "@renderer/components/map/LocationsPanel";
import {
  IMAGERY_STALE_AFTER_YEARS,
  imageryAgeYears,
} from "@shared/imagery-metadata";
import { Textarea } from "@renderer/components/ui/textarea";
import { useAppStore } from "@renderer/store/appStore";
import { eur, num, pct } from "@renderer/lib/format";
import { HailZoneBadge } from "./HailZoneBadge";
import {
  dealershipHailZone,
  displayedHailVehicleSource,
  effectiveVehicleCount,
  estimateHailZoneFromScore,
  isAreaEstimatedDetection,
} from "@shared/risk-math";
import { buildUnderwritingMessages } from "./UnderwritingMessages";
import { DetectionImageryNote } from "./DetectionImageryNote";
import { ImageryHistorySection } from "./ImageryHistorySection";
import { HailHistorySection } from "./HailHistorySection";
import {
  isReviewCurrent,
  nextInReview,
  reviewReasons,
  type ReviewReason,
} from "./reviewQueue";
import { RadarHailSection } from "./RadarHailSection";

/** A review run: the queue snapshot taken when it started. */
export interface ReviewRun {
  ids: string[];
  /** Called after the last open location; the page closes the dialog. */
  onFinish: () => void;
  /**
   * Pauses the run while the boundary of `id` is corrected on the map; the
   * map offers to come back, and the run resumes at that location.
   */
  onPause?: (id: string) => void;
}

/** Locale keys for the stored (English) hail risk tier values. */
const RISK_TIER_KEYS: Record<HailRiskTier, string> = {
  "Very Low": "veryLow",
  Low: "low",
  Moderate: "moderate",
  High: "high",
  "Very High": "veryHigh",
};

/**
 * Detail dialog for a location, built for progressive disclosure:
 *
 *  1. Always visible, kept short: name, zone and business badges (plus a
 *     "check boundary" badge only when needed), the address with the main
 *     actions, three key figures (hail EAL, vehicles, exposure) and the
 *     notices that ask for an action, one line each.
 *  2. Tabs named after tasks: risk (EAL derivation, memo), site & vehicles
 *     (boundary, vehicle count, imagery), contract & notes, sources.
 *  3. Disclosures inside the tabs for expert detail (image history, boundary
 *     internals, model limitations).
 *
 * `onNavigate` adds previous/next arrows to step through the portfolio.
 */
export function DealershipDetailDialog({
  dealership,
  open,
  onOpenChange,
  onNavigate,
  order,
  review,
}: {
  dealership: AnalyzedDealership | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate?: (id: string) => void;
  /** Ids in the order the arrows step through (e.g. the sorted table). */
  order?: string[];
  /** Review run in progress: adds the "reviewed · next" strip. */
  review?: ReviewRun;
}): React.JSX.Element {
  const contentRef = useRef<HTMLDivElement>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={contentRef}
        // Fixed height: switching tabs doesn't resize the dialog. Only the
        // body scrolls; name, actions and close stay at the top.
        className="flex h-[85vh] max-h-[85vh] max-w-2xl flex-col gap-0 overflow-hidden p-0"
        // Focus the title, not the first control (the "previous" arrow,
        // which would read as a highlighted button): screen readers start
        // at the name and Tab continues from there.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          contentRef.current
            ?.querySelector<HTMLElement>("[data-dialog-autofocus]")
            ?.focus();
        }}
      >
        {dealership && (
          <DetailBody
            d={dealership}
            onClose={() => onOpenChange(false)}
            onNavigate={onNavigate}
            order={order}
            review={review}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

type DetailTab = "overview" | "site" | "contract" | "sources";

interface Attention {
  key: string;
  tone: "warning" | "danger";
  title: string;
  detail?: string;
  action?: { label: string; run: () => void };
}

function DetailBody({
  d,
  onClose,
  onNavigate,
  order,
  review,
}: {
  d: AnalyzedDealership;
  onClose: () => void;
  onNavigate?: (id: string) => void;
  order?: string[];
  review?: ReviewRun;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const dealerships = useAppStore((s) => s.dealerships);
  const parameters = useAppStore((s) => s.parameters);
  const reanalyze = useAppStore((s) => s.reanalyzeDealership);
  const [exporting, setExporting] = useState(false);
  const select = useAppStore((s) => s.select);
  const removeDealership = useAppStore((s) => s.removeDealership);
  const [tab, setTab] = useState<DetailTab>("overview");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const zoneInfo = dealershipHailZone(d);
  const hailZone = zoneInfo?.zone;
  const { details: osmDetails, loading: osmLoading } = useOsmDetails(
    d.lat,
    d.lon,
    d.name,
    d.address,
  );

  const locatedIds = dealerships
    .filter((x) => x.lat != null && x.lon != null)
    .map((x) => x.id);
  // The caller's order (the sorted, filtered table) when this site is in it.
  const located =
    order && order.includes(d.id)
      ? order.filter((id) => locatedIds.includes(id))
      : locatedIds;
  const position = located.indexOf(d.id);
  const inReview = review != null && review.ids.includes(d.id);
  const step = (delta: number): void => {
    if (!onNavigate) return;
    // In a review run the arrows move through the queue, not the portfolio.
    const ring = inReview && review ? review.ids : located;
    if (ring.length < 2) return;
    const index = ring.indexOf(d.id);
    onNavigate(ring[(index + delta + ring.length) % ring.length]);
  };
  const stepRef = useRef(step);
  stepRef.current = step;

  // ←/→ step through the locations (or the review queue). Ignored while
  // typing, so notes and inputs keep their arrow keys.
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      stepRef.current(event.key === "ArrowRight" ? 1 : -1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function showOnMap(editBoundary = false): void {
    select(d.id);
    if (editBoundary) {
      useMapStore.getState().setLayers({ boundaries: true });
      useMapStore.getState().setEditing(true);
    }
    onClose();
    navigate("/");
  }

  const attention = buildAttention(
    t,
    d,
    dealerships,
    parameters,
    () => setTab("site"),
    () => {
      onClose();
      navigate("/settings?section=data");
    },
  );
  async function exportReport(): Promise<void> {
    setExporting(true);
    try {
      const language = i18n.language.slice(0, 2);
      const { path } = await window.api.exportLocationReport({
        dealership: d,
        locale: language === "de" || language === "fr" ? language : "en",
        reviewNotes: attention
          .map((item) => item.title.slice(0, 300))
          .slice(0, 12),
      });
      if (path)
        toast.success(t("dashboard.detailDialog.reportSaved", { path }));
    } catch (err) {
      toast.error(
        t("dashboard.detailDialog.reportFailed", {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      setExporting(false);
    }
  }
  const vehicles = d.detection ? effectiveVehicleCount(d.detection) : null;
  const vehicleSource = displayedHailVehicleSource(
    d.risk?.ealBreakdown?.hailDetail?.vehicleSource,
    d.detection,
  );
  const rank = portfolioRank(d, dealerships);
  const boundary = d.boundary;
  return (
    <>
      <DialogHeader className="shrink-0 space-y-1 border-b px-6 pt-6 pb-3">
        <div className="flex items-start gap-2 pr-8">
          <DialogTitle
            data-dialog-autofocus
            tabIndex={-1}
            className="flex min-w-0 flex-1 flex-wrap items-center gap-2 rounded-sm focus:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <span className="min-w-0 break-words">{d.name}</span>
            {hailZone != null ? (
              <HailZoneBadge
                zone={hailZone}
                estimated={zoneInfo?.source === "estimated"}
              />
            ) : (
              <Badge variant="outline">—</Badge>
            )}
            <Badge variant="outline" className="font-normal">
              {d.insured
                ? t("dashboard.detailDialog.businessExisting")
                : t("dashboard.detailDialog.businessNew")}
            </Badge>
            {boundary?.reviewRequired && (
              <button
                type="button"
                className="rounded-md focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                onClick={() => setTab("site")}
              >
                <Badge variant="warning" className="font-normal">
                  {t("dashboard.detailDialog.boundaryReviewBadge")}
                </Badge>
              </button>
            )}
          </DialogTitle>
          {onNavigate && located.length > 1 && !inReview && (
            <div className="flex shrink-0 items-center gap-0.5">
              <HintButton
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => step(-1)}
                aria-label={t("dashboard.detailDialog.previousLocation")}
              >
                <ChevronLeft className="size-4" />
              </HintButton>
              <span className="text-xs tabular-nums text-muted-foreground">
                {position + 1}/{located.length}
              </span>
              <HintButton
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => step(1)}
                aria-label={t("dashboard.detailDialog.nextLocation")}
              >
                <ChevronRight className="size-4" />
              </HintButton>
            </div>
          )}
        </div>
        {/* Address and the main actions share one row; the image date and
            model version live in "Gelände & Fahrzeuge" and "Quellen". */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <DialogDescription className="min-w-0 flex-1">
            {addressLine(d)}
          </DialogDescription>
          <div className="flex shrink-0 items-center">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => showOnMap()}
            >
              <MapPin className="size-3.5" />
              {t("dashboard.detailDialog.showOnMapShort")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => void reanalyze(d.id)}
            >
              <RefreshCw className="size-3.5" />
              {t("map.page.reanalyze")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2 text-xs"
              disabled={exporting}
              onClick={() => void exportReport()}
            >
              {exporting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <FileText className="size-3.5" />
              )}
              {t("dashboard.detailDialog.report")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <HintButton
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2"
                  aria-label={t("dashboard.detailDialog.moreActions")}
                >
                  <MoreHorizontal className="size-4" />
                </HintButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <a href={googleMapsUrl(d)} target="_blank" rel="noreferrer">
                    <MapPin className="size-3.5" />
                    Google Maps
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a
                    href={openStreetMapUrl(d.lat, d.lon)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink className="size-3.5" />
                    OpenStreetMap
                  </a>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => setConfirmDelete(true)}
                >
                  <Trash2 className="size-3.5" />
                  {t("map.page.delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </DialogHeader>

      {review && inReview && onNavigate && (
        <div className="shrink-0 px-6 pt-3">
          <ReviewStrip
            d={d}
            run={review}
            onNavigate={onNavigate}
            onSkip={() => step(1)}
            onCorrectBoundary={
              review.onPause
                ? () => {
                    review.onPause?.(d.id);
                    showOnMap(true);
                  }
                : undefined
            }
          />
        </div>
      )}

      {/* The only scrolling part; the tab bar sticks to its top. */}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pt-4 pb-6">
        <div className="grid grid-cols-3 gap-2">
          <KeyFigure
            label={t("dashboard.detailDialog.kpiHailEal")}
            value={eur(d.risk?.eal)}
            hint={
              rank != null
                ? t("dashboard.detailDialog.kpiRank", rank)
                : undefined
            }
          />
          <KeyFigure
            label={t("common.vehicles")}
            value={num(vehicles ?? undefined)}
            hint={
              vehicleSource === "manual"
                ? t("dashboard.detailDialog.kpiVehiclesManual")
                : vehicleSource === "estimated"
                  ? t("dashboard.detailDialog.kpiVehiclesEstimated")
                  : t("dashboard.detailDialog.kpiVehiclesDetected")
            }
          />
          <KeyFigure
            label={t("dashboard.detailDialog.exposureLabel")}
            value={eur(d.risk?.exposureEur)}
            hint={`${num(boundary?.areaSqm)} m²`}
          />
        </div>

        {attention.length > 0 && (
          <div className="space-y-1">
            {attention.map((item) => (
              <AttentionRow key={item.key} item={item} />
            ))}
          </div>
        )}

        <Tabs value={tab} onValueChange={(v) => setTab(v as DetailTab)}>
          <TabsList className="sticky top-0 z-10 grid w-full grid-cols-4 shadow-[0_-1rem_0_0_var(--background)]">
            <TabsTrigger value="overview">
              {t("dashboard.detailDialog.tabOverview")}
            </TabsTrigger>
            <TabsTrigger value="site">
              {t("dashboard.detailDialog.tabSite")}
            </TabsTrigger>
            <TabsTrigger value="contract">
              {t("dashboard.detailDialog.tabContract")}
            </TabsTrigger>
            <TabsTrigger value="sources">
              {t("dashboard.detailDialog.tabSources")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4 pt-2">
            <HailOverview d={d} />
            <Separator />
            <HailHistorySection d={d} />
            <RadarHailSection d={d} />
            <Separator />
            <AiSection d={d} />
          </TabsContent>

          <TabsContent value="site" className="space-y-4 pt-2">
            <BoundaryPanel d={d} onEditOnMap={() => showOnMap(true)} />
            <Separator />
            <VehiclePanel d={d} />
            <DetectionImageryNote detection={d.detection} />
            <details className="rounded-md border text-sm">
              <summary className="px-3 py-2 font-medium text-muted-foreground">
                {t("dashboard.detailDialog.imageryHistoryToggle")}
              </summary>
              <div className="border-t p-3">
                <ImageryHistorySection d={d} onClose={onClose} />
              </div>
            </details>
          </TabsContent>

          <TabsContent value="contract" className="space-y-4 pt-2">
            <NotesSection d={d} />
            <PortfolioMetaSection d={d} />
            <WebsiteRow
              d={d}
              detectedWebsite={osmDetails?.website}
              detecting={osmLoading}
            />
            <OsmDetailsSection details={osmDetails} loading={false} />
          </TabsContent>

          <TabsContent value="sources" className="space-y-4 pt-2">
            <ModelConfidenceSummary d={d} />
            <NatCatSection d={d} />
            <Separator />
            <HistorySection d={d} />
          </TabsContent>
        </Tabs>
      </div>

      <DeleteSelectedDialog
        open={confirmDelete}
        count={1}
        name={d.name}
        onOpenChange={setConfirmDelete}
        onConfirm={() => {
          setConfirmDelete(false);
          onClose();
          removeDealership(d.id);
        }}
      />
    </>
  );
}

/** One line of the change history, in the user's language. */
function changeText(t: TFunction, change: DealershipChange): string {
  const boundary = change.value
    ? candidateLabel(t, { provider: change.value, source: change.value })
    : undefined;
  const parts: string[] = [];
  switch (change.kind) {
    case "analyzed":
      parts.push(t("dashboard.detailDialog.history.analyzed"));
      if (boundary) parts.push(boundary);
      if (change.area != null) parts.push(`${num(change.area)} m²`);
      if (change.to != null)
        parts.push(
          t("dashboard.detailDialog.history.vehicles", { count: change.to }),
        );
      return parts.join(" · ");
    case "boundaryConfirmed":
      return [
        t("dashboard.detailDialog.history.boundaryConfirmed"),
        boundary,
        change.area != null ? `${num(change.area)} m²` : undefined,
      ]
        .filter(Boolean)
        .join(" · ");
    case "boundaryChanged":
      return [
        t("dashboard.detailDialog.history.boundaryChanged"),
        boundary,
        change.area != null ? `${num(change.area)} m²` : undefined,
        change.to != null
          ? t("dashboard.detailDialog.history.vehicles", { count: change.to })
          : undefined,
      ]
        .filter(Boolean)
        .join(" · ");
    case "vehicleCountChanged":
      return change.to != null
        ? t("dashboard.detailDialog.history.vehicleCountSet", {
            from: change.from ?? "—",
            to: change.to,
          })
        : t("dashboard.detailDialog.history.vehicleCountCleared", {
            from: change.from ?? "—",
          });
    case "vehiclesReviewed":
      return t("dashboard.detailDialog.history.vehiclesReviewed", {
        from: change.from ?? "—",
        to: change.to ?? "—",
      });
    case "businessTypeChanged":
      return change.value === "existing"
        ? t("dashboard.detailDialog.history.markedExisting")
        : t("dashboard.detailDialog.history.markedNew");
    case "reviewed":
      return t("dashboard.detailDialog.history.reviewed");
  }
}

/** Inputs, text areas and editable fields keep their own keys. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
}

/**
 * Review run: where the underwriter stands in the queue, why this location
 * is in it, and one action that records the check and moves on. When the
 * boundary is the open point, that action confirms it as well. Enter
 * triggers it unless focus is on another control.
 */
function ReviewStrip({
  d,
  run,
  onNavigate,
  onSkip,
  onCorrectBoundary,
}: Readonly<{
  d: AnalyzedDealership;
  run: ReviewRun;
  onNavigate: (id: string) => void;
  onSkip: () => void;
  /** Leaves for the map editor; the run waits there. */
  onCorrectBoundary?: () => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const dealerships = useAppStore((s) => s.dealerships);
  const parameters = useAppStore((s) => s.parameters);
  const markReviewed = useAppStore((s) => s.markReviewed);
  const confirmBoundary = useAppStore((s) => s.confirmBoundary);
  const [busy, setBusy] = useState(false);
  const reasons = reviewReasons(t, d, dealerships, parameters);
  const byId = new Map(dealerships.map((x) => [x.id, x]));
  const open = (id: string): boolean => {
    const x = byId.get(id);
    return x != null && !isReviewCurrent(x);
  };
  const remaining = run.ids.filter(open).length;
  const done = isReviewCurrent(d);
  const confirmsBoundary = reasons.includes("boundary");

  async function complete(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      if (!done) {
        if (confirmsBoundary) await confirmBoundary(d.id);
        await markReviewed(d.id);
      }
      const latest = new Map(
        useAppStore.getState().dealerships.map((x) => [x.id, x]),
      );
      const next = nextInReview(run.ids, d.id, (id) => {
        const x = latest.get(id);
        return x != null && !isReviewCurrent(x);
      });
      if (next) onNavigate(next);
      else run.onFinish();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  const completeRef = useRef(complete);
  completeRef.current = complete;

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key !== "Enter" || event.repeat) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
        return;
      const target = event.target;
      if (
        isTypingTarget(target) ||
        (target instanceof HTMLElement &&
          target.closest("button, a, [role=menuitem], [role=tab]"))
      )
        return;
      event.preventDefault();
      void completeRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <div className="font-medium">
          {t("review.position", {
            position: run.ids.indexOf(d.id) + 1,
            total: run.ids.length,
          })}
          <span className="font-normal text-muted-foreground">
            {" · "}
            {t("review.remaining", { count: remaining })}
          </span>
        </div>
        <div className="text-xs text-muted-foreground">
          {done
            ? t("review.alreadyReviewed")
            : reasons
                .map((r: ReviewReason) => t(`review.reason.${r}`))
                .join(" · ")}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={onSkip}
        >
          {t("review.skip")}
        </Button>
        {confirmsBoundary && !done && onCorrectBoundary && d.boundary && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={onCorrectBoundary}
          >
            <Pencil className="size-3.5" />
            {t("review.correctBoundary")}
          </Button>
        )}
        <Button
          size="sm"
          className="h-7 gap-1.5 px-2.5 text-xs"
          disabled={busy}
          onClick={() => void complete()}
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Check className="size-3.5" />
          )}
          {done
            ? t("review.next")
            : confirmsBoundary
              ? t("review.confirmBoundaryAndNext")
              : t("review.reviewedAndNext")}
          <kbd className="rounded border border-primary-foreground/40 px-1 text-[10px] leading-4">
            ↵
          </kbd>
        </Button>
      </div>
    </div>
  );
}

/** What was changed at this location, newest first. */
function HistorySection({ d }: { d: AnalyzedDealership }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const entries = [...(d.history ?? [])].reverse();
  return (
    <div className="space-y-2 text-sm">
      <h4 className="font-semibold">
        {t("dashboard.detailDialog.history.title")}
      </h4>
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("dashboard.detailDialog.history.empty")}
        </p>
      ) : (
        <ol className="space-y-1.5 text-xs">
          {entries.map((change, index) => (
            <li key={`${change.at}-${index}`} className="flex gap-3">
              <time
                dateTime={change.at}
                className="w-28 shrink-0 tabular-nums text-muted-foreground"
              >
                {new Date(change.at).toLocaleString(i18n.language, {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </time>
              <span className="min-w-0">{changeText(t, change)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** One of the four numbers in the dialog header. */
/** Address without a leading copy of the name ("Autohaus X, 01219 …"). */
function addressLine(d: AnalyzedDealership): string {
  const address = d.address ?? `${d.lat.toFixed(4)}, ${d.lon.toFixed(4)}`;
  const prefix = `${d.name}, `;
  return address.startsWith(prefix) ? address.slice(prefix.length) : address;
}

/**
 * One notice as a single line: what is wrong and what to do. The longer
 * explanation opens on demand instead of filling the dialog by default.
 */
function AttentionRow({
  item,
}: Readonly<{ item: Attention }>): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const danger = item.tone === "danger";
  return (
    <div
      className={`rounded-md border-l-4 bg-muted/30 px-2.5 py-1.5 text-sm ${
        danger ? "border-l-destructive" : "border-l-warning"
      }`}
    >
      <div className="flex items-center gap-2">
        <TriangleAlert
          className={`size-3.5 shrink-0 ${
            danger ? "text-destructive" : "text-warning-foreground"
          }`}
        />
        <span className="min-w-0 flex-1 truncate font-medium">
          {item.title}
        </span>
        {item.detail && (
          <Button
            variant="link"
            size="sm"
            className="h-6 shrink-0 gap-0.5 px-0 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            {t("dashboard.detailDialog.attentionWhy")}
            {open ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
          </Button>
        )}
        {item.action && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 shrink-0 px-2 text-xs"
            onClick={item.action.run}
          >
            {item.action.label}
          </Button>
        )}
      </div>
      {open && item.detail && (
        <p className="mt-1 pl-5.5 text-xs text-muted-foreground">
          {item.detail}
        </p>
      )}
    </div>
  );
}

function KeyFigure({
  label,
  value,
  hint,
  tone,
}: Readonly<{
  label: string;
  value: string;
  hint?: string;
  tone?: "warning";
}>): React.JSX.Element {
  return (
    <div
      className={`rounded-lg border px-2.5 py-2 ${
        tone === "warning" ? "border-warning/40 bg-warning/10" : ""
      }`}
    >
      <div className="truncate text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-base font-semibold">{value}</div>
      {hint && (
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {hint}
        </div>
      )}
    </div>
  );
}

/**
 * Notices that ask for an action. Positive or purely descriptive messages
 * ("low hail risk") are left out: the numbers above already say that.
 */
function buildAttention(
  t: TFunction,
  d: AnalyzedDealership,
  dealerships: AnalyzedDealership[],
  parameters: RiskParameters,
  openSite: () => void,
  openSettings: () => void,
): Attention[] {
  const items: Attention[] = [];
  if (d.boundary?.reviewRequired) {
    const because = boundaryReviewText(t, d.boundary, parameters);
    items.push({
      key: "boundary",
      tone: "warning",
      title: t("dashboard.detailDialog.attentionBoundaryTitle"),
      // "Prüfen, weil: …" has no full stop of its own.
      detail: because
        ? `${because.replace(/([^.!?])$/u, "$1.")} ${t("dashboard.detailDialog.attentionBoundaryDetail")}`
        : t("dashboard.detailDialog.attentionBoundaryDetail"),
      action: {
        label: t("dashboard.detailDialog.attentionBoundaryAction"),
        run: openSite,
      },
    });
  }
  if (isAreaEstimatedDetection(d.detection)) {
    items.push({
      key: "model",
      tone: "warning",
      title: t("dashboard.detailDialog.attentionModelTitle"),
      detail: t("dashboard.detailDialog.attentionModelDetail"),
      action: {
        label: t("dashboard.detailDialog.attentionModelAction"),
        run: openSettings,
      },
    });
  }
  const capturedAt = d.detection?.imagery?.chosen.capturedAt;
  const age = capturedAt ? imageryAgeYears(capturedAt) : null;
  if (age != null && age >= IMAGERY_STALE_AFTER_YEARS) {
    items.push({
      key: "imagery",
      tone: "warning",
      title: t("dashboard.detailDialog.attentionImageryTitle", { count: age }),
      detail: t("dashboard.detailDialog.attentionImageryDetail"),
      action: {
        label: t("dashboard.detailDialog.attentionImageryAction"),
        run: openSite,
      },
    });
  }
  for (const [index, message] of buildUnderwritingMessages(
    t,
    d,
    dealerships,
    parameters,
  ).entries()) {
    if (message.severity !== "warning" && message.severity !== "danger") {
      continue;
    }
    items.push({
      key: `uw-${index}`,
      tone: message.severity,
      title: message.title,
      detail: message.detail,
    });
  }
  return items;
}

/**
 * Position of this location when the portfolio is sorted by hail EAL,
 * highest first. Null below three locations, where a rank says nothing.
 */
function portfolioRank(
  d: AnalyzedDealership,
  dealerships: AnalyzedDealership[],
): { rank: number; total: number } | null {
  const own = d.risk?.eal;
  if (own == null) return null;
  const eals = dealerships
    .map((x) => x.risk?.eal)
    .filter((eal): eal is number => eal != null);
  if (eals.length < 3) return null;
  return {
    rank: eals.filter((eal) => eal > own).length + 1,
    total: eals.length,
  };
}

function formatIsoDate(iso: string, locale: string): string {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString(locale, { timeZone: "UTC" });
}

/** Hail zone and how the EAL in the header was derived. */
function HailOverview({ d }: { d: AnalyzedDealership }): React.JSX.Element {
  const { t } = useTranslation();
  const eb = d.risk?.ealBreakdown;
  return (
    <div className="space-y-3 text-sm">
      {eb && <HailEalSection eb={eb} detection={d.detection} />}
      {/* The zone itself is the badge in the header; only the tariff class
          adds information here. */}
      {d.hailRiskTier && (
        <p className="text-xs text-muted-foreground">
          {t("dashboard.detailDialog.hailZoneKasko", {
            tier: t(
              `dashboard.detailDialog.riskTier.${RISK_TIER_KEYS[d.hailRiskTier]}`,
            ),
          })}
        </p>
      )}
    </div>
  );
}

/** Shows how the hail EAL was derived: N × λ_z × S̄, with each input's source. */
function HailEalSection({
  eb,
  detection,
}: Readonly<{
  eb: EalBreakdown;
  detection: AnalyzedDealership["detection"];
}>): React.JSX.Element {
  const { t } = useTranslation();
  const detail = eb.hailDetail;
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold">
        {t("dashboard.hailEalDetail.title")}
      </h4>
      {detail ? (
        <>
          {/* One line instead of three cards that repeated the sentence. */}
          <p className="rounded-md bg-muted/40 px-3 py-2 font-medium tabular-nums">
            {t("dashboard.hailEalDetail.formula", {
              vehicles: num(detail.vehicles),
              frequency: num(detail.frequency, 3),
              severity: eur(detail.meanSeverityEur),
              eal: eur(eb.hail),
            })}
          </p>
          <p className="text-xs text-muted-foreground">
            {t(
              `dashboard.hailEalDetail.vehicleSource.${displayedHailVehicleSource(detail.vehicleSource, detection)}`,
            )}{" "}
            {t(`dashboard.hailEalDetail.zoneSource.${detail.zoneSource}`)}{" "}
            {t("dashboard.hailEalDetail.severityNote")}
          </p>
          {detail.stockRange ? (
            <p className="text-xs tabular-nums">
              {t("dashboard.hailEalDetail.stockRange", {
                count: detail.stockRange.images,
                low: eur(detail.stockRange.ealLow),
                median: eur(detail.stockRange.ealMedian),
                high: eur(detail.stockRange.ealHigh),
                vehiclesLow: num(detail.stockRange.vehiclesLow),
                vehiclesHigh: num(detail.stockRange.vehiclesHigh),
              })}{" "}
              {detail.stockRange.snapshot !== "typical" &&
                t(
                  `dashboard.hailEalDetail.stockSnapshot.${detail.stockRange.snapshot}`,
                )}{" "}
              {detail.stockRange.scaledToManual &&
                t("dashboard.hailEalDetail.stockScaled")}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("dashboard.hailEalDetail.stockRangeMissing")}
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("dashboard.hailEalDetail.legacy", { eal: eur(eb.total) })}
        </p>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <div className="rounded-lg border p-2.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-medium">{value}</div>
    </div>
  );
}

/** Human-readable label for a raw boundary role code, falling back to it verbatim. */
function boundaryRoleLabel(t: TFunction, role: string | undefined): string {
  if (!role) return "";
  return t(`dashboard.detailDialog.boundaryRole.${role}`, {
    defaultValue: role,
  });
}

/**
 * Drops every extra `MultiPolygon` part except the largest, producing a
 * plain `Polygon` (docs/boundary-improvement-plan.de.md P6 — a reviewer
 * rejecting a separately-confirmed component, P3, should not have to
 * redraw the whole site by hand).
 */
function withoutExtraComponents(boundary: BoundaryResult): BoundaryResult {
  if (boundary.polygon.type !== "MultiPolygon") return boundary;
  const rings = outerRings(boundary.polygon);
  const largest = rings.reduce((best, ring) =>
    Math.abs(area(asPolygon(ring) as never)) >
    Math.abs(area(asPolygon(best) as never))
      ? ring
      : best,
  );
  const polygon = asPolygon(largest);
  let areaSqm = boundary.areaSqm;
  try {
    areaSqm = area(polygon as never);
  } catch {
    // Area stays unchanged on error.
  }
  return { ...boundary, source: "manual", polygon, areaSqm };
}

/** Display name of a boundary candidate, from its provider rather than the engine's English label. */
function candidateLabel(
  t: TFunction,
  candidate: { provider?: string; source: string; label?: string },
): string {
  const key: Record<string, string> = {
    "alkis-vehicle-parcels": "dashboard.detailDialog.candidate.vehicleParcels",
    "vehicle-hull": "dashboard.detailDialog.candidate.vehicleHull",
    "alkis-parcel": "dashboard.detailDialog.candidate.parcel",
    "osm-dealer-area": "dashboard.detailDialog.candidate.osmDealerArea",
    synthetic: "dashboard.detailDialog.candidate.synthetic",
  };
  const k = candidate.provider ? key[candidate.provider] : undefined;
  if (!k) {
    // Labels written by the boundary engine in English (stored per site).
    const parcels = candidate.label?.match(
      /^ALKIS parcel(?: \+ (\d+) with vehicles)?$/,
    );
    if (parcels)
      return parcels[1]
        ? t("dashboard.detailDialog.candidate.parcelPlusVehicles", {
            count: Number(parcels[1]),
          })
        : t("dashboard.detailDialog.candidate.parcel");
    return candidate.label ?? boundarySourceLabel(t, candidate.source);
  }
  const name = t(k);
  return candidate.provider === "osm-dealer-area" && candidate.label
    ? `${name} · ${candidate.label}`
    : name;
}

/**
 * The vehicle outline is only a fallback for sites without a usable cadastre.
 * Next to parcels that already hold most of the vehicles (full stage-1
 * confidence) it is always the worse choice — it follows parked cars into the
 * street — so it is not offered there.
 */
function weakerVehicleOutline(
  candidate: BoundaryCandidate,
  current: BoundaryResult,
): boolean {
  return (
    candidate.provider === "vehicle-hull" &&
    current.provider === "alkis-vehicle-parcels" &&
    current.confidence >= 0.75
  );
}

function sameGeometry(a: BoundaryCandidate, b: BoundaryResult): boolean {
  return (
    a.provider === b.provider &&
    Math.abs(a.areaSqm - b.areaSqm) < 1 &&
    a.source === b.source
  );
}

/**
 * The boundary with the actions a reviewer needs: confirm it, edit it on the
 * map, or take one of the other candidates the cascade already computed.
 * Technical detail (role, agreement, engine, stage reasons) sits behind a
 * disclosure.
 */
/** "Check because: …" with the reasons the review rule found, or "". */
function boundaryReviewText(
  t: TFunction,
  boundary: BoundaryResult,
  parameters: RiskParameters,
): string {
  const reasons = boundaryReviewReasons(boundary, parameters);
  if (reasons.length === 0) return "";
  return t("dashboard.detailDialog.boundaryReviewBecause", {
    reasons: reasons
      .map((reason) =>
        t(`dashboard.detailDialog.boundaryReviewReason.${reason}`),
      )
      .join("; "),
  });
}

function BoundaryPanel({
  d,
  onEditOnMap,
}: {
  d: AnalyzedDealership;
  onEditOnMap: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const parameters = useAppStore((s) => s.parameters);
  const confirmBoundary = useAppStore((s) => s.confirmBoundary);
  const updateBoundary = useAppStore((s) => s.updateBoundaryAndRescore);
  const saveBoundaryEdit = useAppStore((s) => s.saveBoundaryEdit);
  const undoBoundaryEdit = useAppStore((s) => s.undoBoundaryEdit);
  const revertBoundaryToDefault = useAppStore((s) => s.revertBoundaryToDefault);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<BoundaryCandidate | null>(null);
  const boundary = d.boundary;
  if (!boundary) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("dashboard.detailDialog.boundaryNone")}
      </p>
    );
  }
  const confirmed =
    boundary.source === "manual" || boundary.confirmedAt != null;
  const others = (boundary.candidates ?? []).filter(
    (candidate) =>
      !sameGeometry(candidate, boundary) &&
      !weakerVehicleOutline(candidate, boundary),
  );

  async function run(work: () => Promise<void>): Promise<void> {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function adopt(candidate: BoundaryCandidate): Promise<void> {
    // Choosing a computed candidate is a reviewer's decision: it counts as
    // confirmed, and the vehicles are recounted inside it.
    return run(async () => {
      await updateBoundary(d.id, {
        ...boundary!,
        source: candidate.source,
        role: candidate.role,
        provider: candidate.provider,
        polygon: candidate.polygon,
        areaSqm: candidate.areaSqm,
        confidence: candidate.confidence,
        label: candidate.label,
        evidence: candidate.evidence ?? boundary!.evidence,
        quality: {
          ...(candidate.quality ?? boundary!.quality ?? { reasons: [] }),
          reasons: [
            `chosen manually from the boundary suggestions (${candidate.provider ?? candidate.source})`,
          ],
        } as BoundaryResult["quality"],
        reviewRequired: false,
        confirmedAt: new Date().toISOString(),
      });
      await saveBoundaryEdit(d.id);
      toast.success(
        t("dashboard.detailDialog.boundaryAdopted", {
          label: candidateLabel(t, candidate),
        }),
        {
          action: {
            label: t("map.page.undoBoundaryEdit"),
            onClick: () =>
              void run(async () => {
                await undoBoundaryEdit(d.id);
                await saveBoundaryEdit(d.id);
              }),
          },
        },
      );
    });
  }

  function restoreOriginal(): Promise<void> {
    return run(async () => {
      await revertBoundaryToDefault(d.id);
      await saveBoundaryEdit(d.id);
    });
  }

  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold">
          {t("dashboard.detailDialog.boundaryTitle")}
        </h4>
        {boundary.reviewRequired ? (
          <Badge variant="warning">
            {t("dashboard.detailDialog.boundaryReviewLabel")}
          </Badge>
        ) : confirmed ? (
          <Badge variant="outline" className="gap-1">
            <Check className="size-3" />
            {t("dashboard.detailDialog.boundaryStatusConfirmed")}
          </Badge>
        ) : null}
      </div>
      {boundary.reviewRequired && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <TriangleAlert
            aria-hidden
            className="mt-0.5 size-3.5 shrink-0 text-warning-foreground"
          />
          {boundaryReviewText(t, boundary, parameters)}
        </p>
      )}
      <p className="text-muted-foreground">
        {candidateLabel(t, boundary)} · {num(boundary.areaSqm)} m² ·{" "}
        {t("dashboard.detailDialog.confidenceValue", {
          value: pct(boundary.confidence, 0),
        })}
      </p>
      <div className="flex flex-wrap gap-2">
        {!confirmed && (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void run(() => confirmBoundary(d.id))}
          >
            <Check className="size-3.5" />
            {t("dashboard.detailDialog.boundaryConfirm")}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={onEditOnMap}>
          <Pencil className="size-3.5" />
          {t("dashboard.detailDialog.boundaryEditOnMap")}
        </Button>
        {d.boundaryBeforeManualEdit && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void restoreOriginal()}
            title={t("dashboard.detailDialog.boundaryRestoreHint", {
              label: candidateLabel(t, d.boundaryBeforeManualEdit),
              area: num(d.boundaryBeforeManualEdit.areaSqm),
            })}
          >
            <RotateCcw className="size-3.5" />
            {t("dashboard.detailDialog.boundaryRestore")}
          </Button>
        )}
        {boundary.polygon.type === "MultiPolygon" && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void run(() =>
                updateBoundary(d.id, withoutExtraComponents(boundary)),
              )
            }
          >
            {t("dashboard.detailDialog.boundaryExcludePartAction")}
          </Button>
        )}
      </div>

      {others.length > 0 && (
        <details
          className="rounded-md border text-sm"
          open={boundary.reviewRequired}
        >
          <summary className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
            {t("dashboard.detailDialog.boundaryAlternativesCount", {
              count: Math.min(others.length, 4),
            })}
          </summary>
          <div className="space-y-1 border-t p-2">
            {others.slice(0, 4).map((candidate, index) => (
              <div
                key={`${candidate.provider ?? candidate.source}-${index}`}
                className="flex items-center justify-between gap-2"
              >
                <span className="min-w-0 truncate">
                  {candidateLabel(t, candidate)}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {num(candidate.areaSqm)} m² · {pct(candidate.confidence, 0)}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 shrink-0 text-xs"
                  disabled={busy}
                  onClick={() => setPending(candidate)}
                >
                  {t("dashboard.detailDialog.boundaryAdopt")}
                </Button>
              </div>
            ))}
          </div>
        </details>
      )}

      <Dialog
        open={pending != null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("dashboard.detailDialog.boundaryAdoptTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("dashboard.detailDialog.boundaryAdoptDescription")}
            </DialogDescription>
          </DialogHeader>
          {pending && (
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Metric
                label={t("dashboard.detailDialog.boundaryCurrent")}
                value={`${num(boundary.areaSqm)} m² · ${pct(boundary.confidence, 0)}`}
              />
              <Metric
                label={candidateLabel(t, pending)}
                value={`${num(pending.areaSqm)} m² · ${pct(pending.confidence, 0)}`}
              />
            </div>
          )}
          {pending && pending.confidence < boundary.confidence && (
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <TriangleAlert
                aria-hidden
                className="mt-0.5 size-3.5 shrink-0 text-warning-foreground"
              />
              {t("dashboard.detailDialog.boundaryAdoptWeaker")}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPending(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => {
                const candidate = pending;
                setPending(null);
                if (candidate) void adopt(candidate);
              }}
            >
              {t("dashboard.detailDialog.boundaryAdopt")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <details className="rounded-md border bg-muted/20 text-xs">
        <summary className="px-2 py-1.5 font-medium text-muted-foreground">
          {t("dashboard.detailDialog.showDetails")}
        </summary>
        <div className="space-y-1.5 border-t px-2 py-2 text-muted-foreground">
          {boundary.role && (
            <div>
              {t("dashboard.detailDialog.boundaryRoleLabel", {
                role: boundaryRoleLabel(t, boundary.role),
              })}
            </div>
          )}
          {boundary.quality && (
            <div>
              {t("dashboard.detailDialog.boundaryAgreementLabel", {
                agreement: pct(boundary.quality.sourceAgreement, 0),
              })}
            </div>
          )}
          {boundary.quality?.usedEngine && (
            <div>
              {t("dashboard.detailDialog.boundaryEngineLabel", {
                engine: t(
                  `dashboard.detailDialog.boundaryEngine.${boundary.quality.usedEngine}`,
                ),
              })}
            </div>
          )}
          {(boundary.quality?.reasons.length ?? 0) > 0 && (
            <ul className="list-disc space-y-0.5 border-t pl-4 pt-1.5">
              {boundary.quality!.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </div>
  );
}

/** Detected and manual vehicle count, capacity and utilisation. */
function VehiclePanel({ d }: { d: AnalyzedDealership }): React.JSX.Element {
  const { t } = useTranslation();
  const [adjusting, setAdjusting] = useState(false);
  const manual = d.detection?.manualVehicleCount;
  useEffect(() => setAdjusting(false), [d.id]);
  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-semibold">{t("common.vehicles")}</h4>
        {!adjusting && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => setAdjusting(true)}
          >
            <Pencil className="size-3" />
            {manual != null
              ? t("dashboard.detailDialog.vehiclesChangeManual")
              : t("dashboard.detailDialog.vehiclesAdjust")}
          </Button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Metric
          label={
            isAreaEstimatedDetection(d.detection)
              ? t("dashboard.detailDialog.estimatedVehicleCount")
              : t("dashboard.detailDialog.machineVehicleCount")
          }
          value={num(d.detection?.vehicleCount)}
        />
        <Metric
          label={t("dashboard.capacity")}
          value={num(d.risk?.capacityEstimate)}
        />
        <Metric
          label={t("dashboard.utilisation")}
          value={pct(d.risk?.utilisation, 0)}
        />
      </div>
      {manual != null && !adjusting && (
        <p className="text-xs text-muted-foreground">
          {t("dashboard.detailDialog.manualVehicleCountSaved", {
            count: manual,
          })}
        </p>
      )}
      {adjusting && (
        <ManualVehicleCountEditor d={d} onDone={() => setAdjusting(false)} />
      )}
    </div>
  );
}

/**
 * Risk-model provenance: confidence at a glance, with the full limitations
 * and evidence-source list (required to stay reproducible/source-aware)
 * behind a single "Show details" disclosure rather than always spelled out.
 */
function ModelConfidenceSummary({
  d,
}: {
  d: AnalyzedDealership;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  if (!d.risk) return null;
  const limitations = d.risk.limitations ?? [];
  const evidence = d.risk.evidence ?? [];

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <h4 className="font-semibold">{t("ui.modelConfidence")}</h4>
        <span className="text-muted-foreground">
          {pct(d.risk.confidence, 0)}
          {d.risk.modelVersion ? ` · ${d.risk.modelVersion}` : ""}
        </span>
      </div>
      {evidence.length > 0 && (
        <details className="rounded-md border text-xs">
          <summary className="px-2 py-1.5 font-medium text-muted-foreground">
            {t("dashboard.detailDialog.sourcesUsedCount", {
              count: evidence.length,
            })}
          </summary>
          <ul className="space-y-1 border-t px-2 py-2">
            {evidence.map((item) => (
              <li
                key={`${item.source}-${item.method}`}
                className="flex justify-between gap-3"
              >
                <span className="min-w-0">
                  <span className="font-medium">
                    {localizedRiskText(t, item.source)}
                  </span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {localizedRiskText(t, item.method)}
                    {item.fallbackUsed
                      ? t("dashboard.detailDialog.evidenceFallbackSuffix")
                      : ""}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {pct(item.confidence, 0)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {limitations.length > 0 && (
        <details className="rounded-md border text-xs">
          <summary className="px-2 py-1.5 font-medium text-muted-foreground">
            {t("dashboard.detailDialog.limitationsToggle", {
              count: limitations.length,
            })}
          </summary>
          <ul className="list-disc space-y-1 border-t py-2 pl-6 pr-2 text-muted-foreground">
            {limitations.map((limitation) => (
              <li key={limitation}>{localizedRiskText(t, limitation)}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Localizes persisted provenance text while keeping unknown provider text intact. */
function localizedRiskText(t: TFunction, text: string): string {
  const exact: Record<string, string> = {
    "Hazard values are location-level proxies and should be validated before underwriting decisions":
      "dashboard.detailDialog.riskText.hazardProxy",
    "Not a catastrophe-model or engineering assessment":
      "dashboard.detailDialog.riskText.notEngineeringAssessment",
    "92-day weather window with screening proxies":
      "dashboard.detailDialog.riskText.weatherWindow",
    "synthetic radius fallback":
      "dashboard.detailDialog.riskText.syntheticBoundaryMethod",
    "geospatial boundary lookup":
      "dashboard.detailDialog.riskText.boundaryLookupMethod",
    "Manual boundary review recommended":
      "dashboard.detailDialog.riskText.manualBoundaryReview",
    "area-based estimate": "dashboard.detailDialog.riskText.areaEstimateMethod",
    "aerial object detection":
      "dashboard.detailDialog.riskText.aerialDetectionMethod",
    "Vehicle count is estimated; install the detector model":
      "dashboard.detailDialog.riskText.vehicleEstimate",
    "Synthetic lot boundary used":
      "dashboard.detailDialog.riskText.syntheticBoundary",
    "Boundary requires review before underwriting use":
      "dashboard.detailDialog.riskText.boundaryReviewRequired",
    "Boundary sources do not sufficiently agree":
      "dashboard.detailDialog.riskText.boundaryDisagreement",
    "Vehicle exposure is estimated because no ML model is installed":
      "dashboard.detailDialog.riskText.noMlModel",
    "Hail zone estimated from weather data; no postcode hail zone available":
      "dashboard.detailDialog.riskText.hailZoneEstimated",
    "Hail EAL frequency and severity parameters are uncalibrated placeholders":
      "dashboard.detailDialog.riskText.hailEalPlaceholders",
    "Hail EAL vehicle count derived from the declared asset value":
      "dashboard.detailDialog.riskText.hailVehiclesFromAssetValue",
    "Postcode hail zones": "dashboard.detailDialog.riskText.postcodeHailZones",
    "postcode hail-zone lookup":
      "dashboard.detailDialog.riskText.postcodeHailZoneMethod",
    "hail zone estimated from weather-based hail score":
      "dashboard.detailDialog.riskText.estimatedHailZoneMethod",
    "cascade stage 1: cadastral parcels holding the vehicle lot":
      "dashboard.detailDialog.riskText.cascadeVehicleParcels",
    "cascade stage 2: outline of the detected vehicle lot":
      "dashboard.detailDialog.riskText.cascadeVehicleHull",
    "cascade stage 3: car-dealer area at the point":
      "dashboard.detailDialog.riskText.cascadeOsmDealerArea",
    "cascade stage 4: cadastral parcel containing the point":
      "dashboard.detailDialog.riskText.cascadeParcel",
  };
  const key = exact[text];
  if (key) return t(key);
  // The vehicle detector describes itself technically ("dealer_vehicles
  // ONNX", "sliding-window oriented aerial vehicle detection at 0.1 m/px…").
  if (/^dealer_vehicles\b/.test(text))
    return t("dashboard.detailDialog.riskText.vehicleDetectorSource");
  const detector = text.match(
    /^sliding-window oriented aerial vehicle detection at ([\d.]+) m\/px/,
  );
  if (detector)
    return t("dashboard.detailDialog.riskText.vehicleDetectorMethod", {
      resolution: detector[1].replace(".", ","),
    });
  const screening = text.match(/^Risk model (.+) is a screening model$/);
  if (screening)
    return t("dashboard.detailDialog.riskText.screeningModel", {
      version: screening[1],
    });
  const confirmed = text.match(
    /^Boundary confirmed by visual review on (\d{4}-\d{2}-\d{2}), not a cadastral survey$/,
  );
  if (confirmed)
    return t("dashboard.detailDialog.riskText.boundaryConfirmed", {
      date: formatIsoDate(confirmed[1], i18next.language),
    });
  const role = text.match(
    /^Boundary represents (.+), not a confirmed operational lot$/,
  );
  if (role)
    return t("dashboard.detailDialog.riskText.boundaryRole", {
      role: boundaryRoleLabel(t, role[1]),
    });
  return text;
}

function NatCatSection({ d }: { d: AnalyzedDealership }): React.JSX.Element {
  const { t } = useTranslation();
  const refreshNatCat = useAppStore((state) => state.refreshNatCat);
  const [refreshing, setRefreshing] = useState(false);
  const assessment = d.natCat ?? d.risk?.natCat;

  async function refresh(): Promise<void> {
    setRefreshing(true);
    try {
      await refreshNatCat(d.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshing(false);
    }
  }

  const refreshButton = (
    <Button
      size="sm"
      variant="ghost"
      className="h-7 shrink-0 gap-1 text-xs"
      disabled={refreshing}
      onClick={() => void refresh()}
    >
      <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
      {refreshing
        ? t("dashboard.detailDialog.natCatRefreshing")
        : t("dashboard.detailDialog.natCatRefresh")}
    </Button>
  );

  // Without an external source there is nothing to show but that fact.
  if (!assessment)
    return (
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{t("dashboard.detailDialog.natCatNone")}</span>
        {refreshButton}
      </div>
    );

  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-semibold">
          {t("dashboard.detailDialog.natCatTitle")}
        </h4>
        {refreshButton}
      </div>
      <>
        <div className="text-xs text-muted-foreground">
          {assessment.evidence.source} · {assessment.dataVersion ?? "unknown"}
        </div>
        <div className="grid gap-1 text-xs sm:grid-cols-2">
          {assessment.hazards.map((hazard) => (
            <div key={`${hazard.peril}-${hazard.unit}`}>
              {t("dashboard.detailDialog.natCatHazard", {
                peril: hazard.peril,
                zone: estimateHailZoneFromScore(hazard.score),
                unit: hazard.unit,
              })}
              {/* Source per value in assessments combined by older builds. */}
              {assessment.provider === "composite" && hazard.provider && (
                <span className="text-muted-foreground">
                  {" "}
                  · {sourceLabel(hazard.provider)}
                </span>
              )}
            </div>
          ))}
        </div>
        {assessment.evidence.fallbackUsed && (
          <ul className="list-inside list-disc text-xs text-muted-foreground marker:text-warning-foreground">
            {assessment.evidence.limitations
              .filter((note) => note.includes(" used instead"))
              .map((note) => (
                <li key={note}>{note}</li>
              ))}
          </ul>
        )}
        {Object.entries(assessment.attributes).map(([name, value]) => (
          <div key={name} className="text-xs text-muted-foreground">
            {t("dashboard.detailDialog.natCatAttribute", {
              name,
              value: String(value),
            })}
          </div>
        ))}
      </>
    </div>
  );
}

function ManualVehicleCountEditor({
  d,
  onDone,
}: {
  d: AnalyzedDealership;
  onDone: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const updateManualVehicleCount = useAppStore(
    (state) => state.updateManualVehicleCount,
  );
  const [draft, setDraft] = useState(
    () => d.detection?.manualVehicleCount?.toString() ?? "",
  );
  const [saving, setSaving] = useState(false);

  const parsed = draft.trim() === "" ? null : Number(draft);
  const valid = parsed === null || (Number.isInteger(parsed) && parsed >= 0);

  async function save(value: number | null): Promise<void> {
    if (!valid) return;
    setSaving(true);
    try {
      await updateManualVehicleCount(d.id, value);
      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="space-y-1 rounded-md border p-2"
      onSubmit={(event) => {
        event.preventDefault();
        void save(parsed);
      }}
    >
      <Label htmlFor={`manual-count-${d.id}`} className="text-xs">
        {t("dashboard.detailDialog.manualVehicleCount")}
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id={`manual-count-${d.id}`}
          autoFocus
          type="number"
          min={0}
          step={1}
          value={draft}
          className="h-8"
          placeholder={t(
            "dashboard.detailDialog.manualVehicleCountPlaceholder",
          )}
          aria-invalid={!valid}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button type="submit" size="sm" disabled={saving || !valid}>
          {t("dashboard.detailDialog.websiteSave")}
        </Button>
        {d.detection?.manualVehicleCount != null && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={saving}
            onClick={() => void save(null)}
          >
            {t("dashboard.detailDialog.vehiclesUseDetected")}
          </Button>
        )}
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          {t("dashboard.detailDialog.websiteCancel")}
        </Button>
      </div>
      {!valid && (
        <p className="text-xs text-destructive">
          {t("dashboard.detailDialog.manualCountInvalid")}
        </p>
      )}
    </form>
  );
}

/**
 * Loads additional OSM info (website, phone, opening hours, brand, ...) for a
 * coordinate — shared by `WebsiteRow` (website link) and
 * `OsmDetailsSection` (full view) so it's only fetched once per location.
 */
function useOsmDetails(
  lat: number,
  lon: number,
  name?: string,
  address?: string,
): { details: OsmDetails | null; loading: boolean } {
  const [details, setDetails] = useState<OsmDetails | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDetails(null);
    window.api
      .getOsmDetails(lat, lon, name, address)
      .then((res) => {
        if (!cancelled) setDetails(res);
      })
      .catch(() => {
        if (!cancelled) setDetails(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lat, lon, name, address]);

  return { details, loading };
}

/** Google Maps search for the actual dealership, with coordinates as context. */
function googleMapsUrl(d: AnalyzedDealership): string {
  const query = [d.name, d.address].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** OpenStreetMap link for the coordinate. */
function openStreetMapUrl(lat: number, lon: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}`;
}

/**
 * The dealership's website: the stored link (manual or a previous OSM hit),
 * else the one OpenStreetMap just found — which is then stored, so the map
 * popup and later visits have it too. A manual link always wins; resetting
 * it falls back to the automatic lookup.
 */
function WebsiteRow({
  d,
  detectedWebsite,
  detecting,
}: {
  d: AnalyzedDealership;
  detectedWebsite?: string;
  detecting: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const updateWebsite = useAppStore((s) => s.updateDealershipWebsite);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (detectedWebsite && !isUserWebsiteSource(d.websiteSource))
      void updateWebsite(d.id, detectedWebsite, "osm").catch((err: unknown) => {
        console.error("Storing the detected website failed:", err);
      });
  }, [d.id, d.websiteSource, detectedWebsite, updateWebsite]);

  useEffect(() => {
    setEditing(false);
  }, [d.id]);

  // Typed and imported links are the user's: shown with their origin and
  // never replaced by the automatic lookup.
  const userProvided = isUserWebsiteSource(d.websiteSource);
  const website = d.website ?? (userProvided ? undefined : detectedWebsite);

  function startEditing(): void {
    setDraft(website ?? "");
    setInvalid(false);
    setEditing(true);
  }

  async function apply(value: string | null): Promise<void> {
    setSaving(true);
    try {
      const ok = await updateWebsite(d.id, value, "manual");
      if (!ok) {
        setInvalid(true);
        return;
      }
      setEditing(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <form
        className="space-y-1"
        onSubmit={(e) => {
          e.preventDefault();
          void apply(draft.trim() === "" ? null : draft);
        }}
      >
        <div className="flex items-center gap-2">
          <Globe className="size-3.5 shrink-0 text-muted-foreground" />
          <Input
            autoFocus
            value={draft}
            maxLength={WEBSITE_URL_MAX_LENGTH}
            placeholder="https://www.autohaus-beispiel.de"
            aria-label={t("dashboard.detailDialog.websiteEditLabel")}
            aria-invalid={invalid}
            className="h-8"
            onChange={(e) => {
              setDraft(e.target.value);
              setInvalid(false);
            }}
          />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            className="h-8"
            disabled={saving}
            title={t("dashboard.detailDialog.websiteSave")}
          >
            <Check className="size-3.5" />
            <span className="sr-only">
              {t("dashboard.detailDialog.websiteSave")}
            </span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8"
            onClick={() => setEditing(false)}
            title={t("dashboard.detailDialog.websiteCancel")}
          >
            <X className="size-3.5" />
            <span className="sr-only">
              {t("dashboard.detailDialog.websiteCancel")}
            </span>
          </Button>
        </div>
        {invalid && (
          <p className="text-xs text-destructive">
            {t("dashboard.detailDialog.websiteInvalid")}
          </p>
        )}
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <Globe className="size-3.5 shrink-0 text-muted-foreground" />
      {website ? (
        <a
          href={website}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 truncate text-primary hover:underline"
          title={website}
        >
          {websiteLabel(website)}
        </a>
      ) : detecting ? (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          {t("dashboard.detailDialog.websiteDetecting")}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">
          {t("dashboard.detailDialog.websiteNone")}
        </span>
      )}
      {website && (
        <span className="text-xs text-muted-foreground">
          {d.websiteSource === "import"
            ? t("dashboard.detailDialog.websiteSourceImport")
            : d.websiteSource === "manual"
              ? t("dashboard.detailDialog.websiteSourceManual")
              : t("dashboard.detailDialog.websiteSourceOsm")}
        </span>
      )}
      <div className="ml-auto flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 px-2 text-xs"
          onClick={startEditing}
        >
          <Pencil className="size-3" />
          {website
            ? t("dashboard.detailDialog.websiteEdit")
            : t("dashboard.detailDialog.websiteAdd")}
        </Button>
        {userProvided && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs"
            disabled={saving}
            onClick={() => void apply(null)}
          >
            <RotateCcw className="size-3" />
            {t("dashboard.detailDialog.websiteReset")}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Additional info from OpenStreetMap (phone, opening hours, brand, ...) — the
 * website is already in `WebsiteRow`, not duplicated here. Hides itself
 * entirely when OSM has none of these tags for the location.
 */
function OsmDetailsSection({
  details,
  loading,
}: {
  details: OsmDetails | null;
  loading: boolean;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  if (loading) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />{" "}
        {t("dashboard.detailDialog.osmLoading")}
      </div>
    );
  }

  const hasInfo =
    details?.phone || details?.email || details?.openingHours || details?.brand;
  if (!hasInfo || !details) return null;

  return (
    <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3 text-sm">
      <h4 className="text-xs font-semibold text-muted-foreground">
        {t("dashboard.detailDialog.osmHeading")}
      </h4>
      <div className="space-y-1">
        {details.phone && (
          <a
            href={`tel:${details.phone}`}
            className="flex items-center gap-1.5 hover:underline"
          >
            <Phone className="size-3.5 shrink-0 text-muted-foreground" />
            {details.phone}
          </a>
        )}
        {details.email && (
          <a
            href={`mailto:${details.email}`}
            className="flex items-center gap-1.5 hover:underline"
          >
            <Mail className="size-3.5 shrink-0 text-muted-foreground" />
            {details.email}
          </a>
        )}
        {details.openingHours && (
          <div className="flex items-start gap-1.5">
            <Clock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <span>{details.openingHours}</span>
          </div>
        )}
        {details.brand && (
          <div className="flex items-center gap-1.5">
            <Tag className="size-3.5 shrink-0 text-muted-foreground" />
            {details.brand}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Editable portfolio metadata: business type (existing vs. new business),
 * sales partner, sub-portfolio, group, maximum indemnity, and deductible. Writes directly
 * to the store (`updateDealershipMeta`); text fields commit on blur.
 */
function PortfolioMetaSection({
  d,
}: {
  d: AnalyzedDealership;
}): React.JSX.Element {
  const { t } = useTranslation();
  const updateMeta = useAppStore((s) => s.updateDealershipMeta);

  const textField = (
    label: string,
    key: "salesPartner" | "subPortfolio" | "group",
  ): React.JSX.Element => (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <Input
        defaultValue={d[key] ?? ""}
        onBlur={(e) => updateMeta(d.id, { [key]: e.target.value || undefined })}
      />
    </label>
  );

  const amountField = (
    label: string,
    key: "productLimitEur" | "deductibleEur",
  ): React.JSX.Element => (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <Input
        // Remount when the stored value changes (e.g. after an import).
        key={`${key}-${d[key] ?? ""}`}
        type="number"
        min={0}
        defaultValue={d[key] ?? ""}
        onBlur={(e) => {
          const n = Number(e.target.value);
          updateMeta(d.id, {
            [key]: e.target.value && !Number.isNaN(n) && n >= 0 ? n : undefined,
          });
        }}
      />
    </label>
  );

  return (
    <div className="space-y-3">
      {/* A two-way choice instead of a switch whose label ("Bestand") and
          description ("Neugeschäft") contradicted each other when off. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-0.5">
          <Label className="text-sm font-semibold">
            {t("dashboard.detailDialog.businessTypeLabel")}
          </Label>
          <p className="text-xs text-muted-foreground">
            {d.insured
              ? t("dashboard.detailDialog.insuredYesDesc")
              : t("dashboard.detailDialog.insuredNoDesc")}
          </p>
        </div>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={d.insured ? "existing" : "new"}
          onValueChange={(v) =>
            v && updateMeta(d.id, { insured: v === "existing" })
          }
        >
          <ToggleGroupItem value="new" className="px-3">
            {t("dashboard.detailDialog.businessNew")}
          </ToggleGroupItem>
          <ToggleGroupItem value="existing" className="px-3">
            {t("dashboard.detailDialog.businessExisting")}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {textField(
          t("dashboard.detailDialog.salesPartnerLabel"),
          "salesPartner",
        )}
        {textField(
          t("dashboard.detailDialog.subPortfolioLabel"),
          "subPortfolio",
        )}
        {textField(t("dashboard.detailDialog.groupLabel"), "group")}
        {amountField(
          t("dashboard.detailDialog.productLimitLabel"),
          "productLimitEur",
        )}
        {amountField(
          t("dashboard.detailDialog.deductibleLabel"),
          "deductibleEur",
        )}
      </div>
    </div>
  );
}

/** Pause after typing before notes are saved on their own. */
const NOTES_AUTOSAVE_MS = 800;

/**
 * Free-text underwriting notes for one location, stored with the portfolio.
 * Saved automatically a moment after typing stops, on blur, and when the
 * dialog closes, so there is no save button to forget.
 */
function NotesSection({ d }: { d: AnalyzedDealership }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const updateNotes = useAppStore((s) => s.updateDealershipNotes);
  const [draft, setDraft] = useState(d.notes ?? "");
  const [saving, setSaving] = useState(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    setDraft(d.notes ?? "");
  }, [d.id, d.notes]);

  // Flush unsaved text on unmount (dialog closed or another location opened).
  useEffect(() => {
    const id = d.id;
    return () => {
      void useAppStore
        .getState()
        .updateDealershipNotes(id, draftRef.current)
        .catch((err: unknown) => {
          console.error("Saving notes on close failed:", err);
        });
    };
  }, [d.id]);

  const dirty = (draft.trim() === "" ? "" : draft) !== (d.notes ?? "");

  async function save(): Promise<void> {
    if (!dirty) return;
    setSaving(true);
    try {
      await updateNotes(d.id, draftRef.current);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => void save(), NOTES_AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
    // `save` reads the latest draft through the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, dirty]);

  return (
    <div className="space-y-1.5">
      <Label
        htmlFor={`notes-${d.id}`}
        className="flex items-center gap-1.5 text-sm font-semibold"
      >
        <StickyNote className="size-3.5 text-muted-foreground" />
        {t("dashboard.detailDialog.notesTitle")}
      </Label>
      <Textarea
        id={`notes-${d.id}`}
        value={draft}
        rows={4}
        maxLength={DEALERSHIP_NOTES_MAX_LENGTH}
        placeholder={t("dashboard.detailDialog.notesPlaceholder")}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void save()}
      />
      <p className="text-[11px] text-muted-foreground">
        {saving || dirty
          ? t("dashboard.detailDialog.notesSaving")
          : !d.notes
            ? t("dashboard.detailDialog.notesEmpty")
            : d.notesUpdatedAt
              ? t("dashboard.detailDialog.notesUpdatedAt", {
                  date: new Date(d.notesUpdatedAt).toLocaleString(
                    i18n.language,
                  ),
                })
              : t("dashboard.detailDialog.notesSaved")}
      </p>
    </div>
  );
}

function AiSection({ d }: { d: AnalyzedDealership }): React.JSX.Element {
  const { t } = useTranslation();
  const [memo, setMemo] = useState<StructuredMemo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function genMemo(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setMemo(await window.api.llmMemo(d));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={genMemo} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <FileText />}{" "}
          {t("ai.memo")}
        </Button>
      </div>

      {error && (
        <LlmErrorMessage
          error={error}
          className="text-sm"
          format={(e) => t("dashboard.detailDialog.errorPrefix", { error: e })}
        />
      )}

      {memo && (
        <div className="space-y-1.5 rounded-lg border bg-muted/40 p-3 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <Metric
              label={t("dashboard.detailDialog.recommendedDeductibleLabel")}
              value={eur(memo.recommendedDeductibleEur)}
            />
            <Metric
              label={t("dashboard.detailDialog.premiumLoadingLabel")}
              value={`${memo.suggestedPremiumLoadingPct.toFixed(0)} %`}
            />
          </div>
          {memo.sublimitNotes.length > 0 && (
            <ul className="list-inside list-disc text-muted-foreground">
              {memo.sublimitNotes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
          <p>{memo.reasoning}</p>
        </div>
      )}
    </div>
  );
}
