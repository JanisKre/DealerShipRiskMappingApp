import { useEffect, useEffectEvent, useRef } from "react";
import { latLng, latLngBounds, type Map as LeafletMap } from "leaflet";
import { useMap } from "./leaflet-react";
import type { AnalyzedDealership } from "@shared/types";
import { useAppStore } from "@renderer/store/appStore";
import { useMapStore } from "@renderer/store/mapStore";

interface Props {
  dealerships: AnalyzedDealership[];
  /**
   * The locations the arrow keys step through: the list as filtered. The
   * view itself (fit, fly-to) works on every location.
   */
  keyboardOrder?: AnalyzedDealership[];
  selectedId: string | null;
  lastAddedIds: string[];
  onSelect: (id: string) => void;
}

/**
 * Persists and restores the map viewport.
 * - On mount: restore the persisted view from mapStore -> `setView`, else fit-all.
 * - On `selectedId` change: fly to the location.
 * - On `lastAddedIds` change: fit newly added locations into view.
 * - On `mapFocusIds` (store): fit those locations once, then clear the request.
 * - On `moveend`: save the viewport to mapStore.
 * - Arrow keys (up/down) on the map container: cycle through the filtered list.
 */
export function ViewPersistence({
  dealerships,
  keyboardOrder,
  selectedId,
  lastAddedIds,
  onSelect,
}: Props): null {
  const map = useMap();
  const saveView = useMapStore((s) => s.saveView);
  const storedView = useMapStore((s) => s.view);
  const mapFocusIds = useAppStore((s) => s.mapFocusIds);
  const mapFocusRadiusKm = useAppStore((s) => s.mapFocusRadiusKm);
  const clearMapFocus = useAppStore((s) => s.clearMapFocus);
  const mountedRef = useRef(false);

  // One-time mount effect: restore the view or fit-all.
  const restoreView = useEffectEvent(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;

    if (selectedId) {
      const d = dealerships.find((x) => x.id === selectedId);
      if (d) {
        map.setView([d.lat, d.lon], Math.max(map.getZoom(), 15));
        return;
      }
    }
    // The lastAddedIds / mapFocusIds effects take over.
    if (lastAddedIds.length > 0 || mapFocusIds) return;
    if (storedView) {
      map.setView(storedView.center, storedView.zoom);
    } else {
      fitAll(map, dealerships);
    }
  });
  useEffect(() => {
    restoreView();
  }, []);

  // Fly to the selected location (not again when the list changes).
  const flyToSelected = useEffectEvent(() => {
    if (!selectedId) return;
    const d = dealerships.find((x) => x.id === selectedId);
    if (!d) return;
    map.setView([d.lat, d.lon], Math.max(map.getZoom(), 15));
  });
  useEffect(() => {
    flyToSelected();
  }, [selectedId]);

  // Fit newly added locations into view. An import places its rows one by
  // one as their addresses are found, so the view widens with each new one
  // until the user moves the map themselves.
  const presentAdded = dealerships.filter((d) => lastAddedIds.includes(d.id));
  const userMovedRef = useRef(false);
  useEffect(() => {
    userMovedRef.current = false;
  }, [lastAddedIds]);
  useEffect(() => {
    const container = map.getContainer();
    const moved = (): void => {
      userMovedRef.current = true;
    };
    map.on("dragstart", moved);
    container.addEventListener("wheel", moved, { passive: true });
    return () => {
      map.off("dragstart", moved);
      container.removeEventListener("wheel", moved);
    };
  }, [map]);
  const fitAdded = useEffectEvent(() => {
    if (selectedId || presentAdded.length === 0 || userMovedRef.current) return;
    const pts = presentAdded.map((d) => [d.lat, d.lon] as [number, number]);
    if (pts.length === 1) map.setView(pts[0], 15);
    else map.fitBounds(pts, { padding: [50, 50], maxZoom: 15 });
  });
  useEffect(() => {
    fitAdded();
  }, [lastAddedIds, presentAdded.length]);

  // Fit a requested set of locations (e.g. an accumulation from the dashboard).
  const fitFocus = useEffectEvent(() => {
    if (!mapFocusIds) return;
    const ids = new Set(mapFocusIds);
    const pts = dealerships
      .filter((d) => ids.has(d.id))
      .map((d) => [d.lat, d.lon] as [number, number]);
    if (pts.length > 0 && mapFocusRadiusKm) {
      // Keep the whole accumulation circle (drawn around the members' mean
      // position, as in AccumulationClusterLayer) in view.
      const center = latLng(
        pts.reduce((sum, p) => sum + p[0], 0) / pts.length,
        pts.reduce((sum, p) => sum + p[1], 0) / pts.length,
      );
      const bounds = latLngBounds(pts).extend(
        center.toBounds(mapFocusRadiusKm * 2000),
      );
      map.fitBounds(bounds, { padding: [30, 30] });
    } else if (pts.length === 1) map.setView(pts[0], 15);
    else if (pts.length > 1) map.fitBounds(pts, { padding: [60, 60] });
    clearMapFocus();
  });
  useEffect(() => {
    fitFocus();
  }, [mapFocusIds]);

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
  }, [map, saveView]);

  // Arrow-key navigation through the (filtered) locations. The handler
  // reads the current list and selection; the listener stays.
  const handleKey = useEffectEvent((e: KeyboardEvent): void => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    // A filtered-out location is not a stop: the keys follow the list.
    const order = keyboardOrder ?? dealerships;
    if (order.length === 0) return;
    const idx = selectedId ? order.findIndex((d) => d.id === selectedId) : -1;
    const next =
      e.key === "ArrowDown"
        ? (idx + 1) % order.length
        : (idx - 1 + order.length) % order.length;
    onSelect(order[next].id);
    e.preventDefault();
  });
  useEffect(() => {
    const container = map.getContainer();
    const onKey = (e: KeyboardEvent): void => handleKey(e);
    container.addEventListener("keydown", onKey);
    return () => container.removeEventListener("keydown", onKey);
  }, [map]);

  return null;
}

function fitAll(map: LeafletMap, dealerships: AnalyzedDealership[]): void {
  const pts = dealerships.map((d) => [d.lat, d.lon] as [number, number]);
  if (pts.length === 1) map.setView(pts[0], 15);
  else if (pts.length > 1) map.fitBounds(pts, { padding: [50, 50] });
}
