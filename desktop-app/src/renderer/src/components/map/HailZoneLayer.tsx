import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import L from "leaflet";
import { toast } from "sonner";
import { hailZoneColor } from "@renderer/lib/riskColor";
import { useMapStore } from "@renderer/store/mapStore";
import { useMap } from "./leaflet-react";

const PANE = "hail-zone-pane";
/** Above the basemap tiles (200), below parcels, detections and markers. */
const PANE_Z_INDEX = "250";
const FILL_OPACITY = 0.45;
const HOVER_FILL_OPACITY = 0.7;
const TOAST_ID = "hail-zone-overlay";
/** The loading toast only appears when the download takes noticeable time. */
const TOAST_DELAY_MS = 500;

/**
 * Postcode areas colored by their hail zone (1–6). The outlines are prepared
 * by the main process and cached, so only the first activation downloads.
 * A canvas renderer keeps the ~8,000 areas smooth at country zoom.
 */
export function HailZoneLayer(): null {
  const map = useMap();
  const { t } = useTranslation();
  const setLayers = useMapStore((s) => s.setLayers);

  useEffect(() => {
    let cancelled = false;
    let group: L.LayerGroup | null = null;
    let attribution: string | null = null;
    const pane = map.getPane(PANE) ?? map.createPane(PANE);
    pane.style.zIndex = PANE_Z_INDEX;

    const toastTimer = setTimeout(
      () => toast.loading(t("map.hailZones.loading"), { id: TOAST_ID }),
      TOAST_DELAY_MS,
    );

    window.api
      .hailZoneOverlay()
      .then((overlay) => {
        if (cancelled) return;
        const renderer = L.canvas({ pane: PANE, padding: 0.3 });
        const layers = overlay.areas.map((area) => {
          const color = hailZoneColor(area.zone);
          const baseStyle: L.PathOptions = {
            color,
            weight: 0.6,
            opacity: 0.8,
            fillColor: color,
            fillOpacity: FILL_OPACITY,
          };
          const polygon = L.polygon(
            area.polygons.map((rings) =>
              rings.map((ring) => ring.map(([lon, lat]) => L.latLng(lat, lon))),
            ),
            { ...baseStyle, renderer, pane: PANE },
          );
          polygon.on("mouseover", (event: L.LeafletMouseEvent) => {
            polygon.setStyle({ fillOpacity: HOVER_FILL_OPACITY, weight: 1.5 });
            if (!polygon.getTooltip())
              polygon.bindTooltip(
                t("map.hailZones.tooltip", {
                  postcode: area.postcode,
                  zone: area.zone,
                }),
                { sticky: true },
              );
            polygon.openTooltip(event.latlng);
          });
          polygon.on("mouseout", () => polygon.setStyle(baseStyle));
          return polygon;
        });
        group = L.layerGroup(layers).addTo(map);
        attribution = overlay.attribution;
        map.attributionControl?.addAttribution(attribution);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error("Hail zone overlay failed", error);
        toast.error(t("map.hailZones.loadFailed"));
        setLayers({ hailZones: false });
      })
      .finally(() => {
        clearTimeout(toastTimer);
        toast.dismiss(TOAST_ID);
      });

    return () => {
      cancelled = true;
      clearTimeout(toastTimer);
      toast.dismiss(TOAST_ID);
      group?.remove();
      if (attribution) map.attributionControl?.removeAttribution(attribution);
    };
  }, [map, setLayers, t]);

  return null;
}
