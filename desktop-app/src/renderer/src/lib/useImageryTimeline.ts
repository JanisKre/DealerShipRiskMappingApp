import { useEffect, useState } from "react";
import type { ImageryTimeline } from "@shared/imagery-wayback";
import type { MapViewPoint } from "./useImagerySelection";

/** Waits for the map to settle so a pan gesture is one lookup, not dozens. */
const LOOKUP_DELAY_MS = 400;

/**
 * Dated Esri Wayback versions at a point (newest first). `timeline` is
 * `null` while disabled or before the first lookup; after a move the
 * previous timeline stays until the new one arrives.
 *
 * With `versionsFirst`, the versions are shown as soon as they are known
 * and their capture dates follow (`timeline.pendingIds` names the ones
 * still waiting, `loading` stays true): Esri's metadata service can take
 * half a minute per version.
 */
export function useImageryTimeline(
  point: MapViewPoint | null,
  enabled: boolean,
  versionsFirst = false,
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
        .imageryTimeline(lat, lon, zoom, versionsFirst)
        .then((result) => {
          if (cancelled) return undefined;
          setTimeline(result);
          if (!result.pendingIds?.length) return undefined;
          // The full lookup waits for the requests the quick one started.
          return window.api.imageryTimeline(lat, lon, zoom).then(
            (full) => {
              if (!cancelled) setTimeline(full);
            },
            // The versions stay listed; only their dates are missing.
            () => {
              if (!cancelled) setTimeline({ ...result, pendingIds: undefined });
            },
          );
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
  }, [enabled, lat, lon, zoom, versionsFirst]);

  return { timeline, loading };
}
