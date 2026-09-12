import { CircleMarker, useMapEvents } from "react-leaflet";
import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import { point as turfPoint } from "@turf/helpers";
import type { AnalyzedDealership, ManualVehiclePoint } from "@shared/types";

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

  useMapEvents({
    click: (event) => {
      if (!activeDraft || !selected?.boundary) return;
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
  });

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
      {dealerships.flatMap((d) => {
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
              radius={2.5}
              pathOptions={{
                color: "#2563eb",
                weight: 1,
                fillOpacity: 0.8,
              }}
              eventHandlers={
                d.id === selected?.id && activeDraft
                  ? {
                      click: (event) => {
                        event.originalEvent.stopPropagation();
                        removePoint(
                          { lat: b.lat as number, lon: b.lon as number },
                          "remove-machine",
                        );
                      },
                    }
                  : undefined
              }
            />
          ));
      })}

      {selected &&
        manualPoints.map((p, i) => (
          <CircleMarker
            key={`${selected.id}-manual-${i}`}
            center={[p.lat, p.lon]}
            radius={editable ? 4 : 2.5}
            pathOptions={{
              color: editable ? "#16a34a" : "#2563eb",
              weight: 1,
              fillOpacity: 0.95,
            }}
            eventHandlers={
              activeDraft
                ? {
                    click: (event) => {
                      event.originalEvent.stopPropagation();
                      removePoint(p, "remove-manual");
                    },
                  }
                : undefined
            }
          />
        ))}

      {activeDraft &&
        selected &&
        removedPoints.map((p, i) => (
          <CircleMarker
            key={`${selected.id}-removed-${i}`}
            center={[p.lat, p.lon]}
            radius={3}
            pathOptions={{
              color: "#dc2626",
              weight: 1.5,
              fillOpacity: 0.2,
            }}
            eventHandlers={{
              click: (event) => {
                event.originalEvent.stopPropagation();
                removePoint(p, "restore-machine");
              },
            }}
          />
        ))}
    </>
  );
}
