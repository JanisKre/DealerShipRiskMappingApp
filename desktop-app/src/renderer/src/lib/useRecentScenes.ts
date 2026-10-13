import { useEffect, useState } from "react";
import type { RecentScenes } from "@shared/imagery-gibs";
import type { MapViewPoint } from "./useImagerySelection";

/** Waits for the map to settle so a pan gesture is one lookup, not dozens. */
const LOOKUP_DELAY_MS = 400;

/**
 * Recent 30 m HLS scenes at the map centre. One HLS tile spans ~110 km, so
 * the centre is rounded to ~1 km and the list survives ordinary panning.
 */
export function useRecentScenes(
  point: MapViewPoint | null,
  enabled: boolean,
): { scenes: RecentScenes | null; loading: boolean } {
  const [scenes, setScenes] = useState<RecentScenes | null>(null);
  const [loading, setLoading] = useState(false);
  const lat = point ? Math.round(point.lat * 100) / 100 : null;
  const lon = point ? Math.round(point.lon * 100) / 100 : null;

  useEffect(() => {
    if (!enabled || lat == null || lon == null) {
      setScenes(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      window.api
        .recentScenes(lat, lon)
        .then((result) => {
          if (!cancelled) setScenes(result);
        })
        .catch(() => {
          if (!cancelled) setScenes(null);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, LOOKUP_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, lat, lon]);

  return { scenes, loading };
}
