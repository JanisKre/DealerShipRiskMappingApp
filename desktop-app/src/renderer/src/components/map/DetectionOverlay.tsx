import { CircleMarker, useMapEvents } from "react-leaflet";
import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import { point as turfPoint } from "@turf/helpers";
import type { AnalyzedDealership, ManualVehiclePoint } from "@shared/types";
import { useAppStore } from "@renderer/store/appStore";

/**
 * Draws detected vehicles as small dots at their georeferenced center
 * (box `lat`/`lon`). Boxes without a geo-reference are skipped.
 */
export function DetectionOverlay({
  dealerships,
  selectedId,
  editable,
}: Readonly<{
  dealerships: AnalyzedDealership[];
  selectedId: string | null;
  editable: boolean;
}>): React.JSX.Element {
  const adjustPoint = useAppStore((s) => s.adjustVehicleDetectionPoint);
  const selected = dealerships.find((d) => d.id === selectedId);
  const manualPoints = selected?.detection?.manualVehiclePoints ?? [];

  useMapEvents({
    click: (event) => {
      if (!editable || !selected?.boundary) return;
      const candidate = turfPoint([event.latlng.lng, event.latlng.lat]);
      if (!booleanPointInPolygon(candidate, selected.boundary.polygon)) return;
      const point: ManualVehiclePoint = {
        lat: event.latlng.lat,
        lon: event.latlng.lng,
      };
      void adjustPoint(selected.id, point, "add");
    },
  });

  const removePoint = (
    point: ManualVehiclePoint,
    mode: "remove-machine" | "remove-manual" | "restore-machine",
  ): void => {
    if (editable && selected) void adjustPoint(selected.id, point, mode);
  };

  return (
    <>
      {dealerships.flatMap((d) =>
        (d.detection?.boxes ?? [])
          .filter((b) => b.lat != null && b.lon != null)
          .filter(
            (b) =>
              !d.detection?.manualVehicleRemovedPoints?.some(
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
                d.id === selected?.id && editable
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
          )),
      )}
      {selected &&
        manualPoints.map((p, i) => (
          <CircleMarker
            key={`${selected.id}-manual-${i}`}
            center={[p.lat, p.lon]}
            radius={4}
            pathOptions={{
              color: "#16a34a",
              weight: 1,
              fillOpacity: 0.95,
            }}
            eventHandlers={{
              click: (event) => {
                event.originalEvent.stopPropagation();
                removePoint(p, "remove-manual");
              },
            }}
          />
        ))}
      {editable &&
        selected &&
        (selected.detection?.manualVehicleRemovedPoints ?? []).map((p, i) => (
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
