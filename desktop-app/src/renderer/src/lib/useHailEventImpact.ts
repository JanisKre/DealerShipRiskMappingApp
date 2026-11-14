import { useMemo } from "react";
import {
  bboxCenterLat,
  classDamageFromParameters,
  computeHailEventImpact,
  shiftCells,
  type HailEventCell,
  type HailEventImpact,
} from "@shared/hail-events";
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

/**
 * Locations of the portfolio the loaded (and shifted) event reaches, with
 * the stress-test loss per hail class from the scenario parameters.
 */
export function useHailEventImpact(): HailEventImpact | null {
  const detail = useHailReplayStore((s) => s.detail);
  const cells = useShiftedEventCells();
  const dealerships = useAppStore((s) => s.dealerships);
  const parameters = useAppStore((s) => s.parameters);
  return useMemo(() => {
    if (!detail) return null;
    const sites = dealerships
      .filter((d) => Number.isFinite(d.lat) && Number.isFinite(d.lon))
      .map((d) => ({
        id: d.id,
        lat: d.lat,
        lon: d.lon,
        exposureEur: d.risk?.exposureEur ?? 0,
      }));
    return computeHailEventImpact(
      cells,
      sites,
      classDamageFromParameters(parameters),
    );
  }, [detail, cells, dealerships, parameters]);
}
