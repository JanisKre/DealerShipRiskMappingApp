import { toastExported } from "@renderer/lib/exportToast";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Loader2,
  MapPin,
  MoreHorizontal,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type { AnalyzedDealership } from "@shared/types";
import { PageErrorBoundary } from "@renderer/components/common/PageErrorBoundary";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import { cn } from "@renderer/lib/utils";
import { HintButton } from "@renderer/components/ui/hint-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { Separator } from "@renderer/components/ui/separator";
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
import { useAppStore } from "@renderer/store/appStore";
import { eur, num } from "@renderer/lib/format";
import { HailZoneBadge } from "./HailZoneBadge";
import {
  dealershipHailZone,
  displayedHailVehicleSource,
  effectiveVehicleCount,
  exposureSource,
  isAreaEstimatedDetection,
} from "@shared/risk-math";
import { hasEalBasis } from "@shared/estimates";
import { NoEalBadge } from "./EstimateMark";
import { DetectionImageryNote } from "./DetectionImageryNote";
import { ImageryHistorySection } from "./ImageryHistorySection";
import { HailHistorySection } from "./HailHistorySection";
import { RadarHailSection } from "./RadarHailSection";
import { QuestionnaireSection } from "./QuestionnaireSection";
import {
  ChallengeSection,
  EvidenceMemoSection,
  SiteCheckSection,
} from "./AiInsightSections";
import {
  isTypingTarget,
  ReviewStrip,
  type ReviewRun,
} from "./detail/ReviewStrip";
import {
  AttentionRow,
  vehicleHint,
  KeyFigure,
  buildAttention,
  portfolioRank,
  type DetailTab,
} from "./detail/attention";
import { HistorySection } from "./detail/HistorySection";
import { addressLine, Disclosure } from "./detail/shared";
import { isReviewCurrent, reviewReasons } from "./reviewQueue";
import { HailOverview } from "./detail/HailSections";
import { BoundaryPanel } from "./detail/BoundaryPanel";
import { VehiclePanel } from "./detail/VehiclePanel";
import {
  ModelConfidenceSummary,
  NatCatSection,
} from "./detail/SourcesSections";
import {
  useOsmDetails,
  googleMapsUrl,
  openStreetMapUrl,
  WebsiteRow,
  OsmDetailsSection,
} from "./detail/SiteLinks";
import { PortfolioMetaSection, NotesSection } from "./detail/ContractSections";

/**
 * Detail dialog for a location, built for progressive disclosure:
 *
 *  1. Always visible, kept short: name, zone and business badges (plus a
 *     "check boundary" badge only when needed), the address with the main
 *     actions, three key figures (hail EAL, vehicles, exposure) and the
 *     notices that ask for an action, one line each.
 *  2. Tabs named after tasks: risk (EAL derivation and its weakest
 *     assumptions, hail context), site & vehicles (boundary, vehicle count,
 *     imagery), contract & notes (notes, AI draft, contract data, questions
 *     for the dealership), sources & history.
 *  3. Inside a tab only what the task needs is spelled out. Everything else
 *     is one collapsible row (`Disclosure`) that names the section and its
 *     current value: hail history, radar, AI texts, image history, sources,
 *     limitations, weakest assumptions, change history.
 *
 * In a review run the strip at the top says what is open at this location
 * and why, and the dialog opens on the tab where it is checked.
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
  const { t } = useTranslation();
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
          // A location whose data cannot be drawn shows a message here; the
          // dialog still closes and the arrows of the page still work.
          <PageErrorBoundary
            area="Location detail dialog"
            resetKey={dealership.id}
            title={t("common.pageErrorTitle")}
            description={t("common.pageErrorDescription")}
            retry={t("common.retry")}
          >
            <DetailBody
              d={dealership}
              onClose={() => onOpenChange(false)}
              onNavigate={onNavigate}
              order={order}
              review={review}
            />
          </PageErrorBoundary>
        )}
      </DialogContent>
    </Dialog>
  );
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
  const reanalyzing = useAppStore((s) => s.analyzingIds.includes(d.id));
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

  // A review run opens each location where its open point is checked: the
  // boundary and the aerial image are on the site tab.
  const reasons = reviewReasons(t, d, dealerships, parameters);
  const reviewOpen = inReview && !isReviewCurrent(d);
  const reviewTab: DetailTab =
    reasons.includes("boundary") || reasons.includes("imagery")
      ? "site"
      : "overview";
  const reviewTabRef = useRef(reviewTab);
  reviewTabRef.current = reviewTab;
  // An old image is checked in the image history, so a review opens it.
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyRef = useRef<HTMLDivElement>(null);
  const reviewImageryRef = useRef(false);
  reviewImageryRef.current = reviewOpen && reasons.includes("imagery");
  useEffect(() => {
    if (inReview) setTab(reviewTabRef.current);
    setHistoryOpen(reviewImageryRef.current);
  }, [d.id, inReview]);
  function showImageryHistory(): void {
    setTab("site");
    setHistoryOpen(true);
    // After the site tab and the opened section are rendered.
    requestAnimationFrame(() =>
      historyRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      }),
    );
  }

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
    showImageryHistory,
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
      if (path) toastExported(t, "dashboard.detailDialog.reportSaved", path);
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
  const ealBasis = hasEalBasis(d);
  const rank = portfolioRank(d, dealerships);
  const boundary = d.boundary;
  // The review strip explains the open points itself; the list below keeps
  // the notices it does not cover.
  const stripNotices = reviewOpen
    ? attention.filter((item) => (reasons as string[]).includes(item.key))
    : [];
  const notices = attention.filter((item) => !stripNotices.includes(item));
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
              disabled={reanalyzing}
              onClick={() => void reanalyze(d.id)}
            >
              <RefreshCw
                className={cn("size-3.5", reanalyzing && "animate-spin")}
              />
              {t(
                reanalyzing
                  ? "dashboard.detailDialog.reanalyzing"
                  : "map.page.reanalyze",
              )}
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
        {reanalyzing && (
          <p
            role="status"
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <Loader2 className="size-3 animate-spin" />
            {t("dashboard.detailDialog.reanalyzingHint")}
          </p>
        )}
      </DialogHeader>

      {review && inReview && onNavigate && (
        <div className="shrink-0 px-6 pt-3">
          <ReviewStrip
            d={d}
            run={review}
            onNavigate={onNavigate}
            onSkip={() => step(1)}
            notices={stripNotices}
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
            value={
              d.risk && !ealBasis ? (
                <NoEalBadge className="text-xs" />
              ) : (
                eur(d.risk?.eal)
              )
            }
            // Never a bare amount: the figure is an estimate wherever the
            // dialog is read, not only on the risk tab.
            hint={
              d.risk && !ealBasis
                ? t("dashboard.detailDialog.kpiNoRank")
                : rank != null
                  ? `${t("dashboard.detailDialog.kpiEstimate")} · ${t("dashboard.detailDialog.kpiRank", rank)}`
                  : d.risk
                    ? t("dashboard.detailDialog.kpiEstimate")
                    : undefined
            }
          />
          <KeyFigure
            label={t("common.vehicles")}
            value={
              vehicles != null &&
              isAreaEstimatedDetection(d.detection) &&
              vehicleSource !== "manual"
                ? `≈${num(vehicles)}`
                : num(vehicles ?? undefined)
            }
            hint={vehicleHint(t, vehicleSource, d.detection, i18n.language)}
          />
          <KeyFigure
            label={t("dashboard.detailDialog.kpiExposure")}
            value={eur(d.risk?.exposureEur)}
            hint={
              exposureSource(d.detection, d.assetValue) === "declared"
                ? t("dashboard.detailDialog.kpiExposureDeclared")
                : d.risk?.exposureEur != null &&
                    vehicles != null &&
                    vehicles > 0
                  ? t("dashboard.detailDialog.kpiExposurePerVehicle", {
                      value: eur(
                        Math.round(d.risk.exposureEur / vehicles / 100) * 100,
                      ),
                    })
                  : undefined
            }
          />
        </div>

        {notices.length > 0 && (
          <div className="space-y-1">
            {notices.map((item) => (
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
            {/* How far the result can be trusted belongs next to it. */}
            <ChallengeSection d={d} />
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                {t("dashboard.detailDialog.contextGroup")}
              </p>
              <HailHistorySection d={d} />
              <RadarHailSection d={d} />
            </div>
          </TabsContent>

          <TabsContent value="site" className="space-y-4 pt-2">
            <BoundaryPanel
              d={d}
              onEditOnMap={() => showOnMap(true)}
              inReview={reviewOpen}
            />
            <Separator />
            <VehiclePanel d={d} />
            <DetectionImageryNote detection={d.detection} />
            <div className="space-y-2">
              <div ref={historyRef} className="scroll-mt-12">
                <Disclosure
                  title={t("dashboard.detailDialog.imageryHistoryToggle")}
                  open={historyOpen}
                  onOpenChange={setHistoryOpen}
                >
                  <ImageryHistorySection d={d} onClose={onClose} />
                </Disclosure>
              </div>
              <SiteCheckSection d={d} />
            </div>
          </TabsContent>

          <TabsContent value="contract" className="space-y-4 pt-2">
            <NotesSection d={d} />
            {/* An AI draft ends up in the notes, so it is offered here;
                the row only exists with an AI provider. */}
            <EvidenceMemoSection d={d} />
            <PortfolioMetaSection d={d} />
            <WebsiteRow
              d={d}
              detectedWebsite={osmDetails?.website}
              detecting={osmLoading}
            />
            <OsmDetailsSection details={osmDetails} loading={false} />
            <Disclosure title={t("questionnaire.title")}>
              <QuestionnaireSection d={d} />
            </Disclosure>
          </TabsContent>

          <TabsContent value="sources" className="space-y-4 pt-2">
            {/* What was done here comes first: it is asked for most. */}
            <HistorySection d={d} />
            <ModelConfidenceSummary d={d} />
            <NatCatSection d={d} />
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
