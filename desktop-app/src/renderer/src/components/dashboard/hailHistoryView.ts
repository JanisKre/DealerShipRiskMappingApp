import type { HailHistoryStation } from "@shared/types";

/**
 * Another nearby station whose record reaches later than this one's, the
 * latest first — offered when the shown station stopped observing early.
 */
export function newerStation(
  stations: HailHistoryStation[],
  current: HailHistoryStation,
): HailHistoryStation | null {
  return (
    stations
      .filter(
        (s) =>
          s.stationId !== current.stationId && s.lastYear > current.lastYear,
      )
      .sort(
        (a, b) => b.lastYear - a.lastYear || a.distanceKm - b.distanceKm,
      )[0] ?? null
  );
}
