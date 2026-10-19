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
 * its capture metadata. `selection` is `null` while disabled or before the
 * first lookup; after a move the previous selection stays until the new one
 * arrives, so the basemap does not flicker. `loading` says that the kept
 * selection still belongs to the previous view, so anything that describes
 * the map centre (legend, version list) must not present it as current.
 */
export function useImagerySelection(
  view: MapViewPoint | null,
  enabled: boolean,
): { selection: ImagerySelection | null; loading: boolean } {
  const [result, setResult] = useState<{
    key: string;
    selection: ImagerySelection | null;
  } | null>(null);
  // Rounded so sub-100 m pans (same main-process cache bucket) do not refetch.
  const lat = view ? Math.round(view.lat * 1000) / 1000 : null;
  const lon = view ? Math.round(view.lon * 1000) / 1000 : null;
  const zoom = view?.zoom ?? null;
  const key =
    enabled && lat != null && lon != null && zoom != null
      ? `${lat}|${lon}|${zoom}`
      : null;

  useEffect(() => {
    if (key == null || lat == null || lon == null || zoom == null) {
      setResult(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      window.api
        .selectImagery(lat, lon, zoom)
        .then((selection) => {
          if (!cancelled) setResult({ key, selection });
        })
        .catch(() => {
          if (!cancelled) setResult({ key, selection: null });
        });
    }, LOOKUP_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [key, lat, lon, zoom]);

  return {
    selection: result?.selection ?? null,
    loading: key != null && result?.key !== key,
  };
}
