import { useMemo } from "react";
import {
  bboxCenterLat,
  classDamageFromParameters,
  computeHailEventImpact,
  shiftCells,
  type HailEventCell,
  type HailEventImpact,
} from "@shared/hail-events";
import { groundKm } from "@shared/hail-sim";
import { useAppStore } from "@renderer/store/appStore";
import { useHailReplayStore } from "@renderer/store/hailReplayStore";

/** The loaded event's cells, moved by the current shift. */
export function useShiftedEventCells(): HailEventCell[] {
  const detail = useHailReplayStore((s) => s.detail);
  const shift = useHailReplayStore((s) => s.shift);
  return useMemo(
    () =>
      detail
        ? shiftCells(detail.cells, shift, bboxCenterLat(detail.summary.bbox))
        : [],
    [detail, shift],
  );
}

/** Locations of the portfolio with coordinates, as the impact needs them. */
function useSites(): Array<{
  id: string;
  name: string;
  lat: number;
  lon: number;
  exposureEur: number;
}> {
  const dealerships = useAppStore((s) => s.dealerships);
  return useMemo(
    () =>
      dealerships
        .filter((d) => Number.isFinite(d.lat) && Number.isFinite(d.lon))
        .map((d) => ({
          id: d.id,
          name: d.name,
          lat: d.lat,
          lon: d.lon,
          exposureEur: d.risk?.exposureEur ?? 0,
        })),
    [dealerships],
  );
}

/**
 * Locations of the portfolio the loaded (and shifted) event reaches within
 * the chosen radius, with the stress-test loss per hail class from the
 * scenario parameters.
 */
export function useHailEventImpact(): HailEventImpact | null {
  const detail = useHailReplayStore((s) => s.detail);
  const radiusKm = useHailReplayStore((s) => s.radiusKm);
  const cells = useShiftedEventCells();
  const sites = useSites();
  const parameters = useAppStore((s) => s.parameters);
  return useMemo(() => {
    if (!detail) return null;
    return computeHailEventImpact(
      cells,
      sites,
      classDamageFromParameters(parameters),
      radiusKm,
    );
  }, [detail, cells, sites, parameters, radiusKm]);
}

/**
 * The location closest to the event's cell centres when it reaches none:
 * tells the user how far the storm missed the portfolio.
 */
export function useNearestMiss(): { name: string; km: number } | null {
  const impact = useHailEventImpact();
  const cells = useShiftedEventCells();
  const sites = useSites();
  return useMemo(() => {
    if (!impact || impact.hits.length > 0 || cells.length === 0) return null;
    let best: { name: string; km: number } | null = null;
    // Every 4th cell is plenty for a distance in whole kilometres.
    for (let i = 0; i < cells.length; i += 4) {
      const c = cells[i];
      for (const s of sites) {
        const km = groundKm(c.p, [s.lon, s.lat]);
        if (!best || km < best.km) best = { name: s.name, km };
      }
    }
    return best ? { name: best.name, km: Math.round(best.km) } : null;
  }, [impact, cells, sites]);
}

/** Coordinates of the portfolio's locations, for storms aimed at it. */
export function usePortfolioTargets(): Array<[number, number]> {
  const sites = useSites();
  return useMemo(
    () =>
      [...sites]
        .sort((a, b) => b.exposureEur - a.exposureEur)
        .map((s) => [s.lon, s.lat] as [number, number]),
    [sites],
  );
}
