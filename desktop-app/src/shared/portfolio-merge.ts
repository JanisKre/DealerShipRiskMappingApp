import type { AnalyzedDealership } from "./types";

/**
 * Merges a shared portfolio file into the open portfolio. There is no multi
 * user mode: colleagues pass `.drm` files around, and the point of merging is
 * to bring their manually corrected lot boundaries and vehicle counts over.
 *
 * Locations match by id, otherwise by name and position (~10 m), because the
 * same CSV imported on two machines gets different ids.
 *
 * - No match: the location is added as it is.
 * - Match where only the incoming copy was edited by hand: its boundary and
 *   detection (with the manual vehicle review) replace the local ones. Every
 *   other local field (insurance, partner, notes, …) stays.
 * - Anything else keeps the local copy. If both were edited by hand and they
 *   differ, that is reported as a conflict instead of being decided silently.
 */

export interface PortfolioMergeResult {
  dealerships: AnalyzedDealership[];
  /** Ids of locations that came from the incoming portfolio. */
  addedIds: string[];
  /** Ids of local locations that took over an edited boundary/detection. */
  updatedIds: string[];
  /** Matched locations that already had the same data or a better local copy. */
  unchangedCount: number;
  /** Names of locations edited by hand on both sides with different results. */
  conflictNames: string[];
}

export function hasManualEdits(d: AnalyzedDealership): boolean {
  return (
    d.boundary?.source === "manual" || d.detection?.manualVehicleCount != null
  );
}

function positionKey(d: AnalyzedDealership): string {
  return `${d.name.trim().toLowerCase()}|${d.lat.toFixed(4)}|${d.lon.toFixed(4)}`;
}

function sameEdit(a: AnalyzedDealership, b: AnalyzedDealership): boolean {
  return (
    JSON.stringify([a.boundary?.polygon, a.detection?.manualVehiclePoints]) ===
    JSON.stringify([b.boundary?.polygon, b.detection?.manualVehiclePoints])
  );
}

export function mergePortfolios(
  current: AnalyzedDealership[],
  incoming: AnalyzedDealership[],
): PortfolioMergeResult {
  const byId = new Map(current.map((d) => [d.id, d]));
  const byPosition = new Map(current.map((d) => [positionKey(d), d]));
  const replacements = new Map<string, AnalyzedDealership>();
  const added: AnalyzedDealership[] = [];
  const conflictNames: string[] = [];
  let unchangedCount = 0;

  for (const inc of incoming) {
    const match = byId.get(inc.id) ?? byPosition.get(positionKey(inc));
    if (!match) {
      added.push(inc);
      continue;
    }
    // A second incoming copy of the same location must not undo an update.
    const local = replacements.get(match.id) ?? match;
    if (hasManualEdits(inc) && !hasManualEdits(local)) {
      replacements.set(match.id, {
        ...local,
        boundary: inc.boundary,
        boundaryBeforeManualEdit: inc.boundaryBeforeManualEdit,
        detection: inc.detection,
      });
    } else if (
      hasManualEdits(inc) &&
      hasManualEdits(local) &&
      !sameEdit(inc, local)
    ) {
      conflictNames.push(local.name);
    } else {
      unchangedCount++;
    }
  }

  return {
    dealerships: [...current.map((d) => replacements.get(d.id) ?? d), ...added],
    addedIds: added.map((d) => d.id),
    updatedIds: [...replacements.keys()],
    unchangedCount,
    conflictNames,
  };
}
