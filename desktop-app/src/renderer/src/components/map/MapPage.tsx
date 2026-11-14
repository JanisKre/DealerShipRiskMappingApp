import { useEffect, useMemo, useRef, useState } from "react";
import { SCENARIO_MODEL_VERSION } from "./ScenarioFromSentence";
import { MapContainer, TileLayer, useMap, useMapEvents } from "./leaflet-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { toast } from "sonner";
import L from "leaflet";
import "@geoman-io/leaflet-geoman-free";
import {
  ArrowRight,
  Check,
  ClipboardCheck,
  Filter,
  Info,
  Loader2,
  MapPinned,
  Minus,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  ScanSearch,
  Save,
  ScanEye,
  Square,
  Trash2,
  TriangleAlert,
  Undo2,
  X,
} from "lucide-react";
import type { AnalyzedDealership } from "@shared/types";
import {
  computeAccumulationClusters,
  effectiveVehicleCount,
  haversineKm,
} from "@shared/risk-math";
import { EmptyState } from "@renderer/components/common/EmptyState";
import { Button } from "@renderer/components/ui/button";
import { HintButton } from "@renderer/components/ui/hint-button";
import { Progress } from "@renderer/components/ui/progress";
import { cn } from "@renderer/lib/utils";
import { useNavigate } from "react-router-dom";
import { usePausedReview } from "@renderer/components/dashboard/reviewRunStore";
import { unanalyzedInputs, useAppStore } from "@renderer/store/appStore";
import { useFilteredDealerships } from "@renderer/lib/useFilteredDealerships";
import {
  useImagerySelection,
  type MapViewPoint,
} from "@renderer/lib/useImagerySelection";
import { useImageryTimeline } from "@renderer/lib/useImageryTimeline";
import { validateTileTemplate } from "@shared/tile-template";
import {
  IMAGERY_MIN_SELECTION_ZOOM,
  IMAGERY_TOLERANCE_DAYS,
  STATE_DOP_SERVICES,
  stateTileTemplate,
  tileBboxEpsg3857,
  type ImageryCandidate,
  type ImagerySelection,
} from "@shared/imagery-sources";
import {
  WAYBACK_ATTRIBUTION,
  waybackCandidateForVersion,
  waybackTileTemplate,
} from "@shared/imagery-wayback";
import { useMapStore, type Basemap } from "@renderer/store/mapStore";
import { AccumulationClusterLayer } from "./AccumulationClusterLayer";
import { BoundaryLayer } from "./BoundaryLayer";
import { CadastreLayer } from "./CadastreLayer";
import { ClusteredMarkers } from "./ClusteredMarkers";
import { DetectionOverlay, type DetectionEditDraft } from "./DetectionOverlay";
import { HailstormScenarioLayer } from "./HailstormScenarioLayer";
import { HailEventReplayLayer } from "./HailEventReplayLayer";
import { HailReplayBar } from "./HailReplayBar";
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

// Geoman works on opted-in layers only (`pmIgnore: false`): the map and the
// boundary polygons. Otherwise its global edit mode made every vector layer
// editable — thousands of hail-zone polygons froze the app, and location pins
// became draggable — and snapping scanned all of them on every move.
L.PM?.setOptIn(true);

/** Geoman's own languages that the app's UI languages map to. */
const GEOMAN_LANGS = new Set(["de", "en", "fr"]);

/** Tile URLs per basemap type. */
const TILE_URLS: Record<Basemap, string> = {
  satellite:
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  // basemap.de Web Raster (BKG/AdV): the official German topographic map,
  // built from ALKIS buildings, so it lines up with the parcel overlay.
  // Germany only; elsewhere the tiles are empty.
  official:
    "https://sgx.geodatenzentrum.de/wmts_basemapde/tile/1.0.0/de_basemapde_web_raster_farbe/default/GLOBAL_WEBMERCATOR/{z}/{y}/{x}.png",
  streets: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  terrain: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
};

/** Tile attributions per basemap type, translated. */
function tileAttributions(t: TFunction): Record<Basemap, string> {
  const osm = t("map.page.attributionOsm");
  return {
    satellite: "&copy; Esri World Imagery",
    official: `&copy; GeoBasis-DE / BKG (${new Date().getFullYear()}) CC BY 4.0`,
    streets: `&copy; ${osm}`,
    terrain: `&copy; ${osm}, SRTM; &copy; OpenTopoMap`,
  };
}

/**
 * Leaflet fills template keys from layer options and calls function values
 * with the tile coords — this resolves the `{bbox-epsg-3857}` placeholder of
 * WMS templates (state orthophotos, custom WMS) per tile.
 */
const BBOX_TEMPLATE_OPTION = {
  "bbox-epsg-3857": (d: { x: number; y: number; z: number }) =>
    tileBboxEpsg3857(d.z, d.x, d.y).join(","),
};

/** Max zoom of the base TileLayer; imagery metadata is resolved at the level actually drawn. */
const BASEMAP_MAX_ZOOM = 19;

/**
 * Reports the map centre + zoom, and the visible area, once on mount and
 * after every pan/zoom.
 */
function MapViewReporter({
  onChange,
  onBounds,
}: Readonly<{
  onChange: (view: MapViewPoint) => void;
  onBounds: (bounds: ViewBounds) => void;
}>): null {
  const map = useMapEvents({ moveend: () => report() });
  function report(): void {
    const c = map.getCenter();
    onChange({
      lat: c.lat,
      lon: c.lng,
      zoom: Math.min(BASEMAP_MAX_ZOOM, Math.round(map.getZoom())),
    });
    const b = map.getBounds();
    onBounds({
      south: b.getSouth(),
      west: b.getWest(),
      north: b.getNorth(),
      east: b.getEast(),
    });
  }
  useEffect(report, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Calls map.invalidateSize() when the container changes — fixes white areas on panel resize. */
function MapResizer(): null {
  const map = useMap();
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);
  return null;
}

/** Geoman's draw and edit tooltips follow the UI language. */
function GeomanLanguage(): null {
  const { i18n } = useTranslation();
  const map = useMap();
  const lang = i18n.language.slice(0, 2);
  useEffect(() => {
    map.pm?.setLang(GEOMAN_LANGS.has(lang) ? (lang as "de") : "en");
  }, [map, lang]);
  return null;
}

/** Fits the map to the requested bounds whenever a new request comes in. */
function FitBounds({
  request,
}: Readonly<{ request: FitRequest | null }>): null {
  const map = useMap();
  useEffect(() => {
    if (!request) return;
    // Extra room at the top, where the notices stack over the map.
    map.fitBounds(request.bounds, {
      paddingTopLeft: [48, 160],
      paddingBottomRight: [48, 48],
      maxZoom: 19,
    });
  }, [map, request]);
  return null;
}

interface FitRequest {
  bounds: [[number, number], [number, number]];
}

/** Zoom control as shadcn buttons instead of the default Leaflet control. */
function ZoomControl(): React.JSX.Element {
  const { t } = useTranslation();
  const map = useMap();
  return (
    <div className="absolute left-3 top-3 z-[1000] flex flex-col overflow-hidden rounded-md border bg-card shadow-lg">
      <HintButton
        type="button"
        variant="ghost"
        size="icon"
        side="right"
        className="size-8 rounded-none"
        onClick={() => map.zoomIn()}
        aria-label={t("map.page.zoomIn")}
      >
        <Plus className="size-4" />
      </HintButton>
      <div className="h-px bg-border" />
      <HintButton
        type="button"
        variant="ghost"
        size="icon"
        side="right"
        className="size-8 rounded-none"
        onClick={() => map.zoomOut()}
        aria-label={t("map.page.zoomOut")}
      >
        <Minus className="size-4" />
      </HintButton>
    </div>
  );
}

interface ContextMenuState {
  dealership: AnalyzedDealership;
  x: number;
  y: number;
}

/** Right-click context menu for a marker: details, reanalyze or delete. */
function MarkerContextMenu({
  state,
  onClose,
  onDetails,
  onReanalyze,
  onDelete,
}: Readonly<{
  state: ContextMenuState;
  onClose: () => void;
  onDetails: (id: string) => void;
  onReanalyze: (id: string) => void;
  onDelete: (id: string) => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDocMouseDown(e: MouseEvent): void {
      // A press inside the menu belongs to its buttons.
      if (menuRef.current?.contains(e.target as Node)) return;
      onClose();
    }
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="fixed z-[2000] min-w-40 max-w-64 overflow-hidden rounded-md border bg-popover py-1 text-popover-foreground shadow-lg"
      ref={menuRef}
      style={{ left: state.x, top: state.y }}
    >
      <p
        className="truncate px-3 py-1 text-xs font-medium text-muted-foreground"
        title={state.dealership.name}
      >
        {state.dealership.name}
      </p>
      <button
        type="button"
        className={MENU_ITEM_CLASS}
        onClick={() => {
          onDetails(state.dealership.id);
          onClose();
        }}
      >
        <Info className="size-3.5" />
        {t("map.page.details")}
      </button>
      <button
        type="button"
        className={MENU_ITEM_CLASS}
        onClick={() => {
          onReanalyze(state.dealership.id);
          onClose();
        }}
      >
        <RefreshCw className="size-3.5" />
        {t("map.page.reanalyze")}
      </button>
      <button
        type="button"
        className={cn(
          MENU_ITEM_CLASS,
          "text-destructive hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10",
        )}
        onClick={() => {
          onDelete(state.dealership.id);
          onClose();
        }}
      >
        <Trash2 className="size-3.5" />
        {t("map.page.delete")}
      </button>
    </div>
  );
}

const MENU_ITEM_CLASS =
  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-none";

export function MapPage(): React.JSX.Element {
  const { t } = useTranslation();
  // Portfolio state
  const dealerships = useAppStore((s) => s.dealerships);
  const parameters = useAppStore((s) => s.parameters);
  const scenario = useAppStore((s) => s.scenario);
  const setScenario = useAppStore((s) => s.setScenario);
  const selectedId = useAppStore((s) => s.selectedId);
  const select = useAppStore((s) => s.select);
  const navigate = useNavigate();
  const lastAddedIds = useAppStore((s) => s.lastAddedIds);
  const analyzingIds = useAppStore((s) => s.analyzingIds);
  const analyzing = useAppStore((s) => s.analyzing);
  const progress = useAppStore((s) => s.progress);
  const analysisErrors = useAppStore((s) => s.analysisErrors);
  const failedInputs = useAppStore((s) => s.failedInputs);
  const retryFailedAnalyses = useAppStore((s) => s.retryFailedAnalyses);
  const resumeAnalysis = useAppStore((s) => s.resumeAnalysis);
  const discardPendingAnalysis = useAppStore((s) => s.discardPendingAnalysis);
  const unanalyzedCount = useAppStore((s) => unanalyzedInputs(s).length);
  const [resumeDismissed, setResumeDismissed] = useState(false);
  const cancelAnalysis = useAppStore((s) => s.cancelAnalysis);
  // Stopping waits for the locations in flight; say so right away.
  const cancelRequested = useAppStore((s) => s.analysisCancelRequested);
  const detectionUpdateIds = useAppStore((s) => s.detectionUpdateIds);
  const detectionUpdateErrors = useAppStore((s) => s.detectionUpdateErrors);
  const boundaryEditIds = useAppStore((s) => s.boundaryEditIds);
  const boundaryHistory = useAppStore((s) => s.boundaryHistory);
  const saveBoundaryEdit = useAppStore((s) => s.saveBoundaryEdit);
  const confirmBoundary = useAppStore((s) => s.confirmBoundary);
  const undoBoundaryEdit = useAppStore((s) => s.undoBoundaryEdit);
  const revertBoundaryToDefault = useAppStore((s) => s.revertBoundaryToDefault);
  const removeDealership = useAppStore((s) => s.removeDealership);
  const reanalyzeDealership = useAppStore((s) => s.reanalyzeDealership);
  const saveManualVehicleDetection = useAppStore(
    (s) => s.saveManualVehicleDetection,
  );

  // Map UI state (persisted) — only what MapPage itself still renders
  const layers = useMapStore((s) => s.layers);
  const basemap = useMapStore((s) => s.basemap);
  const editing = useMapStore((s) => s.editing);
  const setEditing = useMapStore((s) => s.setEditing);
  // A dashboard review run paused for a boundary correction here.
  const pausedReviewId = usePausedReview((s) => s.resumeId);
  const setLayers = useMapStore((s) => s.setLayers);
  const detectionEditing = useMapStore((s) => s.detectionEditing);
  const setDetectionEditing = useMapStore((s) => s.setDetectionEditing);
  const openDetailDialog = useMapStore((s) => s.openDetailDialog);

  const [drawingScenario, setDrawingScenario] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AnalyzedDealership | null>(
    null,
  );
  const [boundaryWarningDismissed, setBoundaryWarningDismissed] =
    useState(false);
  const [modelWarningDismissed, setModelWarningDismissed] = useState(false);
  const [errorsDismissed, setErrorsDismissed] = useState(false);
  const [clustersInfoDismissed, setClustersInfoDismissed] = useState(false);
  const [detectionEditId, setDetectionEditId] = useState<string | null>(null);
  const [detectionDraft, setDetectionDraft] =
    useState<DetectionEditDraft | null>(null);

  const [fitRequest, setFitRequest] = useState<FitRequest | null>(null);
  const [mapView, setMapView] = useState<MapViewPoint | null>(null);
  const [viewBounds, setViewBounds] = useState<ViewBounds | null>(null);
  const { selection: resolvedImagery, loading: imageryLoading } =
    useImagerySelection(mapView, basemap === "satellite");
  // A state orthophoto only covers its own state. Zoomed out past a single
  // state the national source (Esri) is used right away, without waiting for
  // the selection of the new view or keeping a stale state choice.
  const stateImageryAllowed =
    (mapView?.zoom ?? 0) >= IMAGERY_MIN_SELECTION_ZOOM;
  const imagery =
    resolvedImagery?.chosen.kind === "state-dop" && !stateImageryAllowed
      ? null
      : resolvedImagery;
  const pinnedWayback = useMapStore((s) => s.pinnedWayback);
  const useCountedImage = useMapStore((s) => s.useCountedImage);

  // WMS URL from settings (only for the satellite basemap).
  const [wmsUrl, setWmsUrl] = useState<string | null>(null);
  useEffect(() => {
    window.api.getSettings().then((s) => {
      if (s.satelliteProvider === "wms" && s.wmsTileUrl) {
        const check = validateTileTemplate(s.wmsTileUrl);
        if (check.ok) setWmsUrl(check.template);
      }
    });
  }, []);

  // Wayback history at the map centre — only where a location-level choice
  // makes sense (same zoom floor as the automatic selection) and no custom
  // WMS replaces Esri.
  const timelineEnabled =
    basemap === "satellite" &&
    !wmsUrl &&
    mapView != null &&
    mapView.zoom >= IMAGERY_MIN_SELECTION_ZOOM;
  const { timeline: imageryTimeline, loading: imageryTimelineLoading } =
    useImageryTimeline(mapView, timelineEnabled);

  // While a version is pinned, the legend describes that version's image at
  // the map centre instead of the automatic choice.
  // A timeline that still belongs to the previous view is not used: it would
  // show the capture date of another place.
  const pinnedCandidate: ImageryCandidate | null = !pinnedWayback
    ? null
    : ((imageryTimeline && !imageryTimelineLoading
        ? waybackCandidateForVersion(imageryTimeline.candidates, pinnedWayback)
        : null) ??
      (imageryTimelineLoading
        ? null
        : // Outside the resolved timeline (overview zoom, older than the
          // listed versions): the version is known, its image date is not.
          {
            id: `wayback:${pinnedWayback.release}`,
            kind: "esri-wayback",
            label: `Esri Wayback ${pinnedWayback.publishedAt}`,
            capturedAt: null,
            dateSource: "none",
            resolutionM: null,
            zoom: mapView?.zoom ?? 0,
            attribution: WAYBACK_ATTRIBUTION,
            wayback: pinnedWayback,
          }));
  const legendImagery: ImagerySelection | null =
    basemap === "satellite" && pinnedWayback && !wmsUrl
      ? pinnedCandidate
        ? {
            mode: imagery?.mode ?? "auto",
            chosen: pinnedCandidate,
            reason: "pinned-version",
            candidates: [pinnedCandidate, ...(imagery?.candidates ?? [])],
            toleranceDays: imagery?.toleranceDays ?? IMAGERY_TOLERANCE_DAYS,
            resolvedAt: imagery?.resolvedAt ?? new Date().toISOString(),
          }
        : null
      : // The kept selection of the previous view still draws the basemap, but
        // it does not describe the map centre any more.
        imageryLoading
        ? null
        : imagery;

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
  const nameOf = (id: string): string =>
    dealerships.find((d) => d.id === id)?.name ?? failedInputs[id]?.name ?? id;
  const analyzingNames = analyzingIds.map(nameOf);
  const failedNames = Object.keys(analysisErrors).map(nameOf);
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
  const stubDetectionCount = useMemo(
    () =>
      withCoords.filter((d) => d.detection?.model === "stub-area-heuristic")
        .length,
    [withCoords],
  );

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

  // Only while the selected site is in view: its counted image says nothing
  // about a place the user has panned away to (the legend and the version
  // list describe the map centre).
  const siteInView =
    selectedDealership != null &&
    mapView != null &&
    haversineKm(
      mapView.lat,
      mapView.lon,
      selectedDealership.lat,
      selectedDealership.lon,
    ) *
      1000 <=
      metersPerPixel(mapView.lat, mapView.zoom) * SITE_IN_VIEW_PX;

  // The image the selected site's vehicles were counted on, when it is a
  // source the map can draw (a state orthophoto only where one is allowed).
  const countedAvailable =
    basemap === "satellite" && !wmsUrl && layers.detections && siteInView
      ? (selectedDealership?.detection?.imagery ?? null)
      : null;
  const countedCandidate =
    countedAvailable &&
    ((countedAvailable.chosen.kind === "state-dop" && stateImageryAllowed) ||
      countedAvailable.chosen.kind === "esri-wayback")
      ? countedAvailable.chosen
      : null;
  // Shown instead of the automatic choice (unless the user pinned a version,
  // set a WMS or switched it off in the version list), so the dots sit on the
  // cars they were counted from.
  const countedActive =
    countedCandidate != null && useCountedImage && !pinnedWayback;
  const countedSelection = countedActive ? countedAvailable : null;
  const countedOn = countedActive ? countedCandidate : null;
  const shownImagery = countedOn ? countedSelection : legendImagery;
  const detectionReviewDealership = useMemo(
    () => withCoords.find((d) => d.id === detectionEditId) ?? null,
    [withCoords, detectionEditId],
  );

  function startDetectionEditing(): void {
    const dealership = withCoords.find((d) => d.id === selectedId);
    if (!dealership?.detection) return;
    setDetectionEditId(dealership.id);
    setDetectionDraft({
      manualVehicleCount: effectiveVehicleCount(dealership.detection),
      manualVehiclePoints: [
        ...(dealership.detection.manualVehiclePoints ?? []),
      ],
      manualVehicleRemovedPoints: [
        ...(dealership.detection.manualVehicleRemovedPoints ?? []),
      ],
    });
    setEditing(false);
    setDetectionEditing(true);
  }

  /**
   * Edits the boundaries; from the review notice the map first fits the
   * site's boundary, so its vertex handles do not pile up at a far zoom.
   */
  function startBoundaryEditing(target?: AnalyzedDealership | null): void {
    if (detectionEditing) cancelDetectionEditing();
    setLayers({ boundaries: true });
    setEditing(true);
    const bounds = target?.boundary
      ? geometryBounds(target.boundary.polygon)
      : null;
    if (bounds) setFitRequest({ bounds });
  }

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

  function cancelDetectionEditing(): void {
    setDetectionEditing(false);
    setDetectionEditId(null);
    setDetectionDraft(null);
  }

  async function saveDetectionEdits(): Promise<void> {
    if (!detectionEditId || !detectionDraft) return;
    try {
      await saveManualVehicleDetection(
        detectionEditId,
        detectionDraft.manualVehicleCount,
        detectionDraft.manualVehiclePoints,
        detectionDraft.manualVehicleRemovedPoints,
      );
      setDetectionEditing(false);
      setDetectionEditId(null);
      setDetectionDraft(null);
    } catch (error) {
      console.error("Saving manual vehicle review failed:", error);
    }
  }

  useEffect(() => {
    if (detectionEditing && detectionEditId && selectedId !== detectionEditId) {
      setDetectionEditing(false);
      setDetectionEditId(null);
      setDetectionDraft(null);
    }
  }, [detectionEditing, detectionEditId, selectedId, setDetectionEditing]);

  function onScenarioPath(path: [number, number][]): void {
    setScenario({
      id: scenario?.id ?? crypto.randomUUID(),
      name: scenario?.name ?? t("map.page.defaultScenarioName"),
      pathCoordinates: path,
      widthKm: scenario?.widthKm ?? 20,
      intensityLevel: scenario?.intensityLevel ?? "HIGH",
      returnPeriodYears: scenario?.returnPeriodYears ?? 100,
      exposureMultiplier: scenario?.exposureMultiplier ?? 1,
      modelVersion: scenario?.modelVersion ?? SCENARIO_MODEL_VERSION,
    });
    setDrawingScenario(false);
  }

  /** Export the map as PNG or copy it to the clipboard. */
  async function exportMap(mode: "save" | "clipboard"): Promise<void> {
    setCapturing(true);
    try {
      const el = document.querySelector(
        ".leaflet-container",
      ) as HTMLElement | null;
      let rect:
        { x: number; y: number; width: number; height: number } | undefined;
      if (el) {
        const r = el.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        rect = {
          x: Math.round(r.left * dpr),
          y: Math.round(r.top * dpr),
          width: Math.round(r.width * dpr),
          height: Math.round(r.height * dpr),
        };
      }
      const result = await window.api.captureMap(rect, mode);
      if (mode === "clipboard" && result.ok)
        toast.success(t("map.page.mapCopied"));
      else if (mode === "save" && result.path)
        toast.success(t("map.page.mapSaved"), { description: result.path });
    } catch (error) {
      console.warn("Map capture failed:", error);
      toast.error(
        t(
          mode === "clipboard"
            ? "map.page.mapCopyFailed"
            : "map.page.mapSaveFailed",
        ),
      );
    } finally {
      setCapturing(false);
    }
  }

  // Tile URL for the active basemap. Satellite follows the per-location
  // imagery choice (state orthophoto or Esri); a custom WMS overrides both.
  // With vehicles shown for a selected site, the map shows the image the
  // vehicles were counted on: dots drawn over a different capture (another
  // year, another provider's registration) land on roofs and empty stalls.
  let tileUrl = TILE_URLS[basemap];
  let tileAttribution = tileAttributions(t)[basemap];
  if (basemap === "satellite") {
    const chosen = imagery?.chosen;
    const service =
      chosen?.kind === "state-dop" && chosen.state
        ? STATE_DOP_SERVICES[chosen.state]
        : undefined;
    const countedService =
      countedOn?.kind === "state-dop" && countedOn.state
        ? STATE_DOP_SERVICES[countedOn.state]
        : undefined;
    if (wmsUrl) {
      tileUrl = wmsUrl;
    } else if (pinnedWayback) {
      tileUrl = waybackTileTemplate(pinnedWayback.release);
      tileAttribution = `&copy; ${(pinnedCandidate?.attribution ?? WAYBACK_ATTRIBUTION).replace(/^© /, "")}`;
    } else if (countedService && countedOn) {
      tileUrl = stateTileTemplate(countedService);
      tileAttribution = countedOn.attribution;
    } else if (countedOn?.kind === "esri-wayback" && countedOn.wayback) {
      tileUrl = waybackTileTemplate(countedOn.wayback.release);
      tileAttribution = `&copy; ${countedOn.attribution.replace(/^© /, "")}`;
    } else if (service && chosen) {
      tileUrl = stateTileTemplate(service);
      tileAttribution = chosen.attribution;
    } else if (chosen?.kind === "esri") {
      tileAttribution = `&copy; ${chosen.attribution.replace(/^© /, "")}`;
    }
  }
  const tileOpacity = 1;
  // OpenTopoMap publishes native tiles only through z17. Leaflet may still
  // zoom farther, but must upscale z17 instead of requesting the provider's
  // conspicuous "max zoom / layer = 17" error tiles.
  const tileMaxNativeZoom = basemap === "terrain" ? 17 : undefined;

  // Shown on the map and on the empty state: when every imported row fails,
  // nothing reaches the map, and this is the only way back.
  const errorNotice =
    !analyzing && !errorsDismissed && Object.keys(analysisErrors).length > 0 ? (
      <div className={cn(NOTICE_CLASS, "border-destructive/40")}>
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="font-medium">
            {t("map.page.analysisErrors", {
              count: Object.keys(analysisErrors).length,
            })}
          </div>
          <p className="line-clamp-2 break-words text-xs text-muted-foreground">
            {failedNames.join(" · ")}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => void retryFailedAnalyses()}
          >
            <RefreshCw className="size-3" />
            {t("map.page.retryAnalysis")}
          </Button>
        </div>
        <DismissButton
          label={t("map.page.dismissHint")}
          onClick={() => setErrorsDismissed(true)}
        />
      </div>
    ) : null;

  // An import that was interrupted (app closed or crashed): resume it.
  const resumeNotice =
    !analyzing &&
    !resumeDismissed &&
    unanalyzedCount > 0 &&
    Object.keys(analysisErrors).length === 0 ? (
      <div className={NOTICE_CLASS}>
        <RefreshCw className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="font-medium">
            {t("map.page.resumeTitle", { count: unanalyzedCount })}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("map.page.resumeDetail")}
          </p>
          <div className="flex gap-1.5">
            <Button
              type="button"
              size="sm"
              className="h-7 text-xs"
              onClick={() => void resumeAnalysis()}
            >
              {t("map.page.resumeAction")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => {
                discardPendingAnalysis();
                setResumeDismissed(true);
              }}
            >
              {t("map.page.resumeDiscard")}
            </Button>
          </div>
        </div>
      </div>
    ) : null;

  if (withCoords.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
        {errorNotice}
        {resumeNotice}
        <EmptyState
          icon={MapPinned}
          title={t("map.page.emptyTitle")}
          description={t("map.page.emptyDescription")}
          className="bg-card/50"
        />
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={center}
        zoom={10}
        zoomControl={false}
        pmIgnore={false}
        className="h-full w-full"
      >
        <TileLayer
          key={`${basemap}-${tileUrl}-${tileAttribution}`}
          attribution={tileAttribution}
          url={tileUrl}
          maxZoom={BASEMAP_MAX_ZOOM}
          maxNativeZoom={tileMaxNativeZoom}
          opacity={tileOpacity}
          {...BBOX_TEMPLATE_OPTION}
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
            editable={detectionEditing && detectionEditId === selectedId}
            draft={detectionEditId === selectedId ? detectionDraft : null}
            onDraftChange={setDetectionDraft}
          />
        )}

        <HailEventReplayLayer />

        <HailstormScenarioLayer
          scenario={scenario}
          drawing={drawingScenario}
          onPath={onScenarioPath}
        />

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
        {/* Hail event replay: play, time slider, running count. */}
        <HailReplayBar />
        {detectionEditing && detectionDraft && detectionReviewDealership && (
          <div className={NOTICE_CLASS}>
            <ScanSearch className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1 space-y-1">
              <div
                className="truncate font-medium"
                title={detectionReviewDealership.name}
              >
                {detectionReviewDealership.name}
              </div>
              <p className="text-xs leading-snug text-muted-foreground">
                {t("map.page.detectionReviewSummary", {
                  machine:
                    detectionReviewDealership.detection?.vehicleCount ?? 0,
                  added: detectionDraft.manualVehiclePoints.length,
                  removed: detectionDraft.manualVehicleRemovedPoints.length,
                  total: detectionDraft.manualVehicleCount,
                })}
              </p>
            </div>
          </div>
        )}
        {boundaryEditIds.map((id) => {
          const dealership = dealerships.find((d) => d.id === id);
          if (!dealership) return null;
          const hasHistory = (boundaryHistory[id]?.length ?? 0) > 0;
          const hasDefault = dealership.boundaryBeforeManualEdit != null;
          const busy = detectionUpdateIds.includes(id);
          return (
            <div key={`edit-${id}`} className={NOTICE_CLASS}>
              <Save className="mt-0.5 size-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="line-clamp-2 break-words font-medium">
                  {t("map.page.boundaryEditedPrompt", {
                    name: dealership.name,
                  })}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => void saveBoundaryEdit(id)}
                    disabled={busy}
                  >
                    {busy ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Save className="size-3" />
                    )}
                    {t("map.page.saveBoundaryEdit")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => void undoBoundaryEdit(id)}
                    disabled={!hasHistory || busy}
                    title={t("map.page.undoBoundaryEditShortcut")}
                    aria-keyshortcuts="Control+Z Meta+Z"
                  >
                    <Undo2 className="size-3" />
                    {t("map.page.undoBoundaryEdit")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => void revertBoundaryToDefault(id)}
                    disabled={!hasDefault || busy}
                  >
                    <RotateCcw className="size-3" />
                    {t("map.page.revertBoundaryDefault")}
                  </Button>
                </div>
                {detectionUpdateErrors[id] && (
                  <p className="text-xs text-destructive">
                    {detectionUpdateErrors[id]}
                  </p>
                )}
              </div>
            </div>
          );
        })}

        {analyzing && progress && progress.total > 0 && (
          <div className={NOTICE_CLASS}>
            <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" />
            <div className="min-w-0 flex-1 space-y-1.5">
              {/* Announced politely to screen readers as the count moves. */}
              <div
                role="status"
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5"
              >
                <span className="whitespace-nowrap font-medium tabular-nums">
                  {t("map.page.analyzingProgress", {
                    done: progress.done,
                    total: progress.total,
                  })}
                </span>
                <span className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                  {remainingLabel(t, progress)}
                </span>
              </div>
              {analyzingNames.length > 0 && (
                <p className="truncate text-xs text-muted-foreground">
                  {analyzingNames.join(" · ")}
                </p>
              )}
              <Progress
                value={(progress.done / progress.total) * 100}
                className="h-1"
                aria-label={t("map.page.analyzingProgress", {
                  done: progress.done,
                  total: progress.total,
                })}
              />
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 shrink-0 text-xs"
              onClick={cancelAnalysis}
              disabled={cancelRequested}
            >
              {cancelRequested ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Square className="size-3" />
              )}
              {t(
                cancelRequested
                  ? "map.page.cancellingAnalysis"
                  : "map.page.cancelAnalysis",
              )}
            </Button>
          </div>
        )}

        {errorNotice}
        {resumeNotice}

        {pausedReviewId && !editing && boundaryEditIds.length === 0 && (
          <div className={NOTICE_CLASS}>
            <ClipboardCheck className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="font-medium">{t("review.pausedTitle")}</div>
              <p className="text-xs leading-snug text-muted-foreground">
                {t("review.pausedHint")}
              </p>
            </div>
            <div className="flex shrink-0 flex-col gap-1">
              <Button
                type="button"
                size="sm"
                className="h-7 text-xs"
                onClick={() => navigate("/dashboard")}
              >
                <ArrowRight className="size-3" />
                {t("review.resume")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => usePausedReview.getState().clear()}
              >
                {t("review.endRun")}
              </Button>
            </div>
          </div>
        )}

        {editing && boundaryEditIds.length === 0 && (
          <div className={NOTICE_CLASS}>
            <Pencil className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="font-medium">{t("map.page.editingTitle")}</div>
              <p className="text-xs leading-snug text-muted-foreground">
                {t("map.page.editingHint")}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              className="h-7 shrink-0 text-xs"
              onClick={() => setEditing(false)}
            >
              <Check className="size-3" />
              {t("map.page.editingDone")}
            </Button>
          </div>
        )}

        {!analyzing &&
          !editing &&
          !boundaryWarningDismissed &&
          boundaryReviewCount > 0 && (
            <div className={cn(NOTICE_CLASS, "border-warning/40")}>
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="font-medium">
                  {t("map.page.boundaryWarning", {
                    count: boundaryReviewCount,
                  })}
                </div>
                {fallbackReviewCount > 0 && (
                  <p className="text-xs leading-snug text-muted-foreground">
                    {t("map.page.fallbackBoundaries", {
                      count: fallbackReviewCount,
                    })}
                  </p>
                )}
                {reviewTarget ? (
                  <>
                    <p
                      className="line-clamp-3 break-words text-xs leading-snug text-muted-foreground"
                      title={reviewTarget.name}
                    >
                      {t("map.page.boundaryReviewQuestion", {
                        name: reviewTarget.name,
                        position:
                          boundaryReviewIds.indexOf(reviewTarget.id) + 1,
                        count: boundaryReviewCount,
                      })}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => void confirmAndContinue(reviewTarget.id)}
                      >
                        <Check className="size-3" />
                        {t("map.page.boundaryConfirm")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => startBoundaryEditing(reviewTarget)}
                      >
                        <Pencil className="size-3" />
                        {t("map.page.boundaryCorrect")}
                      </Button>
                      {boundaryReviewCount > 1 && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={reviewNextBoundary}
                        >
                          {t("map.page.boundaryNext")}
                          <ArrowRight className="size-3" />
                        </Button>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-xs leading-snug text-muted-foreground">
                      {t("map.page.boundaryWarningHint")}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={reviewNextBoundary}
                      >
                        {t("map.page.boundaryStartReview")}
                        <ArrowRight className="size-3" />
                      </Button>
                      {fallbackReviewCount > 0 && !fallbackFilterActive && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() =>
                            setFilters({ boundarySource: "fallback" })
                          }
                        >
                          <Filter className="size-3" />
                          {t("map.page.showFallbackBoundaries")}
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </div>
              <DismissButton
                label={t("map.page.dismissHint")}
                onClick={() => setBoundaryWarningDismissed(true)}
              />
            </div>
          )}

        {!analyzing && !modelWarningDismissed && stubDetectionCount > 0 && (
          <div className={cn(NOTICE_CLASS, "border-warning/40")}>
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="font-medium">
                {t("map.page.detectionWarning", {
                  count: stubDetectionCount,
                  total: withCoords.length,
                })}
              </div>
              <p className="text-xs leading-snug text-muted-foreground">
                {t("map.page.detectionWarningHint")}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => navigate("/settings?section=data")}
              >
                <ScanEye className="size-3" />
                {t("map.page.setupDetection")}
              </Button>
            </div>
            <DismissButton
              label={t("map.page.dismissHint")}
              onClick={() => setModelWarningDismissed(true)}
            />
          </div>
        )}

        {layers.accumulationClusters &&
          !clustersInfoDismissed &&
          visibleDealerships.length > 0 &&
          accumulationClusterCount === 0 && (
            <div className={NOTICE_CLASS}>
              <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <p className="min-w-0 flex-1 text-xs leading-snug text-muted-foreground">
                {t("map.page.noClustersInfo", {
                  radius: parameters.accumulationRadiusKm,
                })}
              </p>
              <DismissButton
                label={t("map.page.dismissHint")}
                onClick={() => setClustersInfoDismissed(true)}
              />
            </div>
          )}
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
            imagery={shownImagery}
            showImagery={basemap === "satellite"}
          />
        </div>
        <div className="flex max-h-full min-h-0 w-60 min-w-0 shrink flex-col justify-end">
          <LayerPanel
            drawing={drawingScenario}
            onToggleDraw={() => setDrawingScenario((d) => !d)}
            capturing={capturing}
            onExport={exportMap}
            selectedId={selectedId}
            detectionEditing={detectionEditing}
            onStartDetectionEditing={startDetectionEditing}
            onSaveDetectionEdits={() => void saveDetectionEdits()}
            onCancelDetectionEdits={cancelDetectionEditing}
            imageryTimeline={timelineEnabled ? imageryTimeline : null}
            imageryTimelineLoading={timelineEnabled && imageryTimelineLoading}
            imageryTimelineAvailable={basemap === "satellite" && !wmsUrl}
            countedImagery={countedCandidate}
            autoImagery={imageryLoading ? null : (imagery?.chosen ?? null)}
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

/**
 * Shared look of the status notices at the top of the map: opaque (they
 * stack over imagery and each other) and compact. Body text stays muted;
 * a warning only colours the icon and the border.
 */
const NOTICE_CLASS =
  "flex w-full max-w-[28rem] items-start gap-2.5 rounded-lg border bg-card px-3 py-2 text-sm shadow-lg";

function DismissButton({
  label,
  onClick,
}: Readonly<{ label: string; onClick: () => void }>): React.JSX.Element {
  return (
    <HintButton
      type="button"
      variant="ghost"
      size="icon"
      className="-mr-1.5 -mt-0.5 size-6 text-muted-foreground"
      onClick={onClick}
      aria-label={label}
    >
      <X className="size-3.5" />
    </HintButton>
  );
}

/**
 * A selected site this close to the map centre counts as "in view", and the
 * map keeps showing the image its vehicles were counted on. About one and a
 * half viewports: at half a viewport, an ordinary pan around the site switched
 * the basemap back and forth between the counted and the automatic image.
 */
const SITE_IN_VIEW_PX = 1500;

/** Ground size of one screen pixel in Web Mercator at the given latitude and zoom. */
function metersPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

/** Remaining-time estimate for a batch analysis, from the average so far. */
function remainingLabel(
  t: TFunction,
  progress: { done: number; total: number; startedAt: number },
): string {
  // The first results include warm-up (model load, cold caches); wait for a
  // few before extrapolating.
  if (progress.done < 3) return t("map.page.analyzingEstimating");
  const elapsed = Date.now() - progress.startedAt;
  const remainingMs =
    (elapsed / progress.done) * (progress.total - progress.done);
  const minutes = Math.max(1, Math.round(remainingMs / 60_000));
  const time =
    minutes < 60
      ? t("map.page.durationMinutes", { minutes })
      : t("map.page.durationHours", {
          hours: Math.floor(minutes / 60),
          minutes: minutes % 60,
        });
  return t("map.page.analyzingRemaining", { time });
}
