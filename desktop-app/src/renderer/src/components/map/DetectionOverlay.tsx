import { useState } from "react";
import { CircleMarker, Polygon, useMapEvents } from "./leaflet-react";
import type { LatLngBounds } from "leaflet";
import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import { point as turfPoint } from "@turf/helpers";
import type {
  AnalyzedDealership,
  DetectionBox,
  ManualVehiclePoint,
} from "@shared/types";
import { ALL_DETECTIONS_MIN_ZOOM } from "@renderer/lib/legendPresence";
import {
  boxFootprints,
  DETECTION_COLORS,
  detectionColor,
  DOT_RADIUS,
  type Footprint,
} from "@renderer/lib/detectionDisplay";
import { useMapStore } from "@renderer/store/mapStore";

// One footprint list per stored box array: stable positions keep Leaflet
// from resetting every polygon on each pan.
const footprintCache = new WeakMap<
  readonly DetectionBox[],
  (Footprint | null)[]
>();

function footprintsOf(boxes: readonly DetectionBox[]): (Footprint | null)[] {
  let cached = footprintCache.get(boxes);
  if (!cached) {
    cached = boxFootprints(boxes);
    footprintCache.set(boxes, cached);
  }
  return cached;
}

/** In-memory changes made while the map review mode is active. */
export interface DetectionEditDraft {
  manualVehicleCount: number;
  manualVehiclePoints: ManualVehiclePoint[];
  manualVehicleRemovedPoints: ManualVehiclePoint[];
}

function samePoint(a: ManualVehiclePoint, b: ManualVehiclePoint): boolean {
  return (
    Math.abs(a.lat - b.lat) < 0.000001 && Math.abs(a.lon - b.lon) < 0.000001
  );
}

/**
 * Draws detected vehicles as dots at their georeferenced center, as boxes
 * (the detector's footprint), or both, as chosen in the settings. In review
 * mode, clicks inside the selected boundary add points and point clicks remove
 * or restore them. Draft changes are intentionally kept separate until Save.
 */
export function DetectionOverlay({
  dealerships,
  selectedId,
  editable,
  draft,
  onDraftChange,
}: Readonly<{
  dealerships: AnalyzedDealership[];
  selectedId: string | null;
  editable: boolean;
  draft: DetectionEditDraft | null;
  onDraftChange: (draft: DetectionEditDraft) => void;
}>): React.JSX.Element {
  const display = useMapStore((s) => s.detectionDisplay);
  const selected = dealerships.find((d) => d.id === selectedId);
  const activeDraft = editable && draft ? draft : null;
  const manualPoints =
    activeDraft?.manualVehiclePoints ??
    selected?.detection?.manualVehiclePoints ??
    [];
  const removedPoints =
    activeDraft?.manualVehicleRemovedPoints ??
    selected?.detection?.manualVehicleRemovedPoints ??
    [];

  const map = useMapEvents({
    click: (event) => {
      if (!activeDraft || !selected?.boundary) return;

      // Marker hit areas are deliberately larger than the visible dots. Dense
      // detections otherwise make it almost impossible to hit a 2.5 px circle
      // precisely, and a near miss used to add a new point instead. Handling
      // every review click here also avoids marker/map bubbling races.
      const machinePoints = (selected.detection?.boxes ?? [])
        .filter(
          (box): box is typeof box & { lat: number; lon: number } =>
            box.lat != null && box.lon != null,
        )
        .map((box) => ({
          point: { lat: box.lat, lon: box.lon },
          mode: "remove-machine" as const,
        }))
        .filter(
          ({ point }) =>
            !removedPoints.some((removed) => samePoint(removed, point)),
        );
      const editablePoints = [
        ...manualPoints.map((point) => ({
          point,
          mode: "remove-manual" as const,
        })),
        ...removedPoints.map((point) => ({
          point,
          mode: "restore-machine" as const,
        })),
        ...machinePoints,
      ];
      const closest = editablePoints
        .map((candidate) => ({
          ...candidate,
          distance: event.containerPoint.distanceTo(
            map.latLngToContainerPoint([
              candidate.point.lat,
              candidate.point.lon,
            ]),
          ),
        }))
        .sort((a, b) => a.distance - b.distance)[0];
      if (closest && closest.distance <= 12) {
        removePoint(closest.point, closest.mode);
        return;
      }

      const candidate = turfPoint([event.latlng.lng, event.latlng.lat]);
      if (!booleanPointInPolygon(candidate, selected.boundary.polygon)) return;
      onDraftChange({
        ...activeDraft,
        manualVehicleCount: activeDraft.manualVehicleCount + 1,
        manualVehiclePoints: [
          ...activeDraft.manualVehiclePoints,
          { lat: event.latlng.lat, lon: event.latlng.lng },
        ],
      });
    },
    moveend: () => setView({ zoom: map.getZoom(), bounds: map.getBounds() }),
  });
  const [view, setView] = useState<{ zoom: number; bounds: LatLngBounds }>(
    () => ({ zoom: map.getZoom(), bounds: map.getBounds() }),
  );
  const neighbours =
    !display.onlySelected && view.zoom >= ALL_DETECTIONS_MIN_ZOOM
      ? view.bounds.pad(0.2)
      : null;
  const drawn = dealerships.filter(
    (d) =>
      d.id === selected?.id ||
      (neighbours != null &&
        d.lat != null &&
        d.lon != null &&
        neighbours.contains([d.lat, d.lon])),
  );

  function removePoint(
    point: ManualVehiclePoint,
    mode: "remove-machine" | "remove-manual" | "restore-machine",
  ): void {
    if (!activeDraft) return;

    if (mode === "remove-manual") {
      const index = activeDraft.manualVehiclePoints.findIndex((candidate) =>
        samePoint(candidate, point),
      );
      if (index < 0) return;
      const points = [...activeDraft.manualVehiclePoints];
      points.splice(index, 1);
      onDraftChange({
        ...activeDraft,
        manualVehicleCount: Math.max(0, activeDraft.manualVehicleCount - 1),
        manualVehiclePoints: points,
      });
      return;
    }

    const removed = [...activeDraft.manualVehicleRemovedPoints];
    const index = removed.findIndex((candidate) => samePoint(candidate, point));
    if (mode === "remove-machine") {
      if (index >= 0) return;
      removed.push(point);
      onDraftChange({
        ...activeDraft,
        manualVehicleCount: Math.max(0, activeDraft.manualVehicleCount - 1),
        manualVehicleRemovedPoints: removed,
      });
      return;
    }

    if (index < 0) return;
    removed.splice(index, 1);
    onDraftChange({
      ...activeDraft,
      manualVehicleCount: activeDraft.manualVehicleCount + 1,
      manualVehicleRemovedPoints: removed,
    });
  }

  return (
    <>
      {drawn.flatMap((d) => {
        const dRemoved =
          d.id === selected?.id && activeDraft
            ? removedPoints
            : (d.detection?.manualVehicleRemovedPoints ?? []);
        const boxes = d.detection?.boxes ?? [];
        const footprints = display.shape === "dot" ? null : footprintsOf(boxes);
        const reviewing = d.id === selected?.id && activeDraft != null;
        return boxes.flatMap((b, i) => {
          if (b.lat == null || b.lon == null) return [];
          const center = { lat: b.lat, lon: b.lon };
          if (dRemoved.some((removed) => samePoint(removed, center))) return [];
          const color = detectionColor(display.color, b.score);
          const footprint = footprints?.[i];
          let radius = DOT_RADIUS[display.dotSize];
          // Review clicks hit the center, so review keeps a visible dot.
          if (reviewing) radius = Math.max(5, radius);
          else if (footprint) radius = Math.min(2, radius);
          return [
            footprint && (
              // Not interactive: a click goes through to the map below.
              <Polygon
                key={`${d.id}-box-${i}`}
                positions={footprint}
                interactive={false}
                pathOptions={{
                  color,
                  weight: 1.6,
                  fill: display.boxFill,
                  fillColor: color,
                  fillOpacity: 0.12,
                }}
              />
            ),
            (!footprint || display.shape === "boxAndDot" || reviewing) && (
              <CircleMarker
                key={`${d.id}-${i}`}
                center={[center.lat, center.lon]}
                radius={radius}
                interactive={!activeDraft}
                pathOptions={{ color, weight: 1, fillOpacity: 0.8 }}
              />
            ),
          ];
        });
      })}

      {selected &&
        manualPoints.map((p, i) => (
          <CircleMarker
            key={`${selected.id}-manual-${i}`}
            center={[p.lat, p.lon]}
            radius={editable ? 4 : DOT_RADIUS[display.dotSize]}
            interactive={!activeDraft}
            pathOptions={{
              // Added by hand: no model score, so never a confidence colour.
              color: editable
                ? "#16a34a"
                : display.color === "green"
                  ? DETECTION_COLORS.green
                  : DETECTION_COLORS.blue,
              weight: 1,
              fillOpacity: 0.95,
            }}
          />
        ))}

      {activeDraft &&
        selected &&
        removedPoints.map((p, i) => (
          <CircleMarker
            key={`${selected.id}-removed-${i}`}
            center={[p.lat, p.lon]}
            radius={3}
            interactive={false}
            pathOptions={{
              color: "#dc2626",
              weight: 1.5,
              fillOpacity: 0.2,
            }}
          />
        ))}
    </>
  );
}
