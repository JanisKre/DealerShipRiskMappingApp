import { useEffect, useState } from "react";
import type { ImageryTimeline } from "@shared/imagery-wayback";
import type { MapViewPoint } from "./useImagerySelection";

/** Waits for the map to settle so a pan gesture is one lookup, not dozens. */
const LOOKUP_DELAY_MS = 400;

/**
 * Dated Esri Wayback versions at a point (newest first). `timeline` is
 * `null` while disabled or before the first lookup; after a move the
 * previous timeline stays until the new one arrives.
 */
export function useImageryTimeline(
  point: MapViewPoint | null,
  enabled: boolean,
): { timeline: ImageryTimeline | null; loading: boolean } {
  const [timeline, setTimeline] = useState<ImageryTimeline | null>(null);
  const [loading, setLoading] = useState(false);
  // Rounded so sub-100 m pans (same main-process cache bucket) do not refetch.
  const lat = point ? Math.round(point.lat * 1000) / 1000 : null;
  const lon = point ? Math.round(point.lon * 1000) / 1000 : null;
  const zoom = point?.zoom ?? null;

  useEffect(() => {
    if (!enabled || lat == null || lon == null || zoom == null) {
      setTimeline(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      window.api
        .imageryTimeline(lat, lon, zoom)
        .then((result) => {
          if (!cancelled) setTimeline(result);
        })
        .catch(() => {
          if (!cancelled) setTimeline(null);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, LOOKUP_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, lat, lon, zoom]);

  return { timeline, loading };
}
