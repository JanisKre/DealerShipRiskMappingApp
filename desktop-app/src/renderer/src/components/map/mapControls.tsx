import { useEffect, useEffectEvent } from "react";
import { useMap, useMapEvents } from "./leaflet-react";
import { useTranslation } from "react-i18next";
import { Minus, Plus } from "lucide-react";
import { HintButton } from "@renderer/components/ui/hint-button";
import { type MapViewPoint } from "@renderer/lib/useImagerySelection";
import { type ViewBounds } from "@renderer/lib/legendPresence";
import { BASEMAP_MAX_ZOOM } from "./basemapTiles";

/** Geoman's own languages that the app's UI languages map to. */
const GEOMAN_LANGS = new Set(["de", "en", "fr"]);

/**
 * Reports the map centre + zoom, and the visible area, once on mount and
 * after every pan/zoom.
 */
export function MapViewReporter({
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
  const reportOnMount = useEffectEvent(report);
  useEffect(() => {
    reportOnMount();
  }, []);
  return null;
}

/** Calls map.invalidateSize() when the container changes — fixes white areas on panel resize. */
export function MapResizer(): null {
  const map = useMap();
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);
  return null;
}

/** Geoman's draw and edit tooltips follow the UI language. */
export function GeomanLanguage(): null {
  const { i18n } = useTranslation();
  const map = useMap();
  const lang = i18n.language.slice(0, 2);
  useEffect(() => {
    map.pm?.setLang(GEOMAN_LANGS.has(lang) ? (lang as "de") : "en");
  }, [map, lang]);
  return null;
}

/** Fits the map to the requested bounds whenever a new request comes in. */
export function FitBounds({
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

export interface FitRequest {
  bounds: [[number, number], [number, number]];
}

/** Zoom control as shadcn buttons instead of the default Leaflet control. */
export function ZoomControl(): React.JSX.Element {
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
