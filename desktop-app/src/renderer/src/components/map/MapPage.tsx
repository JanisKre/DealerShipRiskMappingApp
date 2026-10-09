import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, useMap, useMapEvents } from "./leaflet-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import "@geoman-io/leaflet-geoman-free";
import {
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
} from "@shared/risk-math";
import { EmptyState } from "@renderer/components/common/EmptyState";
import { PortfolioFilterBar } from "@renderer/components/dashboard/PortfolioFilterBar";
import { Button } from "@renderer/components/ui/button";
import { useAppStore } from "@renderer/store/appStore";
import { useFilteredDealerships } from "@renderer/lib/useFilteredDealerships";
import {
  useImagerySelection,
  type MapViewPoint,
} from "@renderer/lib/useImagerySelection";
import {
  STATE_DOP_SERVICES,
  stateTileTemplate,
  tileBboxEpsg3857,
} from "@shared/imagery-sources";
import { useMapStore, type Basemap } from "@renderer/store/mapStore";
import { AccumulationClusterLayer } from "./AccumulationClusterLayer";
import { BoundaryLayer } from "./BoundaryLayer";
import { ClusteredMarkers } from "./ClusteredMarkers";
import { DetectionOverlay, type DetectionEditDraft } from "./DetectionOverlay";
import { HailstormScenarioLayer } from "./HailstormScenarioLayer";
import { LayerPanel } from "./LayerPanel";
import { MapLegend } from "./MapLegend";
import { MultiPerilOverlay } from "./MultiPerilOverlay";
import { NearbyInsuredLayer } from "./NearbyInsuredLayer";
import { OverlayLegend } from "./OverlayLegend";
import { ViewPersistence } from "./ViewPersistence";

/** Tile URLs per basemap type. */
const TILE_URLS: Record<Basemap, string> = {
  satellite:
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  streets: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  light: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  terrain: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
};

/** Tile attributions per basemap type, translated. */
function tileAttributions(t: TFunction): Record<Basemap, string> {
  const osm = t("map.page.attributionOsm");
  return {
    satellite: "&copy; Esri World Imagery",
    streets: `&copy; ${osm}`,
    light: `&copy; ${osm} &copy; CARTO`,
    dark: `&copy; ${osm} &copy; CARTO`,
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

/** Reports the map centre + zoom once on mount and after every pan/zoom. */
function MapViewReporter({
  onChange,
}: Readonly<{ onChange: (view: MapViewPoint) => void }>): null {
  const map = useMapEvents({ moveend: () => report() });
  function report(): void {
    const c = map.getCenter();
    onChange({
      lat: c.lat,
      lon: c.lng,
      zoom: Math.min(BASEMAP_MAX_ZOOM, Math.round(map.getZoom())),
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

/** Zoom control as shadcn buttons instead of the default Leaflet control. */
function ZoomControl(): React.JSX.Element {
  const { t } = useTranslation();
  const map = useMap();
  return (
    <div className="glass absolute left-3 top-3 z-[1000] flex flex-col overflow-hidden rounded-md border shadow-lg">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 rounded-none"
        onClick={() => map.zoomIn()}
        title={t("map.page.zoomIn")}
        aria-label={t("map.page.zoomIn")}
      >
        <Plus className="size-4" />
      </Button>
      <div className="h-px bg-border" />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 rounded-none"
        onClick={() => map.zoomOut()}
        title={t("map.page.zoomOut")}
        aria-label={t("map.page.zoomOut")}
      >
        <Minus className="size-4" />
      </Button>
    </div>
  );
}

interface ContextMenuState {
  dealership: AnalyzedDealership;
  x: number;
  y: number;
}

/** Right-click context menu for a marker: reanalyze or delete. */
function MarkerContextMenu({
  state,
  onClose,
  onReanalyze,
  onDelete,
}: Readonly<{
  state: ContextMenuState;
  onClose: () => void;
  onReanalyze: (id: string) => void;
  onDelete: (id: string) => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  useEffect(() => {
    function onDocMouseDown(): void {
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
      className="glass fixed z-[2000] min-w-40 overflow-hidden rounded-md border py-1 shadow-lg"
      style={{ left: state.x, top: state.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <p className="truncate px-3 py-1 text-xs font-medium text-muted-foreground">
        {state.dealership.name}
      </p>
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
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
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
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

export function MapPage(): React.JSX.Element {
  const { t } = useTranslation();
  // Portfolio state
  const dealerships = useAppStore((s) => s.dealerships);
  const parameters = useAppStore((s) => s.parameters);
  const scenario = useAppStore((s) => s.scenario);
  const setScenario = useAppStore((s) => s.setScenario);
  const selectedId = useAppStore((s) => s.selectedId);
  const select = useAppStore((s) => s.select);
  const lastAddedIds = useAppStore((s) => s.lastAddedIds);
  const analyzingIds = useAppStore((s) => s.analyzingIds);
  const analyzing = useAppStore((s) => s.analyzing);
  const progress = useAppStore((s) => s.progress);
  const analysisErrors = useAppStore((s) => s.analysisErrors);
  const cancelAnalysis = useAppStore((s) => s.cancelAnalysis);
  const pendingBoundaryDetectionIds = useAppStore(
    (s) => s.pendingBoundaryDetectionIds,
  );
  const detectionUpdateIds = useAppStore((s) => s.detectionUpdateIds);
  const detectionUpdateErrors = useAppStore((s) => s.detectionUpdateErrors);
  const boundaryEditIds = useAppStore((s) => s.boundaryEditIds);
  const boundaryHistory = useAppStore((s) => s.boundaryHistory);
  const updateDetectionForBoundary = useAppStore(
    (s) => s.updateDetectionForBoundary,
  );
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
  const perilOverlay = useMapStore((s) => s.perilOverlay);
  const editing = useMapStore((s) => s.editing);
  const setEditing = useMapStore((s) => s.setEditing);
  const setLayers = useMapStore((s) => s.setLayers);
  const detectionEditing = useMapStore((s) => s.detectionEditing);
  const setDetectionEditing = useMapStore((s) => s.setDetectionEditing);
  const openDetailDialog = useMapStore((s) => s.openDetailDialog);

  const [drawingScenario, setDrawingScenario] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [boundaryWarningDismissed, setBoundaryWarningDismissed] =
    useState(false);
  const [modelWarningDismissed, setModelWarningDismissed] = useState(false);
  const [detectionEditId, setDetectionEditId] = useState<string | null>(null);
  const [detectionDraft, setDetectionDraft] =
    useState<DetectionEditDraft | null>(null);

  const [mapView, setMapView] = useState<MapViewPoint | null>(null);
  const imagery = useImagerySelection(mapView, basemap === "satellite");

  // WMS URL from settings (only for the satellite basemap).
  const [wmsUrl, setWmsUrl] = useState<string | null>(null);
  useEffect(() => {
    window.api.getSettings().then((s) => {
      if (
        s.satelliteProvider === "wms" &&
        s.wmsTileUrl &&
        s.wmsTileUrl.includes("{")
      ) {
        setWmsUrl(s.wmsTileUrl);
      }
    });
  }, []);

  const withCoords = useMemo(
    () => dealerships.filter((d) => d.lat != null && d.lon != null),
    [dealerships],
  );

  // Active portfolio filters (sub-portfolio/partner/group/cluster).
  const portfolioFiltered = useFilteredDealerships(withCoords);

  const visibleDealerships = portfolioFiltered;

  // Surface every low-confidence/estimated boundary, not only synthetic buffers.
  // This makes regional source gaps and weak OSM matches visible to the underwriter.
  const boundaryReviewCount = useMemo(
    () => withCoords.filter((d) => d.boundary?.reviewRequired).length,
    [withCoords],
  );

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

  function startBoundaryEditing(): void {
    if (detectionEditing) cancelDetectionEditing();
    setLayers({ boundaries: true });
    setEditing(true);
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
      peril: scenario?.peril ?? "hail",
      returnPeriodYears: scenario?.returnPeriodYears ?? 100,
      exposureMultiplier: scenario?.exposureMultiplier ?? 1,
      modelVersion: scenario?.modelVersion ?? "scenario-screening-0.2.0",
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
        | { x: number; y: number; width: number; height: number }
        | undefined;
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
      await window.api.captureMap(rect, mode);
    } finally {
      setCapturing(false);
    }
  }

  // Tile URL for the active basemap. Satellite follows the per-location
  // imagery choice (state orthophoto or Esri); a custom WMS overrides both.
  let tileUrl = TILE_URLS[basemap];
  let tileAttribution = tileAttributions(t)[basemap];
  if (basemap === "satellite") {
    const chosen = imagery?.chosen;
    const service =
      chosen?.kind === "state-dop" && chosen.state
        ? STATE_DOP_SERVICES[chosen.state]
        : undefined;
    if (wmsUrl) {
      tileUrl = wmsUrl;
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

  if (withCoords.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
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
        <MapViewReporter onChange={setMapView} />
        <ZoomControl />

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
        {perilOverlay && (
          <MultiPerilOverlay
            dealerships={visibleDealerships}
            peril={perilOverlay}
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

      {/* Status banner top center: analysis progress + data quality hints (stacked) */}
      <div className="absolute left-1/2 top-3 z-[1000] flex -translate-x-1/2 flex-col items-center gap-2">
        {detectionEditing && detectionDraft && detectionReviewDealership && (
          <div className="glass flex max-w-[min(94vw,44rem)] flex-wrap items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm shadow-lg">
            <ScanSearch className="size-4 shrink-0 text-primary" />
            <span>
              {t("map.page.detectionReviewSummary", {
                machine: detectionReviewDealership.detection?.vehicleCount ?? 0,
                added: detectionDraft.manualVehiclePoints.length,
                removed: detectionDraft.manualVehicleRemovedPoints.length,
                total: detectionDraft.manualVehicleCount,
              })}
            </span>
          </div>
        )}
        {boundaryEditIds.map((id) => {
          const dealership = dealerships.find((d) => d.id === id);
          if (!dealership) return null;
          const hasHistory = (boundaryHistory[id]?.length ?? 0) > 0;
          const hasDefault = dealership.boundaryBeforeManualEdit != null;
          const busy = detectionUpdateIds.includes(id);
          return (
            <div
              key={`edit-${id}`}
              className="glass flex max-w-[min(94vw,44rem)] flex-wrap items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm shadow-lg"
            >
              <Save className="size-4 shrink-0 text-primary" />
              <span>
                {t("map.page.boundaryEditedPrompt", { name: dealership.name })}
              </span>
              <Button
                type="button"
                size="sm"
                onClick={() => void saveBoundaryEdit(id)}
                disabled={busy}
                title={t("map.page.saveBoundaryEdit")}
              >
                <Save />
                {t("map.page.saveBoundaryEdit")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void undoBoundaryEdit(id)}
                disabled={!hasHistory || busy}
                title={t("map.page.undoBoundaryEdit")}
              >
                <Undo2 />
                {t("map.page.undoBoundaryEdit")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void revertBoundaryToDefault(id)}
                disabled={!hasDefault || busy}
                title={t("map.page.revertBoundaryDefault")}
              >
                <RotateCcw />
                {t("map.page.revertBoundaryDefault")}
              </Button>
            </div>
          );
        })}

        {pendingBoundaryDetectionIds.map((id) => {
          const dealership = dealerships.find((d) => d.id === id);
          if (!dealership) return null;
          const updating = detectionUpdateIds.includes(id);
          const error = detectionUpdateErrors[id];
          return (
            <div
              key={id}
              className="glass flex max-w-[min(90vw,34rem)] flex-wrap items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm shadow-lg"
            >
              <ScanSearch className="size-4 shrink-0 text-primary" />
              <span>
                {t("map.page.boundaryDetectionPrompt", {
                  name: dealership.name,
                })}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={updating}
                onClick={() => void updateDetectionForBoundary(id)}
              >
                {updating ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <RefreshCw />
                )}
                {t("map.page.updateCarDetection")}
              </Button>
              {error && (
                <span className="basis-full text-center text-xs text-destructive">
                  {error}
                </span>
              )}
            </div>
          );
        })}

        {analyzing && progress && progress.total > 0 && (
          <div className="glass flex w-[min(94vw,26rem)] items-center gap-3 rounded-lg border px-3 py-2 text-sm shadow-lg">
            <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="whitespace-nowrap font-medium tabular-nums">
                  {t("map.page.analyzingProgress", {
                    done: progress.done,
                    total: progress.total,
                  })}
                </span>
                <span className="truncate text-xs text-muted-foreground tabular-nums">
                  {remainingLabel(t, progress)}
                </span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{
                    width: `${(progress.done / progress.total) * 100}%`,
                  }}
                />
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="shrink-0"
              onClick={cancelAnalysis}
              title={t("map.page.cancelAnalysis")}
            >
              <Square />
              {t("map.page.cancelAnalysis")}
            </Button>
          </div>
        )}

        {!analyzing && Object.keys(analysisErrors).length > 0 && (
          <div className="glass flex items-center gap-2 rounded-full border border-destructive/40 px-3 py-1.5 text-sm shadow-lg">
            <TriangleAlert className="size-4 shrink-0 text-destructive" />
            {t("map.page.analysisErrors", {
              count: Object.keys(analysisErrors).length,
            })}
          </div>
        )}

        {!analyzing && !boundaryWarningDismissed && boundaryReviewCount > 0 && (
          <div className="glass flex max-w-[min(94vw,36rem)] items-start gap-2 rounded-lg border px-3 py-2 text-sm shadow-lg">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
            <div className="min-w-0 space-y-1">
              <div className="font-medium">
                {t("map.page.boundaryWarning", {
                  count: boundaryReviewCount,
                  total: withCoords.length,
                })}
              </div>
              <p className="text-xs leading-snug text-muted-foreground">
                {t("map.page.boundaryWarningHint")}
              </p>
              {!editing && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={startBoundaryEditing}
                >
                  <Pencil className="size-3" />
                  {t("map.layerPanel.editBoundariesButton")}
                </Button>
              )}
            </div>
            <button
              type="button"
              className="shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => setBoundaryWarningDismissed(true)}
              title={t("map.page.dismissHint")}
              aria-label={t("map.page.dismissHint")}
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}

        {!analyzing && !modelWarningDismissed && stubDetectionCount > 0 && (
          <div className="glass flex max-w-[min(82vw,32rem)] items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-snug shadow-lg">
            <TriangleAlert className="size-4 shrink-0 text-amber-500" />
            <span className="min-w-0">
              {t("map.page.detectionWarning", {
                count: stubDetectionCount,
                total: withCoords.length,
              })}
            </span>
            <button
              type="button"
              className="shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => setModelWarningDismissed(true)}
              title={t("map.page.dismissHint")}
              aria-label={t("map.page.dismissHint")}
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}

        {layers.accumulationClusters &&
          visibleDealerships.length > 0 &&
          accumulationClusterCount === 0 && (
            <div className="glass flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm shadow-lg">
              <Info className="size-4 shrink-0 text-muted-foreground" />
              <span>
                {t("map.page.noClustersInfo", {
                  radius: parameters.accumulationRadiusKm,
                })}
              </span>
            </div>
          )}
      </div>

      {/* Layer control bottom right, collapsible */}
      <div className="absolute bottom-6 right-3 z-[1000] w-60">
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
        />
      </div>

      {/* Legend + overlay scale bottom left */}
      <div className="absolute bottom-6 left-3 z-[1000] flex flex-col gap-2">
        <PortfolioFilterBar dealerships={withCoords} />
        <OverlayLegend
          perilOverlay={perilOverlay}
          showClusters={layers.accumulationClusters}
        />
        <MapLegend imagery={imagery} showImagery={basemap === "satellite"} />
      </div>

      {contextMenu && (
        <MarkerContextMenu
          state={contextMenu}
          onClose={() => setContextMenu(null)}
          onReanalyze={reanalyzeDealership}
          onDelete={removeDealership}
        />
      )}
    </div>
  );
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
