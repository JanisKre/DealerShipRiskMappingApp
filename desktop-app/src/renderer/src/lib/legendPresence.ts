import type { AnalyzedDealership, BoundarySource } from "@shared/types";
import { dealershipHailZone } from "@shared/risk-math";
import { businessType } from "@renderer/store/appStore";

/**
 * Below this zoom only the selected location's vehicles are drawn. Dots are
 * illegible further out anyway, and a large portfolio has tens of thousands
 * of them — drawing every one as an SVG circle freezes the renderer.
 */
export const ALL_DETECTIONS_MIN_ZOOM = 15;

/** The visible map area in degrees. */
export interface ViewBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** What the locations in the current map view show; the rest is greyed out. */
export interface LegendPresence {
  hailZones: number[];
  business: ("existing" | "new")[];
  boundarySources: BoundarySource[];
  vehicles: boolean;
}

/**
 * Which legend entries the locations in view actually use. `bounds` null
 * (before the map reported its area) counts every location as in view.
 */
export function legendPresence(
  dealerships: AnalyzedDealership[],
  view: {
    bounds: ViewBounds | null;
    zoom: number;
    selectedId: string | null;
    layers: { hailZones: boolean; boundaries: boolean; detections: boolean };
  },
): LegendPresence {
  const { bounds, zoom, selectedId, layers } = view;
  const inView = dealerships.filter(
    (d) =>
      bounds == null ||
      (d.lat >= bounds.south &&
        d.lat <= bounds.north &&
        d.lon >= bounds.west &&
        d.lon <= bounds.east),
  );
  return {
    hailZones: layers.hailZones
      ? [1, 2, 3, 4, 5, 6] // the hail-zone layer colours the whole area
      : [
          ...new Set(
            inView.flatMap((d) => {
              const zone = dealershipHailZone(d)?.zone;
              return zone == null ? [] : [zone];
            }),
          ),
        ],
    business: [...new Set(inView.map(businessType))],
    boundarySources: layers.boundaries
      ? [
          ...new Set(
            inView.flatMap((d) => (d.boundary ? [d.boundary.source] : [])),
          ),
        ]
      : [],
    // Vehicle dots: every location from ALL_DETECTIONS_MIN_ZOOM, else only
    // the selected one (see DetectionOverlay).
    vehicles:
      layers.detections &&
      inView.some(
        (d) =>
          (zoom >= ALL_DETECTIONS_MIN_ZOOM || d.id === selectedId) &&
          ((d.detection?.boxes?.length ?? 0) > 0 ||
            (d.detection?.manualVehiclePoints?.length ?? 0) > 0),
      ),
  };
}
