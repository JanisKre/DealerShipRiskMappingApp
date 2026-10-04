import { useState } from "react";
import { CircleMarker, useMapEvents } from "react-leaflet";
import type { LatLngBounds } from "leaflet";
import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import { point as turfPoint } from "@turf/helpers";
import type { AnalyzedDealership, ManualVehiclePoint } from "@shared/types";

/** In-memory changes made while the map review mode is active. */
export interface DetectionEditDraft {
  manualVehicleCount: number;
  manualVehiclePoints: ManualVehiclePoint[];
  manualVehicleRemovedPoints: ManualVehiclePoint[];
}

/**
 * Below this zoom only the selected location's vehicles are drawn. Dots are
 * illegible further out anyway, and a large portfolio has tens of thousands
 * of them — drawing every one as an SVG circle freezes the renderer.
 */
const ALL_DETECTIONS_MIN_ZOOM = 15;

function samePoint(a: ManualVehiclePoint, b: ManualVehiclePoint): boolean {
  return (
    Math.abs(a.lat - b.lat) < 0.000001 && Math.abs(a.lon - b.lon) < 0.000001
  );
}

/**
 * Draws detected vehicles as dots at their georeferenced center. In review
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
  const drawn = dealerships.filter(
    (d) =>
      d.id === selected?.id ||
      (view.zoom >= ALL_DETECTIONS_MIN_ZOOM &&
        d.lat != null &&
        d.lon != null &&
        view.bounds.pad(0.2).contains([d.lat, d.lon])),
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
        return (d.detection?.boxes ?? [])
          .filter((b) => b.lat != null && b.lon != null)
          .filter(
            (b) =>
              !dRemoved.some(
                (removed) =>
                  Math.abs(removed.lat - (b.lat as number)) < 0.000001 &&
                  Math.abs(removed.lon - (b.lon as number)) < 0.000001,
              ),
          )
          .map((b, i) => (
            <CircleMarker
              key={`${d.id}-${i}`}
              center={[b.lat as number, b.lon as number]}
              radius={d.id === selected?.id && activeDraft ? 5 : 2.5}
              interactive={!activeDraft}
              pathOptions={{
                color: "#2563eb",
                weight: 1,
                fillOpacity: 0.8,
              }}
            />
          ));
      })}

      {selected &&
        manualPoints.map((p, i) => (
          <CircleMarker
            key={`${selected.id}-manual-${i}`}
            center={[p.lat, p.lon]}
            radius={editable ? 4 : 2.5}
            interactive={!activeDraft}
            pathOptions={{
              color: editable ? "#16a34a" : "#2563eb",
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
