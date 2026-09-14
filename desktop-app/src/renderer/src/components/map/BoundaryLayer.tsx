import { useEffect } from "react";
import { Polygon, useMap } from "react-leaflet";
import type { Layer, LeafletEventHandlerFnMap } from "leaflet";
import area from "@turf/area";
import type {
  AnalyzedDealership,
  BoundaryGeometry,
  BoundaryResult,
  BoundarySource,
} from "@shared/types";
import { useAppStore } from "@renderer/store/appStore";

/** Color per boundary source. */
const SOURCE_COLOR: Record<BoundarySource, string> = {
  alkis: "#2563eb",
  osm: "#0891b2",
  overture: "#7c3aed",
  aerial: "#ea580c",
  fused: "#10b981",
  synthetic: "#f59e0b",
  manual: "#16a34a",
};

function sourceColor(source: BoundarySource): string {
  return SOURCE_COLOR[source] ?? "#64748b";
}

/** [lon,lat][] -> [lat,lon][] for Leaflet. */
function toLatLng(ring: [number, number][]): [number, number][] {
  return ring.map(([lon, lat]) => [lat, lon]);
}

function toLatLngGeometry(geometry: BoundaryGeometry): unknown {
  return geometry.type === "Polygon"
    ? geometry.coordinates.map((ring) => toLatLng(ring))
    : geometry.coordinates.map((part) =>
        part.map((ring) => toLatLng(ring)),
      );
}

/**
 * Renders all boundary polygons (color by source). When `editable`, the
 * polygons are editable via Geoman; an edit writes the new polygon back to
 * the store with source='manual' and a newly computed area. A separate CTA
 * then re-runs vehicle detection against the new boundary.
 */
export function BoundaryLayer({
  dealerships,
  editable,
}: Readonly<{
  dealerships: AnalyzedDealership[];
  editable: boolean;
}>): React.JSX.Element {
  const map = useMap();
  const updateBoundaryAndRescore = useAppStore(
    (s) => s.updateBoundaryAndRescore,
  );

  // Tie the global Geoman edit mode to the `editable` state.
  useEffect(() => {
    const pm = (map as unknown as { pm?: PmMap }).pm;
    if (!pm) return;
    if (editable) {
      pm.enableGlobalEditMode();
    } else if (pm.globalEditModeEnabled?.()) {
      pm.disableGlobalEditMode();
    }
    return () => {
      if (pm.globalEditModeEnabled?.()) pm.disableGlobalEditMode();
    };
  }, [editable, map]);

  return (
    <>
      {dealerships.map((d) =>
        d.boundary ? (
          <Polygon
            key={d.id}
            positions={toLatLngGeometry(d.boundary.polygon) as never}
            pathOptions={{
              color: sourceColor(d.boundary.source),
              weight: 2,
              fillOpacity: 0.15,
            }}
            eventHandlers={
              {
                "pm:edit": (e: BoundaryEditEvent) => {
                  const layer = e.layer ?? e.target;
                  if (!layer) return;
                  const updated = readGeometry(layer as EditableLayer);
                  if (updated)
                    void updateBoundaryAndRescore(
                      d.id,
                      rebuildBoundary(d.boundary!, updated),
                    );
                },
              } as LeafletEventHandlerFnMap
            }
          />
        ) : null,
      )}
    </>
  );
}

interface PmMap {
  enableGlobalEditMode: () => void;
  disableGlobalEditMode: () => void;
  globalEditModeEnabled?: () => boolean;
}

interface EditableLayer extends Layer {
  getLatLngs: () => unknown;
}

/**
 * Geoman 2.20 exposes `layer` on its edit event, while older versions and
 * React Leaflet's generic event map expose the edited layer as `target`.
 */
interface BoundaryEditEvent {
  layer?: Layer;
  target?: Layer;
}

type LeafletPoint = { lat: number; lng: number };

function isLeafletPoint(value: unknown): value is LeafletPoint {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as LeafletPoint).lat === "number" &&
    typeof (value as LeafletPoint).lng === "number"
  );
}

function readRing(value: unknown): [number, number][] | null {
  if (!Array.isArray(value) || value.length < 3 || !value.every(isLeafletPoint)) {
    return null;
  }
  const coords = value.map((point) => [point.lng, point.lat] as [number, number]);
  const first = coords[0];
  const last = coords.at(-1)!;
  if (first[0] !== last[0] || first[1] !== last[1]) coords.push(first);
  return coords;
}

/** Reads a Polygon, including holes, or a MultiPolygon from a Leaflet layer. */
function readGeometry(layer: EditableLayer): BoundaryGeometry | null {
  const latlngs = layer.getLatLngs();
  if (!Array.isArray(latlngs) || latlngs.length === 0) return null;
  if (readRing(latlngs[0])) {
    const rings = latlngs.map(readRing);
    return rings.every((ring): ring is [number, number][] => ring !== null)
      ? { type: "Polygon", coordinates: rings }
      : null;
  }
  const parts = latlngs.map((part) => {
    if (!Array.isArray(part)) return null;
    const rings = part.map(readRing);
    return rings.every((ring): ring is [number, number][] => ring !== null)
      ? rings
      : null;
  });
  return parts.every((part): part is [number, number][][] => part !== null)
    ? { type: "MultiPolygon", coordinates: parts }
    : null;
}

/** Builds a new BoundaryResult with source='manual' + updated area. */
function rebuildBoundary(
  prev: BoundaryResult,
  polygon: BoundaryGeometry,
): BoundaryResult {
  let areaSqm = prev.areaSqm;
  try {
    areaSqm = area(polygon as never);
  } catch {
    // Area stays unchanged on error
  }
  return {
    ...prev,
    source: "manual",
    role: "operationalLot",
    provider: "manual",
    polygon,
    areaSqm,
    confidence: 1,
    quality: {
      geometryValid: true,
      pointRelation: "unknown",
      sourceAgreement: 1,
      areaPlausibility: 1,
      boundaryFit: 1,
      reasons: [],
    },
  };
}

export { sourceColor };
