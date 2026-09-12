import { useEffect } from "react";
import { Polygon, useMap } from "react-leaflet";
import type { Layer, LeafletEvent, LeafletEventHandlerFnMap } from "leaflet";
import area from "@turf/area";
import { polygon as turfPolygon } from "@turf/helpers";
import type {
  AnalyzedDealership,
  BoundaryResult,
  BoundarySource,
} from "@shared/types";
import { useAppStore } from "@renderer/store/appStore";

/** Color per boundary source. */
const SOURCE_COLOR: Record<BoundarySource, string> = {
  alkis: "#2563eb",
  osm: "#0891b2",
  overture: "#7c3aed",
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

/**
 * Renders all boundary polygons (color by source). When `editable`, the
 * polygons are editable via Geoman; an edit writes the new polygon back to
 * the store with source='manual' and a newly computed area.
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
            positions={toLatLng(d.boundary.polygon.coordinates[0])}
            pathOptions={{
              color: sourceColor(d.boundary.source),
              weight: 2,
              fillOpacity: 0.15,
            }}
            eventHandlers={
              {
                "pm:edit": (e: LeafletEvent) => {
                  const updated = readPolygon(e.target as EditableLayer);
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
  getLatLngs: () => Array<Array<{ lat: number; lng: number }>>;
}

/** Reads the (possibly nested) polygon of a Leaflet layer as a [lon,lat] ring. */
function readPolygon(layer: EditableLayer): [number, number][] | null {
  const latlngs = layer.getLatLngs();
  const ring = Array.isArray(latlngs[0])
    ? latlngs[0]
    : (latlngs as unknown as Array<{ lat: number; lng: number }>);
  if (!ring || ring.length < 3) return null;
  const coords = ring.map((p) => [p.lng, p.lat] as [number, number]);
  // Close the ring
  const first = coords[0];
  const last = coords.at(-1)!;
  if (first[0] !== last[0] || first[1] !== last[1]) coords.push(first);
  return coords;
}

/** Builds a new BoundaryResult with source='manual' + updated area. */
function rebuildBoundary(
  prev: BoundaryResult,
  ring: [number, number][],
): BoundaryResult {
  let areaSqm = prev.areaSqm;
  try {
    areaSqm = area(turfPolygon([ring]));
  } catch {
    // Area stays unchanged on error
  }
  return {
    ...prev,
    source: "manual",
    polygon: { type: "Polygon", coordinates: [ring] },
    areaSqm,
    confidence: 1,
  };
}

export { sourceColor };
