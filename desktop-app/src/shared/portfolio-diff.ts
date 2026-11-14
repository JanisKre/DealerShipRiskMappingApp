import type { AnalyzedDealership } from "./types";
import { dealershipHailZone, effectiveVehicleCount } from "./risk-math";

/**
 * Location-by-location comparison of two portfolio states (the active
 * portfolio against a saved snapshot or another portfolio). Locations are
 * matched by id, then by name (case-insensitive), so a re-imported file with
 * new ids still lines up. Pure and deterministic: the comparison table and
 * the optional AI explanation read the same result.
 */

export type DiffStatus = "added" | "removed" | "changed" | "unchanged";

export interface LocationDiff {
  /** Id in the current portfolio, or in the baseline for removed locations. */
  id: string;
  name: string;
  status: DiffStatus;
  vehicles: { from: number | null; to: number | null; delta: number };
  eal: { from: number | null; to: number | null; delta: number };
  hailZone: { from: number | null; to: number | null };
}

export interface PortfolioDiff {
  rows: LocationDiff[];
  totals: {
    added: number;
    removed: number;
    changed: number;
    unchanged: number;
    vehicleDelta: number;
    ealDelta: number;
  };
}

function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function vehicles(d: AnalyzedDealership | undefined): number | null {
  return d?.detection ? effectiveVehicleCount(d.detection) : null;
}

function zone(d: AnalyzedDealership | undefined): number | null {
  return d ? (dealershipHailZone(d)?.zone ?? null) : null;
}

/** EAL changes below one euro are rounding, not a change. */
const EAL_EPSILON = 1;

export function diffPortfolios(
  current: AnalyzedDealership[],
  baseline: AnalyzedDealership[],
): PortfolioDiff {
  const byId = new Map(baseline.map((d) => [d.id, d]));
  const byName = new Map<string, AnalyzedDealership>();
  for (const d of baseline) {
    const key = nameKey(d.name);
    if (!byName.has(key)) byName.set(key, d);
  }
  const matched = new Set<AnalyzedDealership>();

  const rows: LocationDiff[] = current.map((d) => {
    let base = byId.get(d.id);
    if (!base || matched.has(base)) {
      const candidate = byName.get(nameKey(d.name));
      base = candidate && !matched.has(candidate) ? candidate : undefined;
    }
    if (base) matched.add(base);
    const vFrom = vehicles(base);
    const vTo = vehicles(d);
    const eFrom = base ? (base.risk?.eal ?? null) : null;
    const eTo = d.risk?.eal ?? null;
    const zFrom = zone(base);
    const zTo = zone(d);
    const vehicleDelta = (vTo ?? 0) - (vFrom ?? 0);
    const ealDelta = (eTo ?? 0) - (eFrom ?? 0);
    const status: DiffStatus = !base
      ? "added"
      : vehicleDelta !== 0 || Math.abs(ealDelta) >= EAL_EPSILON || zFrom !== zTo
        ? "changed"
        : "unchanged";
    return {
      id: d.id,
      name: d.name,
      status,
      vehicles: { from: vFrom, to: vTo, delta: vehicleDelta },
      eal: { from: eFrom, to: eTo, delta: ealDelta },
      hailZone: { from: zFrom, to: zTo },
    };
  });

  for (const base of baseline) {
    if (matched.has(base)) continue;
    const vFrom = vehicles(base);
    const eFrom = base.risk?.eal ?? null;
    rows.push({
      id: base.id,
      name: base.name,
      status: "removed",
      vehicles: { from: vFrom, to: null, delta: -(vFrom ?? 0) },
      eal: { from: eFrom, to: null, delta: -(eFrom ?? 0) },
      hailZone: { from: zone(base), to: null },
    });
  }

  const count = (status: DiffStatus): number =>
    rows.filter((r) => r.status === status).length;
  return {
    rows,
    totals: {
      added: count("added"),
      removed: count("removed"),
      changed: count("changed"),
      unchanged: count("unchanged"),
      vehicleDelta: rows.reduce((sum, r) => sum + r.vehicles.delta, 0),
      ealDelta: rows.reduce((sum, r) => sum + r.eal.delta, 0),
    },
  };
}

/** Most changed locations listed in the facts for the AI explanation. */
export const DIFF_FACT_ROWS = 15;

/**
 * Plain-text facts for the optional AI explanation: totals and the largest
 * changes by absolute EAL delta. The model only explains these lines; every
 * figure in them was computed here.
 */
export function portfolioDiffFacts(
  diff: PortfolioDiff,
  baselineName: string,
): string {
  const round = (n: number | null): string =>
    n == null ? "–" : String(Math.round(n));
  const t = diff.totals;
  const lines = [
    `Baseline: ${baselineName}`,
    `Locations added: ${t.added}, removed: ${t.removed}, changed: ${t.changed}, unchanged: ${t.unchanged}`,
    `Total vehicle change: ${round(t.vehicleDelta)}`,
    `Total hail EAL change (EUR): ${round(t.ealDelta)}`,
  ];
  const notable = diff.rows
    .filter((r) => r.status !== "unchanged")
    .sort((a, b) => Math.abs(b.eal.delta) - Math.abs(a.eal.delta))
    .slice(0, DIFF_FACT_ROWS);
  if (notable.length > 0) {
    lines.push("Largest changes:");
    for (const r of notable) {
      lines.push(
        `- ${r.name} (${r.status}): vehicles ${round(r.vehicles.from)} → ${round(r.vehicles.to)}, hail EAL ${round(r.eal.from)} → ${round(r.eal.to)} EUR, hail zone ${r.hailZone.from ?? "–"} → ${r.hailZone.to ?? "–"}`,
      );
    }
  }
  return lines.join("\n");
}
