import { useDismissedHint } from "@renderer/lib/dismissedHints";
import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer } from "./leaflet-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import L from "leaflet";
import "@geoman-io/leaflet-geoman-free";
import { ArrowRight, Loader2, MapPinned } from "lucide-react";
import type { AnalyzedDealership } from "@shared/types";
import { computeAccumulationClusters } from "@shared/risk-math";
import { EmptyState } from "@renderer/components/common/EmptyState";
import { Button } from "@renderer/components/ui/button";
import { useModelAvailable } from "@renderer/lib/useModelAvailable";
import { useAppStore } from "@renderer/store/appStore";
import { useFilteredDealerships } from "@renderer/lib/useFilteredDealerships";
import type { MapViewPoint } from "@renderer/lib/useImagerySelection";
import { useMapStore } from "@renderer/store/mapStore";
import { AccumulationClusterLayer } from "./AccumulationClusterLayer";
import { BoundaryLayer } from "./BoundaryLayer";
import { CadastreLayer } from "./CadastreLayer";
import { ClusteredMarkers } from "./ClusteredMarkers";
import { DetectionOverlay } from "./DetectionOverlay";
import { HailstormScenarioLayer } from "./HailstormScenarioLayer";
import { HailEventReplayLayer } from "./HailEventReplayLayer";
import { HailEventCard } from "./HailEventCard";
import { HailZoneLayer } from "./HailZoneLayer";
import { LayerPanel } from "./LayerPanel";
import { DeleteSelectedDialog } from "./LocationsPanel";
import { MapLegend } from "./MapLegend";
import { legendPresence, type ViewBounds } from "@renderer/lib/legendPresence";
import { NearbyInsuredLayer } from "./NearbyInsuredLayer";
import { ViewPersistence } from "./ViewPersistence";
import {
  boundaryReviewQueue,
  geometryBounds,
  withSelected,
} from "./mapSelection";
import {
  isTextEntry,
  isUndoShortcut,
  undoShortcutTarget,
} from "@renderer/lib/boundaryUndo";
import { BASEMAP_MAX_ZOOM, TILE_TEMPLATE_OPTIONS } from "./basemapTiles";
import {
  FitBounds,
  GeomanLanguage,
  MapResizer,
  MapViewReporter,
  ZoomControl,
  type FitRequest,
} from "./mapControls";
import { MarkerContextMenu, type ContextMenuState } from "./MarkerContextMenu";
import {
  AnalysisErrorNotice,
  AnalysisProgressNotice,
  BoundaryEditingNotice,
  BoundaryEditNotices,
  BoundaryReviewHint,
  DetectionModelHint,
  DetectionReviewNotice,
  NoClustersHint,
  PausedReviewNotice,
  ResumeAnalysisNotice,
} from "./MapNotices";
import { useDetectionEditing } from "./useDetectionEditing";
import { useMapExport } from "./useMapExport";
import { useMapImagery } from "./useMapImagery";

// Geoman works on opted-in layers only (`pmIgnore: false`): the map and the
// boundary polygons. Otherwise its global edit mode made every vector layer
// editable — thousands of hail-zone polygons froze the app, and location pins
// became draggable — and snapping scanned all of them on every move.
L.PM?.setOptIn(true);

export function MapPage(): React.JSX.Element {
  const { t } = useTranslation();
  // Portfolio state
  const dealerships = useAppStore((s) => s.dealerships);
  const parameters = useAppStore((s) => s.parameters);
  const scenario = useAppStore((s) => s.scenario);
  const selectedId = useAppStore((s) => s.selectedId);
  const select = useAppStore((s) => s.select);
  const lastAddedIds = useAppStore((s) => s.lastAddedIds);
  const analyzingIds = useAppStore((s) => s.analyzingIds);
  const analyzing = useAppStore((s) => s.analyzing);
  const [resumeDismissed, setResumeDismissed] = useState(false);
  const detectionUpdateIds = useAppStore((s) => s.detectionUpdateIds);
  const boundaryEditIds = useAppStore((s) => s.boundaryEditIds);
  const boundaryHistory = useAppStore((s) => s.boundaryHistory);
  const confirmBoundary = useAppStore((s) => s.confirmBoundary);
  const undoBoundaryEdit = useAppStore((s) => s.undoBoundaryEdit);
  const removeDealership = useAppStore((s) => s.removeDealership);
  const reanalyzeDealership = useAppStore((s) => s.reanalyzeDealership);

  // Map UI state (persisted) — only what MapPage itself still renders
  const layers = useMapStore((s) => s.layers);
  const basemap = useMapStore((s) => s.basemap);
  const editing = useMapStore((s) => s.editing);
  const setEditing = useMapStore((s) => s.setEditing);
  const setLayers = useMapStore((s) => s.setLayers);
  const detectionEditing = useMapStore((s) => s.detectionEditing);
  const openDetailDialog = useMapStore((s) => s.openDetailDialog);

  const { capturing, exportMap } = useMapExport(t);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AnalyzedDealership | null>(
    null,
  );
  const sessionId = useAppStore((s) => s.sessionId);
  const [boundaryWarningDismissed, setBoundaryWarningDismissed] =
    useDismissedHint(sessionId, "boundaryReview");
  const [modelWarningDismissed, setModelWarningDismissed] = useDismissedHint(
    sessionId,
    "detectionModel",
  );
  const [hintIndex, setHintIndex] = useState(0);
  const [errorsDismissed, setErrorsDismissed] = useState(false);
  const [clustersInfoDismissed, setClustersInfoDismissed] = useState(false);

  const [fitRequest, setFitRequest] = useState<FitRequest | null>(null);
  const [mapView, setMapView] = useState<MapViewPoint | null>(null);
  const [viewBounds, setViewBounds] = useState<ViewBounds | null>(null);

  const withCoords = useMemo(
    () => dealerships.filter((d) => d.lat != null && d.lon != null),
    [dealerships],
  );

  // Active portfolio filters (sub-portfolio/partner/group/cluster).
  const portfolioFiltered = useFilteredDealerships(withCoords);

  // The selected site stays on the map even when a filter hides it.
  const visibleDealerships = useMemo(
    () => withSelected(portfolioFiltered, withCoords, selectedId),
    [portfolioFiltered, withCoords, selectedId],
  );

  // What the locations in view show, so the legend can grey out the rest.
  const presence = useMemo(
    () =>
      legendPresence(visibleDealerships, {
        bounds: viewBounds,
        zoom: mapView?.zoom ?? 0,
        selectedId,
        layers,
      }),
    [visibleDealerships, viewBounds, mapView?.zoom, selectedId, layers],
  );

  // Surface every low-confidence/estimated boundary, not only synthetic buffers.
  // This makes regional source gaps and weak OSM matches visible to the underwriter.
  // Only the sites the filters show: the review must not ask about hidden ones.
  const boundaryReviewIds = useMemo(
    () => boundaryReviewQueue(portfolioFiltered),
    [portfolioFiltered],
  );
  const boundaryReviewCount = boundaryReviewIds.length;
  // Fallback circles among them: the least reliable kind, named on their own.
  const fallbackReviewCount = useMemo(
    () =>
      portfolioFiltered.filter(
        (d) => d.boundary?.reviewRequired && d.boundary.source === "synthetic",
      ).length,
    [portfolioFiltered],
  );
  const fallbackFilterActive = useAppStore(
    (s) => s.filters.boundarySource === "fallback",
  );
  const setFilters = useAppStore((s) => s.setFilters);

  // Ctrl+Z / ⌘Z steps a boundary edit back, like the Undo button.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!isUndoShortcut(e) || isTextEntry(e.target)) return;
      const id = undoShortcutTarget(
        selectedId,
        boundaryEditIds,
        boundaryHistory,
      );
      if (!id || detectionUpdateIds.includes(id)) return;
      e.preventDefault();
      void undoBoundaryEdit(id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    selectedId,
    boundaryEditIds,
    boundaryHistory,
    detectionUpdateIds,
    undoBoundaryEdit,
  ]);
  // The location the review banner talks about: the selected one, when it
  // needs a check.
  const reviewTarget =
    selectedId && boundaryReviewIds.includes(selectedId)
      ? (withCoords.find((d) => d.id === selectedId) ?? null)
      : null;
  // Turning the cluster layer on again shows its "no clusters" note again.
  useEffect(() => {
    if (!layers.accumulationClusters) setClustersInfoDismissed(false);
  }, [layers.accumulationClusters]);
  // A new batch brings new errors to read.
  useEffect(() => {
    if (analyzing) setErrorsDismissed(false);
  }, [analyzing]);

  // Locations whose vehicle count is only estimated because no ONNX model
  // is available (StubVehicleDetector) — otherwise placeholder values would be mistaken for real detections.
  const stubDetectionIds = useMemo(
    () =>
      withCoords
        .filter((d) => d.detection?.model === "stub-area-heuristic")
        .map((d) => d.id),
    [withCoords],
  );
  const modelAvailable = useModelAvailable();
  const pendingAnalysis = useAppStore((s) => s.pendingAnalysis);
  const reanalyzeDealerships = useAppStore((s) => s.reanalyzeDealerships);

  // Same calculation as in AccumulationClusterLayer — just to detect
  // whether the layer is active but empty (e.g. only 1 location in the portfolio),
  // so that it doesn't look like a rendering bug.
  const accumulationClusterCount = useMemo(
    () =>
      computeAccumulationClusters(
        visibleDealerships,
        parameters.accumulationRadiusKm,
        parameters,
      ).filter((c) => c.count > 1).length,
    [visibleDealerships, parameters],
  );

  const center: [number, number] =
    withCoords.length > 0
      ? [withCoords[0].lat, withCoords[0].lon]
      : [51.0, 10.0];

  // Selected subject for the neighborhood/accumulation view.
  const selectedDealership = useMemo(
    () => withCoords.find((d) => d.id === selectedId) ?? null,
    [withCoords, selectedId],
  );

  const imagery = useMapImagery({
    t,
    basemap,
    mapView,
    detectionsShown: layers.detections,
    selected: selectedDealership,
  });
  const detectionReview = useDetectionEditing(withCoords, selectedId);

  /**
   * Edits the boundaries; from the review notice the map first fits the
   * site's boundary, so its vertex handles do not pile up at a far zoom.
   */
  function startBoundaryEditing(target?: AnalyzedDealership | null): void {
    if (detectionEditing) detectionReview.cancel();
    setLayers({ boundaries: true });
    setEditing(true);
    const bounds = target?.boundary
      ? geometryBounds(target.boundary.polygon)
      : null;
    if (bounds) setFitRequest({ bounds });
  }

  // However editing starts (detail dialog, layer panel, review notice), the
  // map frames the selected lot, so its handles are not a heap of dots.
  const selectedBoundary = selectedDealership?.boundary?.polygon;
  useEffect(() => {
    if (!editing || !selectedBoundary) return;
    const bounds = geometryBounds(selectedBoundary);
    if (bounds) setFitRequest({ bounds });
    // Only when editing starts or another site is selected meanwhile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, selectedId]);

  // Keys of the review notice: ↵ confirms and moves on, E corrects, N skips.
  const reviewKeysActive =
    !analyzing &&
    !editing &&
    !detectionEditing &&
    !boundaryWarningDismissed &&
    reviewTarget != null;
  useEffect(() => {
    if (!reviewKeysActive || !reviewTarget) return;
    const target = reviewTarget;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.altKey || e.ctrlKey || e.metaKey || isTextEntry(e.target)) return;
      // A dialog or menu on top owns the keyboard.
      if (document.querySelector("[role=dialog],[role=menu]")) return;
      // Enter on a focused button already clicks it.
      if (e.target instanceof HTMLButtonElement) return;
      if (e.key === "Enter") void confirmAndContinue(target.id);
      else if (e.key === "e" || e.key === "E") startBoundaryEditing(target);
      else if (e.key === "n" || e.key === "N") reviewNextBoundary();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  /** Selects (and flies to) the next location whose boundary needs a check. */
  function reviewNextBoundary(): void {
    if (boundaryReviewIds.length === 0) return;
    const current = selectedId ? boundaryReviewIds.indexOf(selectedId) : -1;
    select(boundaryReviewIds[(current + 1) % boundaryReviewIds.length]);
  }

  async function confirmAndContinue(id: string): Promise<void> {
    await confirmBoundary(id);
    const remaining = boundaryReviewIds.filter((other) => other !== id);
    if (remaining.length > 0) select(remaining[0]);
  }

  // Passive hints share one slot with "1 von N" paging instead of stacking
  // over half the map; dismissing one is remembered per portfolio (UW-14).
  const passiveHints = [
    // First: without the model every count and EAL is only a placeholder,
    // which matters more than any single boundary.
    !analyzing &&
      !editing &&
      !modelWarningDismissed &&
      stubDetectionIds.length > 0 && (
        <DetectionModelHint
          count={stubDetectionIds.length}
          total={withCoords.length}
          modelAvailable={modelAvailable === true}
          onReanalyze={() => void reanalyzeDealerships(stubDetectionIds)}
          onDismiss={() => setModelWarningDismissed(true)}
        />
      ),
    !analyzing &&
      !editing &&
      !boundaryWarningDismissed &&
      boundaryReviewCount > 0 && (
        <BoundaryReviewHint
          count={boundaryReviewCount}
          fallbackCount={fallbackReviewCount}
          target={reviewTarget}
          position={
            reviewTarget ? boundaryReviewIds.indexOf(reviewTarget.id) + 1 : 0
          }
          fallbackFilterActive={fallbackFilterActive}
          onConfirm={(id) => void confirmAndContinue(id)}
          onCorrect={startBoundaryEditing}
          onNext={reviewNextBoundary}
          onShowFallback={() => setFilters({ boundarySource: "fallback" })}
          onDismiss={() => setBoundaryWarningDismissed(true)}
        />
      ),
    layers.accumulationClusters &&
      !editing &&
      !clustersInfoDismissed &&
      visibleDealerships.length > 0 &&
      accumulationClusterCount === 0 && (
        <NoClustersHint
          radiusKm={parameters.accumulationRadiusKm}
          onDismiss={() => setClustersInfoDismissed(true)}
        />
      ),
  ].filter((hint): hint is React.JSX.Element => Boolean(hint));
  const hintPosition =
    passiveHints.length > 0 ? hintIndex % passiveHints.length : 0;

  const errorNotice = (
    <AnalysisErrorNotice
      dismissed={errorsDismissed}
      onDismiss={() => setErrorsDismissed(true)}
    />
  );
  const resumeNotice = (
    <ResumeAnalysisNotice
      dismissed={resumeDismissed}
      onDismiss={() => setResumeDismissed(true)}
    />
  );

  if (withCoords.length === 0) {
    // Only while the batch runs; a stopped one has the resume notice.
    const pendingCount = analyzing ? pendingAnalysis.length : 0;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
        {/* Progress and "Stop" before the first row reaches the map too. */}
        <AnalysisProgressNotice />
        {errorNotice}
        {resumeNotice}
        {/* Imported rows still being located are no "empty" portfolio. */}
        {pendingCount > 0 ? (
          <EmptyState
            icon={Loader2}
            title={t("map.page.locatingTitle", { count: pendingCount })}
            description={t("map.page.locatingDescription")}
            className="bg-card/50 [&_svg]:animate-spin"
          />
        ) : (
          <EmptyState
            icon={MapPinned}
            title={t("map.page.emptyTitle")}
            description={t("map.page.emptyDescription")}
            className="bg-card/50"
          />
        )}
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={center}
        zoom={10}
        // Explicit limits: Leaflet otherwise derives them from the layers
        // present and jumps the zoom when the basemap is swapped while only
        // an overlay with a narrower range (parcels, from z17) is left.
        minZoom={0}
        maxZoom={BASEMAP_MAX_ZOOM}
        zoomControl={false}
        pmIgnore={false}
        className="h-full w-full"
      >
        <TileLayer
          // Only the basemap kind remounts the layer; a new imagery source
          // or attribution is handed over inside it without blanking the map.
          key={basemap}
          attribution={imagery.tileAttribution}
          url={imagery.tileUrl}
          maxZoom={BASEMAP_MAX_ZOOM}
          maxNativeZoom={imagery.tileMaxNativeZoom}
          ancestorFallback
          opacity={1}
          {...TILE_TEMPLATE_OPTIONS}
        />
        <MapResizer />
        <GeomanLanguage />
        <FitBounds request={fitRequest} />
        <MapViewReporter onChange={setMapView} onBounds={setViewBounds} />
        <ZoomControl />

        {layers.parcels && (
          <CadastreLayer
            bounds={viewBounds}
            overImagery={basemap === "satellite"}
          />
        )}
        {layers.hailZones && <HailZoneLayer />}
        {layers.accumulationClusters && (
          <AccumulationClusterLayer dealerships={visibleDealerships} />
        )}
        {layers.nearbyInsured && (
          <NearbyInsuredLayer
            subject={selectedDealership}
            dealerships={withCoords}
            radiusKm={parameters.accumulationRadiusKm}
          />
        )}
        {layers.boundaries && (
          <BoundaryLayer dealerships={visibleDealerships} editable={editing} />
        )}
        {layers.detections && (
          <DetectionOverlay
            dealerships={visibleDealerships}
            selectedId={selectedId}
            editable={detectionEditing && detectionReview.editId === selectedId}
            draft={
              detectionReview.editId === selectedId
                ? detectionReview.draft
                : null
            }
            onDraftChange={detectionReview.setDraft}
          />
        )}

        <HailEventReplayLayer />

        <HailstormScenarioLayer scenario={scenario} />

        {/* Risk-colored markers with clustering (replaces the old <Marker>) */}
        <ClusteredMarkers
          dealerships={visibleDealerships}
          selectedId={selectedId}
          analyzingIds={analyzingIds}
          onSelect={select}
          onOpenDetails={(id) => {
            select(id);
            openDetailDialog(id);
          }}
          onConfirmBoundary={(id) => void confirmBoundary(id)}
          onContextMenu={(d, point) =>
            setContextMenu({ dealership: d, x: point.x, y: point.y })
          }
        />

        {/* View persistence, keyboard navigation */}
        <ViewPersistence
          dealerships={withCoords}
          selectedId={selectedId}
          lastAddedIds={lastAddedIds}
          onSelect={select}
        />
      </MapContainer>

      {/* Status banner top center: analysis progress + data quality hints,
          stacked; at most about half the map high, scrolling beyond that. */}
      <div className="pointer-events-none absolute inset-x-0 top-3 z-[1000] flex max-h-[55%] flex-col items-center gap-2 overflow-y-auto px-14 pb-2 [&>*]:pointer-events-auto [&>*]:shrink-0">
        {detectionEditing &&
          detectionReview.draft &&
          detectionReview.reviewed && (
            <DetectionReviewNotice
              dealership={detectionReview.reviewed}
              draft={detectionReview.draft}
            />
          )}
        <BoundaryEditNotices />
        <AnalysisProgressNotice />

        {errorNotice}
        {resumeNotice}

        <PausedReviewNotice />
        <BoundaryEditingNotice />

        {passiveHints[hintPosition]}
        {passiveHints.length > 1 && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-6 text-xs shadow-sm"
            onClick={() => setHintIndex((i) => i + 1)}
          >
            {t("map.page.nextHint", {
              current: hintPosition + 1,
              total: passiveHints.length,
            })}
            <ArrowRight className="size-3" />
          </Button>
        )}
      </div>

      {/* Hail simulation: the playing storm and its impact, right of the
          zoom control and clear of the layer panel on the right. */}
      <div className="pointer-events-none absolute bottom-24 left-16 top-3 z-[1001] flex w-[min(30rem,calc(100%-21rem))] min-w-72 flex-col items-stretch gap-2 [&>*]:pointer-events-auto">
        <HailEventCard />
      </div>

      {/* Legend (left) and layer control (right) share one bottom bar: as
          separate absolutely positioned boxes they overlapped on narrow
          maps. Each shrinks to half the width at most and opens upwards,
          stopping below the zoom control. */}
      <div className="pointer-events-none absolute inset-x-3 bottom-6 top-24 z-[1000] flex items-end justify-between gap-2">
        <div className="flex max-h-full min-h-0 w-64 min-w-0 shrink flex-col justify-end">
          <MapLegend
            present={presence}
            showClusterNote={layers.accumulationClusters}
            imagery={imagery.shownImagery}
            showImagery={basemap === "satellite"}
          />
        </div>
        <div className="flex max-h-full min-h-0 w-60 min-w-0 shrink flex-col justify-end">
          <LayerPanel
            capturing={capturing}
            onExport={exportMap}
            selectedId={selectedId}
            detectionEditing={detectionEditing}
            onStartDetectionEditing={detectionReview.start}
            onSaveDetectionEdits={() => void detectionReview.save()}
            onCancelDetectionEdits={detectionReview.cancel}
            imageryTimeline={imagery.timeline}
            imageryTimelineLoading={imagery.timelineLoading}
            imageryTimelineAvailable={imagery.timelineAvailable}
            countedImagery={imagery.countedCandidate}
            autoImagery={imagery.autoImagery}
          />
        </div>
      </div>

      {contextMenu && (
        <MarkerContextMenu
          state={contextMenu}
          onClose={() => setContextMenu(null)}
          onDetails={(id) => {
            select(id);
            openDetailDialog(id);
          }}
          onReanalyze={reanalyzeDealership}
          onDelete={(id) =>
            setPendingDelete(dealerships.find((d) => d.id === id) ?? null)
          }
        />
      )}
      {/* Same confirmation as deleting from the locations list. */}
      <DeleteSelectedDialog
        open={pendingDelete != null}
        count={1}
        name={pendingDelete?.name}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        onConfirm={() => {
          if (pendingDelete) {
            removeDealership(pendingDelete.id);
            toast.success(
              t("map.locationsPanel.deleteSelectedToast", { count: 1 }),
            );
          }
          setPendingDelete(null);
        }}
      />
    </div>
  );
}
