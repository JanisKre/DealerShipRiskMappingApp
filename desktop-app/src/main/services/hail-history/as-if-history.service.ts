import { createHash } from "node:crypto";
import type { RiskEvidence } from "@shared/types";
import {
  AsIfHistorySchema,
  CandidateDaysSchema,
  aggregateAsIf,
  isAsIfSource,
  rankCandidateDays,
  utcDay,
  type AsIfEvent,
  type AsIfEventHit,
  type AsIfHistory,
  type AsIfRequest,
  type AsIfSite,
  type CandidateDays,
} from "@shared/as-if-history";
import {
  computeHailEventImpact,
  type HailEventCell,
  type HailEventSource,
} from "@shared/hail-events";
import {
  hailEventDetail,
  radarEventSummaries,
  storedEvent,
  storedEventIds,
} from "./hail-events.service";
import {
  HAIL_HISTORY_RADIUS_KM,
  hailDatesNearPortfolio,
} from "./hail-history.service";
import { RADKLIM_FIRST_DAY } from "./radklim.service";

/**
 * As-if history: every real storm day stored in the app applied to the
 * locations the renderer sends. Reads the stored historic days (RADKLIM),
 * timed imports and the radar archive; generated and drawn storms are left
 * out. Methodology and limitations: docs/risk-model.md, "As-if history".
 */

/** Site sets whose per-event results are kept (the dashboard's filters). */
const MAX_CACHED_SITE_SETS = 3;

/**
 * Locations each event reached, per site set. A stored event never changes
 * under its id, and a radar event's key carries its size, so a cached entry
 * stays valid; reading and testing a day's cells again is what costs time.
 */
const hitCache = new Map<string, Map<string, AsIfEventHit[]>>();

/** Test hook. */
export function resetAsIfHistoryForTests(): void {
  hitCache.clear();
}

function siteSetKey(sites: readonly AsIfSite[], radiusKm: number): string {
  const hash = createHash("sha1");
  hash.update(String(radiusKm));
  for (const s of sites)
    hash.update(`|${s.id},${s.lat},${s.lon},${s.exposureEur}`);
  return hash.digest("hex");
}

function cacheFor(key: string): Map<string, AsIfEventHit[]> {
  const known = hitCache.get(key);
  if (known) {
    // Most recently used last.
    hitCache.delete(key);
    hitCache.set(key, known);
    return known;
  }
  const fresh = new Map<string, AsIfEventHit[]>();
  hitCache.set(key, fresh);
  while (hitCache.size > MAX_CACHED_SITE_SETS) {
    const oldest = hitCache.keys().next().value;
    if (oldest == null) break;
    hitCache.delete(oldest);
  }
  return fresh;
}

const NO_DAMAGE = { large: 0, hail: 0, mixed: 0 };

function hitsOf(
  cells: readonly HailEventCell[],
  sites: readonly AsIfSite[],
  radiusKm: number,
): AsIfEventHit[] {
  return computeHailEventImpact(cells, sites, NO_DAMAGE, radiusKm).hits.map(
    (hit) => ({
      id: hit.id,
      hailClass: hit.hailClass,
      exposureEur: hit.exposureEur,
    }),
  );
}

/** Day of a stored historic day from its id (`radklim-YYYYMMDD`). */
export function radklimDayOfId(id: string): string | null {
  const m = /^radklim-(\d{4})(\d{2})(\d{2})$/.exec(id);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Stored historic days (YYYY-MM-DD), without reading their cells. */
export function loadedHistoricDays(): Set<string> {
  const days = new Set<string>();
  for (const id of storedEventIds()) {
    const day = radklimDayOfId(id);
    if (day) days.add(day);
  }
  return days;
}

const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

export function asIfEvidence(): RiskEvidence {
  return {
    source:
      "Deutscher Wetterdienst (DWD): RADKLIM YW 2017.002 historic days, KONRAD3D radar archive; imported footprints",
    retrievedAt: new Date().toISOString(),
    dataVersion: "storm days stored in the app",
    spatialResolution: "cell outlines, 5-minute steps",
    method:
      "Each stored real storm day applied to today's locations: a location is reached when a cell outline passes within the reach; loss = today's exposure × damage rate of the worst class that day; one loss per location and day; summed per year",
    confidence: 0.25,
    fallbackUsed: false,
    limitations: [
      "Only days loaded into the app are evaluated: a year without a loaded day is not checked, which is not the same as loss-free",
      "The loaded days are chosen, not a random sample, so no mean annual loss and no return period follow from them",
      "Today's locations, stock and values are applied to past days; what stood on the lots then is not known",
      "Historic days are a precipitation proxy for hail (RADKLIM), not observed hail; the radar archive holds whole storm cells",
      "Every location reached gets the damage rate of the class; hail size, duration and protection are not modelled",
      "Stress test only: not the hail EAL and not a catastrophe-model PML",
    ],
  };
}

/**
 * The as-if history for the given locations. Events are read one at a time
 * and the event loop is released between them, so a long list of days does
 * not freeze the app.
 */
export async function asIfHistory(request: AsIfRequest): Promise<AsIfHistory> {
  const sites = request.sites.filter(
    (s) => Number.isFinite(s.lat) && Number.isFinite(s.lon),
  );
  const cache = cacheFor(siteSetKey(sites, request.radiusKm));
  const events: AsIfEvent[] = [];
  const seen = new Set<string>();

  const add = (
    key: string,
    id: string,
    source: HailEventSource,
    day: string,
    cells: () => readonly HailEventCell[] | null,
  ): void => {
    seen.add(key);
    let hits = cache.get(key);
    if (!hits) {
      const loaded = cells();
      if (!loaded) return;
      hits = hitsOf(loaded, sites, request.radiusKm);
      cache.set(key, hits);
    }
    events.push({ id, source, day, hits });
  };

  for (const id of storedEventIds()) {
    const day = radklimDayOfId(id);
    if (day) {
      add(id, id, "radklim", day, () => storedEvent(id)?.cells ?? null);
    } else if (id.startsWith("import-")) {
      // Imports are few; the summary says whether the footprint has times.
      const event = storedEvent(id);
      if (!event?.summary.timed || !isAsIfSource(event.summary.source))
        continue;
      add(id, id, "import", utcDay(event.summary.start), () => event.cells);
    } else {
      continue;
    }
    await yieldToEventLoop();
  }
  for (const summary of radarEventSummaries()) {
    // An event still running grows; its size is part of the key.
    const key = `${summary.id}:${summary.cells}:${summary.end}`;
    add(
      key,
      summary.id,
      "radar",
      utcDay(summary.start),
      () => hailEventDetail(summary.id)?.cells ?? null,
    );
    await yieldToEventLoop();
  }
  // Events that are gone (deleted import, pruned archive) leave the cache.
  for (const key of [...cache.keys()]) if (!seen.has(key)) cache.delete(key);

  const result = aggregateAsIf(events, request.damage);
  return AsIfHistorySchema.parse({
    ...result,
    totals: {
      ...result.totals,
      sites: sites.length,
      exposureEur: Math.round(sites.reduce((s, x) => s + x.exposureEur, 0)),
    },
    radiusKm: request.radiusKm,
    evidence: asIfEvidence(),
  });
}

function candidateEvidence(): RiskEvidence {
  return {
    source: "Deutscher Wetterdienst (DWD), Climate Data Center",
    retrievedAt: new Date().toISOString(),
    dataVersion: "daily weather_phenomena (historical + recent)",
    spatialResolution: "station points",
    method: `Days on which the station nearest to a location (within ${HAIL_HISTORY_RADIUS_KM} km) observed hail, ranked by the exposure of those locations`,
    confidence: 0.3,
    fallbackUsed: false,
    limitations: [
      "A ranking of days worth loading, not a list of all hail days: hail that missed the station is not in it",
      "Most stations stopped observing weather phenomena around 2011, so later storm days are mostly missing and have to be entered by date",
      "A hail observation up to 30 km away does not mean the location was hit; the loaded day decides that",
    ],
  };
}

/**
 * Days worth loading for the given locations: hail days at the stations
 * nearest to them, from the first RADKLIM day to yesterday.
 */
export async function suggestHistoricDays(
  sites: readonly AsIfSite[],
  now = Date.now(),
): Promise<CandidateDays> {
  const located = sites.filter(
    (s) => Number.isFinite(s.lat) && Number.isFinite(s.lon),
  );
  const dates = await hailDatesNearPortfolio(
    located,
    Number(RADKLIM_FIRST_DAY.slice(0, 4)),
  );
  return CandidateDaysSchema.parse({
    days: rankCandidateDays(dates.assignments, dates.datesByStation, {
      from: RADKLIM_FIRST_DAY,
      to: utcDay(now - 24 * 60 * 60 * 1000),
      loaded: loadedHistoricDays(),
    }),
    stationsUsed: dates.stationsUsed,
    sitesCovered: dates.sitesCovered,
    sitesTotal: located.length,
    firstYear: dates.firstYear,
    lastYear: dates.lastYear,
    evidence: candidateEvidence(),
  });
}
