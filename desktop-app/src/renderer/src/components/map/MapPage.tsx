import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import "@geoman-io/leaflet-geoman-free";
import {
  Info,
  Loader2,
  MapPinned,
  Minus,
  Plus,
  RefreshCw,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import type { AnalyzedDealership } from "@shared/types";
import { ACCUMULATION_RADIUS_KM } from "@shared/constants";
import { computeAccumulationClusters } from "@shared/risk-math";
import { EmptyState } from "@renderer/components/common/EmptyState";
import { Button } from "@renderer/components/ui/button";
import { useAppStore } from "@renderer/store/appStore";
import { useFilteredDealerships } from "@renderer/lib/useFilteredDealerships";
import { useMapStore, type Basemap } from "@renderer/store/mapStore";
import { AccumulationClusterLayer } from "./AccumulationClusterLayer";
import { BoundaryLayer } from "./BoundaryLayer";
import { ClusteredMarkers } from "./ClusteredMarkers";
import { DetectionOverlay } from "./DetectionOverlay";
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
  const scenario = useAppStore((s) => s.scenario);
  const setScenario = useAppStore((s) => s.setScenario);
  const selectedId = useAppStore((s) => s.selectedId);
  const select = useAppStore((s) => s.select);
  const lastAddedIds = useAppStore((s) => s.lastAddedIds);
  const analyzingIds = useAppStore((s) => s.analyzingIds);
  const analyzing = useAppStore((s) => s.analyzing);
  const progress = useAppStore((s) => s.progress);
  const removeDealership = useAppStore((s) => s.removeDealership);
  const reanalyzeDealership = useAppStore((s) => s.reanalyzeDealership);

  // Map UI state (persisted) — only what MapPage itself still renders
  const layers = useMapStore((s) => s.layers);
  const basemap = useMapStore((s) => s.basemap);
  const satelliteOpacity = useMapStore((s) => s.satelliteOpacity);
  const perilOverlay = useMapStore((s) => s.perilOverlay);
  const editing = useMapStore((s) => s.editing);
  const openDetailDialog = useMapStore((s) => s.openDetailDialog);

  const [drawingScenario, setDrawingScenario] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [boundaryWarningDismissed, setBoundaryWarningDismissed] =
    useState(false);
  const [modelWarningDismissed, setModelWarningDismissed] = useState(false);

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

  // Locations whose boundary could not be detected (estimated buffer only) —
  // makes silent quality loss visible instead of only showing it via the legend color.
  const syntheticBoundaryCount = useMemo(
    () => withCoords.filter((d) => d.boundary?.source === "synthetic").length,
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
      computeAccumulationClusters(visibleDealerships, ACCUMULATION_RADIUS_KM)
        .filter((c) => c.count > 1).length,
    [visibleDealerships],
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

  // Tile URL for the active basemap (WMS override for satellite).
  const tileUrl =
    basemap === "satellite" && wmsUrl ? wmsUrl : TILE_URLS[basemap];
  const tileAttribution = tileAttributions(t)[basemap];
  const tileOpacity = basemap === "satellite" ? satelliteOpacity : 1;

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
          key={`${tileUrl}-${tileOpacity}`}
          attribution={tileAttribution}
          url={tileUrl}
          maxZoom={19}
          opacity={tileOpacity}
        />
        <MapResizer />
        <ZoomControl />

        {layers.accumulationClusters && (
          <AccumulationClusterLayer dealerships={visibleDealerships} />
        )}
        {layers.nearbyInsured && (
          <NearbyInsuredLayer
            subject={selectedDealership}
            dealerships={withCoords}
            radiusKm={ACCUMULATION_RADIUS_KM}
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
          <DetectionOverlay dealerships={visibleDealerships} />
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
        {analyzing && progress && progress.total > 0 && (
          <div className="glass flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm shadow-lg">
            <Loader2 className="size-4 animate-spin text-primary" />
            {t("map.page.analyzingProgress", {
              done: progress.done,
              total: progress.total,
            })}
          </div>
        )}

        {!analyzing &&
          !boundaryWarningDismissed &&
          syntheticBoundaryCount > 0 && (
            <div className="glass flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm shadow-lg">
              <TriangleAlert className="size-4 shrink-0 text-amber-500" />
              <span>
                {t("map.page.boundaryWarning", {
                  count: syntheticBoundaryCount,
                  total: withCoords.length,
                })}
              </span>
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
          <div className="glass flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm shadow-lg">
            <TriangleAlert className="size-4 shrink-0 text-amber-500" />
            <span>
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
                  radius: ACCUMULATION_RADIUS_KM,
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
        />
      </div>

      {/* Legend + overlay scale bottom left */}
      <div className="absolute bottom-6 left-3 z-[1000] flex flex-col gap-2">
        <OverlayLegend
          perilOverlay={perilOverlay}
          showClusters={layers.accumulationClusters}
        />
        <MapLegend />
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
