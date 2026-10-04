import { useEffect, useState } from "react";
import type { ImagerySelection } from "@shared/imagery-sources";

export interface MapViewPoint {
  lat: number;
  lon: number;
  zoom: number;
}

/** Waits for the map to settle so a pan gesture is one lookup, not dozens. */
const LOOKUP_DELAY_MS = 400;

/**
 * Imagery source chosen for the map centre (Esri or state orthophoto) with
 * its capture metadata. `null` while disabled or before the first lookup;
 * after a move the previous selection stays until the new one arrives, so
 * the basemap does not flicker.
 */
export function useImagerySelection(
  view: MapViewPoint | null,
  enabled: boolean,
): ImagerySelection | null {
  const [selection, setSelection] = useState<ImagerySelection | null>(null);
  // Rounded so sub-100 m pans (same main-process cache bucket) do not refetch.
  const lat = view ? Math.round(view.lat * 1000) / 1000 : null;
  const lon = view ? Math.round(view.lon * 1000) / 1000 : null;
  const zoom = view?.zoom ?? null;

  useEffect(() => {
    if (!enabled || lat == null || lon == null || zoom == null) {
      setSelection(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      window.api
        .selectImagery(lat, lon, zoom)
        .then((m) => {
          if (!cancelled) setSelection(m);
        })
        .catch(() => {
          if (!cancelled) setSelection(null);
        });
    }, LOOKUP_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, lat, lon, zoom]);

  return selection;
}
