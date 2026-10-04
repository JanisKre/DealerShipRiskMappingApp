import { useMapStore } from "@renderer/store/mapStore";

/**
 * Last map viewport as a place-search bias, so "Autohaus Müller" finds the one
 * near the area being looked at. `undefined` before the map was first shown;
 * main then biases towards Germany.
 */
export function searchBias():
  | { lat: number; lon: number; zoom: number }
  | undefined {
  const view = useMapStore.getState().view;
  if (!view) return undefined;
  const [lat, lon] = view.center;
  return { lat, lon, zoom: view.zoom };
}
