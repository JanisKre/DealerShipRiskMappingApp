import type {
  A2uiCall,
  A2uiDimension,
  A2uiFilter,
  A2uiMeasure,
  A2uiSurface,
} from "./a2ui";
import type { AnalyzedDealership } from "./types";
import { dealershipHailZone, effectiveVehicleCount } from "./risk-math";

/**
 * Evaluates the dashboard catalog's functions on the portfolio. Pure and
 * deterministic: the same portfolio and call always give the same figures,
 * and no figure ever comes from the model.
 */

/** Group key for locations without a value in the grouped field. */
export const NONE_KEY = "__none__";
/** Group key that collects the groups beyond the limit. */
export const OTHER_KEY = "__other__";

export interface SeriesPoint {
  /** Location name (ranking) or group key (breakdown). */
  key: string;
  value: number;
  /** Location id, for ranking points. */
  id?: string;
}

export interface LocationRow {
  id: string;
  name: string;
  hailZone: number | null;
  eal: number;
  exposure: number;
  vehicles: number;
  business: "existing" | "new";
  salesPartner?: string;
  subPortfolio?: string;
  group?: string;
}

export type CallResult =
  | { kind: "value"; measure: A2uiMeasure; value: number; count: number }
  | {
      kind: "series";
      measure: A2uiMeasure;
      by: A2uiDimension | "location";
      points: SeriesPoint[];
      count: number;
    }
  | { kind: "rows"; measure: A2uiMeasure; rows: LocationRow[]; count: number };

export function measureValue(d: AnalyzedDealership, m: A2uiMeasure): number {
  switch (m) {
    case "count":
      return 1;
    case "eal":
      return d.risk?.eal ?? 0;
    case "exposure":
      return d.risk?.exposureEur ?? 0;
    case "vehicles":
      return d.detection ? effectiveVehicleCount(d.detection) : 0;
  }
}

/** Business type as the app counts it: unknown counts as new business. */
function business(d: AnalyzedDealership): "existing" | "new" {
  return d.insured === true ? "existing" : "new";
}

function same(a: string | undefined, b: string): boolean {
  return a != null && a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function applyFilter(
  dealerships: AnalyzedDealership[],
  filter: A2uiFilter | undefined,
): AnalyzedDealership[] {
  if (!filter) return dealerships;
  return dealerships.filter((d) => {
    const zone = dealershipHailZone(d)?.zone;
    if (
      filter.minHailZone != null &&
      (zone == null || zone < filter.minHailZone)
    )
      return false;
    if (
      filter.maxHailZone != null &&
      (zone == null || zone > filter.maxHailZone)
    )
      return false;
    if (filter.business && business(d) !== filter.business) return false;
    if (filter.salesPartner && !same(d.salesPartner, filter.salesPartner))
      return false;
    if (filter.subPortfolio && !same(d.subPortfolio, filter.subPortfolio))
      return false;
    if (filter.group && !same(d.group, filter.group)) return false;
    if (filter.boundaryReview && !d.boundary?.reviewRequired) return false;
    return true;
  });
}

function groupKey(d: AnalyzedDealership, by: A2uiDimension): string {
  switch (by) {
    case "hailZone": {
      const zone = dealershipHailZone(d)?.zone;
      return zone == null ? NONE_KEY : String(zone);
    }
    case "business":
      return business(d);
    case "salesPartner":
      return d.salesPartner?.trim() || NONE_KEY;
    case "subPortfolio":
      return d.subPortfolio?.trim() || NONE_KEY;
    case "group":
      return d.group?.trim() || NONE_KEY;
  }
}

function toRow(d: AnalyzedDealership): LocationRow {
  return {
    id: d.id,
    name: d.name,
    hailZone: dealershipHailZone(d)?.zone ?? null,
    eal: measureValue(d, "eal"),
    exposure: measureValue(d, "exposure"),
    vehicles: measureValue(d, "vehicles"),
    business: business(d),
    ...(d.salesPartner ? { salesPartner: d.salesPartner } : {}),
    ...(d.subPortfolio ? { subPortfolio: d.subPortfolio } : {}),
    ...(d.group ? { group: d.group } : {}),
  };
}

const byValueThenName = (
  a: { value: number; key: string },
  b: { value: number; key: string },
): number => b.value - a.value || a.key.localeCompare(b.key);

export function evaluateCall(
  call: A2uiCall,
  dealerships: AnalyzedDealership[],
): CallResult {
  const selected = applyFilter(
    dealerships.filter((d) => d.lat != null && d.lon != null),
    call.args.filter,
  );
  switch (call["@call"]) {
    case "aggregate": {
      const { measure } = call.args;
      return {
        kind: "value",
        measure,
        value: selected.reduce((sum, d) => sum + measureValue(d, measure), 0),
        count: selected.length,
      };
    }
    case "ranking": {
      const { measure, limit } = call.args;
      const points = selected
        .map((d) => ({
          key: d.name,
          id: d.id,
          value: measureValue(d, measure),
        }))
        .sort(byValueThenName)
        .slice(0, limit);
      return {
        kind: "series",
        measure,
        by: "location",
        points,
        count: selected.length,
      };
    }
    case "breakdown": {
      const { measure, by, limit } = call.args;
      const totals = new Map<string, number>();
      for (const d of selected) {
        const key = groupKey(d, by);
        totals.set(key, (totals.get(key) ?? 0) + measureValue(d, measure));
      }
      let points = [...totals].map(([key, value]) => ({ key, value }));
      if (by === "hailZone") {
        // Zones keep their natural order; locations without one go last.
        points.sort((a, b) =>
          a.key === NONE_KEY
            ? 1
            : b.key === NONE_KEY
              ? -1
              : Number(a.key) - Number(b.key),
        );
      } else {
        points.sort(byValueThenName);
        if (points.length > limit) {
          const rest = points.slice(limit - 1);
          points = [
            ...points.slice(0, limit - 1),
            { key: OTHER_KEY, value: rest.reduce((s, p) => s + p.value, 0) },
          ];
        }
      }
      return { kind: "series", measure, by, points, count: selected.length };
    }
    case "locations": {
      const { sortBy, limit } = call.args;
      const rows = selected
        .map(toRow)
        .sort((a, b) => b[sortBy] - a[sortBy] || a.name.localeCompare(b.name))
        .slice(0, limit);
      return { kind: "rows", measure: sortBy, rows, count: selected.length };
    }
  }
}

/**
 * Distinct values the model may use in filters, most frequent first.
 * Spellings that differ only in case or spaces count as one (the filter
 * matches that way too); the first spelling seen is kept.
 */
export function filterValues(
  dealerships: AnalyzedDealership[],
  field: "salesPartner" | "subPortfolio" | "group",
  max = 40,
): string[] {
  const groups = new Map<string, { value: string; count: number }>();
  for (const d of dealerships) {
    const value = d[field]?.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    const entry = groups.get(key) ?? { value, count: 0 };
    entry.count++;
    groups.set(key, entry);
  }
  return [...groups.values()]
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, max)
    .map((g) => g.value.slice(0, 120));
}

/** JSON with sorted keys, so equal filters compare equal. */
function stableKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableKey).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${k}:${stableKey((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(value ?? null);
}

export function filterKey(filter: A2uiFilter | undefined): string {
  return stableKey(filter ?? {});
}

/** The data calls of a surface: every KPI, chart and table source. */
export function surfaceDataCalls(
  surface: A2uiSurface,
): Array<{ args: { filter?: A2uiFilter } }> {
  return surface.components.flatMap(
    (c): Array<{ args: { filter?: A2uiFilter } }> =>
      c.component === "KpiCard"
        ? [c.value]
        : c.component === "BarChart" || c.component === "PieChart"
          ? [c.data]
          : c.component === "Table"
            ? [c.rows]
            : [],
  );
}

/**
 * The selection every data component of a surface shares, if they all use
 * the same filter — then the page states it once instead of on every card.
 * `undefined` when the components differ (or there is no data component).
 */
export function sharedFilter(
  calls: Array<{ args: { filter?: A2uiFilter } }>,
): { filter: A2uiFilter | undefined } | undefined {
  if (calls.length === 0) return undefined;
  const first = filterKey(calls[0].args.filter);
  return calls.every((c) => filterKey(c.args.filter) === first)
    ? { filter: calls[0].args.filter }
    : undefined;
}

/**
 * Whether every data component of a surface shares one selection that no
 * mapped location matches — the dashboard then shows only zeros and empty
 * charts, which the chat should say instead of just "done".
 */
export function emptySelection(
  surface: A2uiSurface,
  dealerships: AnalyzedDealership[],
): boolean {
  const shared = sharedFilter(surfaceDataCalls(surface));
  if (!shared?.filter) return false;
  const located = dealerships.filter((d) => d.lat != null && d.lon != null);
  return located.length > 0 && applyFilter(located, shared.filter).length === 0;
}

/** Round axis ticks (steps of 1, 2, 2.5 or 5 × 10ⁿ) from 0 past `max`. */
export function niceTicks(max: number, target = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const rough = max / target;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / magnitude;
  const step =
    (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) *
    magnitude;
  const ticks: number[] = [];
  for (let v = 0; v < max + step / 2; v += step)
    ticks.push(Math.round(v * 1e6) / 1e6);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}
