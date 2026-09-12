import { useEffect, useRef } from "react";
import type { Map as LeafletMap } from "leaflet";
import { useMap } from "react-leaflet";
import type { AnalyzedDealership } from "@shared/types";
import { useMapStore } from "@renderer/store/mapStore";

interface Props {
  dealerships: AnalyzedDealership[];
  selectedId: string | null;
  lastAddedIds: string[];
  onSelect: (id: string) => void;
}

/**
 * Persists and restores the map viewport.
 * - On mount: restore the persisted view from mapStore -> `setView`, else fit-all.
 * - On `selectedId` change: fly to the location.
 * - On `lastAddedIds` change: fit newly added locations into view.
 * - On `moveend`: save the viewport to mapStore.
 * - Arrow keys (up/down) on the map container: cycle through the filtered list.
 */
export function ViewPersistence({
  dealerships,
  selectedId,
  lastAddedIds,
  onSelect,
}: Props): null {
  const map = useMap();
  const saveView = useMapStore((s) => s.saveView);
  const storedView = useMapStore((s) => s.view);
  const mountedRef = useRef(false);

  // One-time mount effect: restore the view or fit-all.
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;

    if (selectedId) {
      const d = dealerships.find((x) => x.id === selectedId);
      if (d) {
        map.setView([d.lat, d.lon], Math.max(map.getZoom(), 15));
        return;
      }
    }
    if (lastAddedIds.length > 0) return; // lastAddedIds effect takes over
    if (storedView) {
      map.setView(storedView.center, storedView.zoom);
    } else {
      fitAll(map, dealerships);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fly to the selected location.
  useEffect(() => {
    if (!selectedId) return;
    const d = dealerships.find((x) => x.id === selectedId);
    if (!d) return;
    map.setView([d.lat, d.lon], Math.max(map.getZoom(), 15));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Fit newly added locations into view.
  useEffect(() => {
    if (selectedId || lastAddedIds.length === 0) return;
    const pts = dealerships
      .filter((d) => lastAddedIds.includes(d.id))
      .map((d) => [d.lat, d.lon] as [number, number]);
    if (pts.length === 1) map.setView(pts[0], 15);
    else if (pts.length > 1) map.fitBounds(pts, { padding: [50, 50] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastAddedIds]);

  // Save the view on map interaction.
  useEffect(() => {
    const onMoveEnd = (): void => {
      const c = map.getCenter();
      saveView([c.lat, c.lng], map.getZoom());
    };
    map.on("moveend", onMoveEnd);
    return () => {
      map.off("moveend", onMoveEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  // Arrow-key navigation through the (filtered) locations.
  useEffect(() => {
    const container = map.getContainer();
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      if (dealerships.length === 0) return;
      const idx = selectedId
        ? dealerships.findIndex((d) => d.id === selectedId)
        : -1;
      const next =
        e.key === "ArrowDown"
          ? (idx + 1) % dealerships.length
          : (idx - 1 + dealerships.length) % dealerships.length;
      onSelect(dealerships[next].id);
      e.preventDefault();
    };
    container.addEventListener("keydown", handleKey);
    return () => container.removeEventListener("keydown", handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, dealerships, selectedId]);

  return null;
}

function fitAll(map: LeafletMap, dealerships: AnalyzedDealership[]): void {
  const pts = dealerships.map((d) => [d.lat, d.lon] as [number, number]);
  if (pts.length === 1) map.setView(pts[0], 15);
  else if (pts.length > 1) map.fitBounds(pts, { padding: [50, 50] });
}
