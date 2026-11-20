import { z } from "zod";
import { RiskEvidenceSchema } from "./types";
import {
  HailEventSourceSchema,
  type ClassDamage,
  type HailEventSource,
} from "./hail-events";
import {
  RadarHailClassSchema,
  radarHailRank,
  type RadarHailClass,
} from "./radar-hail";

/**
 * As-if history: the real storm days stored in the app (historic days from
 * the DWD radar climatology, the radar archive, timed imports) applied to
 * today's portfolio. Per day the locations a storm reached and the
 * stress-test loss (exposure × damage rate of the hail class), summed per
 * year.
 *
 * Only loaded days are evaluated. A year without a loaded day is not
 * checked, which is not the same as loss-free, so no mean annual loss is
 * derived. Not the hail EAL and not a catastrophe-model PML. Methodology:
 * docs/risk-model.md, "As-if history".
 */

/** Sources that are real events; generated and drawn storms are not. */
export const AS_IF_SOURCES = ["radklim", "radar", "import"] as const;

export function isAsIfSource(source: HailEventSource): boolean {
  return (AS_IF_SOURCES as readonly string[]).includes(source);
}

/** Most locations one request may carry (IPC guard). */
export const MAX_AS_IF_SITES = 20_000;
/** Locations listed per day, largest loss first. */
export const AS_IF_HITS_PER_DAY = 10;

export const AsIfSiteSchema = z.object({
  id: z.string().min(1).max(200),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  exposureEur: z.number().nonnegative(),
});
export type AsIfSite = z.infer<typeof AsIfSiteSchema>;

/** Damage fraction of the exposure per hail class, from the parameters. */
export const AsIfDamageSchema = z.object({
  large: z.number().min(0).max(1),
  hail: z.number().min(0).max(1),
  mixed: z.number().min(0).max(1),
});

export const AsIfRequestSchema = z.object({
  sites: z.array(AsIfSiteSchema).max(MAX_AS_IF_SITES),
  damage: AsIfDamageSchema,
  /** Reach of a cell outline on the ground, as in the map replay. */
  radiusKm: z.number().min(0).max(10),
});
export type AsIfRequest = z.infer<typeof AsIfRequestSchema>;

/** One location reached on one day. */
export const AsIfHitSchema = z.object({
  id: z.string(),
  hailClass: RadarHailClassSchema,
  exposureEur: z.number().nonnegative(),
  lossEur: z.number().nonnegative(),
});
export type AsIfHit = z.infer<typeof AsIfHitSchema>;

export const AsIfDaySchema = z.object({
  /** UTC day, YYYY-MM-DD. */
  day: z.string(),
  /** Events of that day, to open on the map. */
  eventIds: z.array(z.string()),
  sources: z.array(HailEventSourceSchema),
  hitCount: z.number().int().nonnegative(),
  /** Exposure of the locations reached. */
  exposureEur: z.number().nonnegative(),
  lossEur: z.number().nonnegative(),
  /** Worst class among the locations reached; null when none was. */
  maxClass: RadarHailClassSchema.nullable(),
  /** The {@link AS_IF_HITS_PER_DAY} locations with the largest loss. */
  hits: z.array(AsIfHitSchema),
});
export type AsIfDay = z.infer<typeof AsIfDaySchema>;

export const AsIfYearSchema = z.object({
  year: z.number().int(),
  /** Days of that year that were evaluated. */
  days: z.number().int().nonnegative(),
  /** Of those, days on which a location was reached. */
  hitDays: z.number().int().nonnegative(),
  lossEur: z.number().nonnegative(),
  worstDay: z.string().nullable(),
  worstDayLossEur: z.number().nonnegative(),
});
export type AsIfYear = z.infer<typeof AsIfYearSchema>;

export const AsIfHistorySchema = z.object({
  /** Newest first. */
  days: z.array(AsIfDaySchema),
  /** Oldest first; only years with at least one evaluated day. */
  years: z.array(AsIfYearSchema),
  totals: z.object({
    days: z.number().int().nonnegative(),
    hitDays: z.number().int().nonnegative(),
    lossEur: z.number().nonnegative(),
    sites: z.number().int().nonnegative(),
    exposureEur: z.number().nonnegative(),
  }),
  radiusKm: z.number().nonnegative(),
  evidence: RiskEvidenceSchema,
});
export type AsIfHistory = z.infer<typeof AsIfHistorySchema>;

/** A location one event reached, before the loss is priced. */
export interface AsIfEventHit {
  id: string;
  hailClass: RadarHailClass;
  exposureEur: number;
}

/** One real event with the locations it reached. */
export interface AsIfEvent {
  id: string;
  source: HailEventSource;
  /** UTC day the event counts for, YYYY-MM-DD. */
  day: string;
  hits: readonly AsIfEventHit[];
}

/** UTC day of a moment, YYYY-MM-DD. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Days and years from the events' hits. A location counts once per day:
 * when several events of a day reach it (two sources for the same storm, or
 * two storms), it keeps the worst class. An event that reached nothing
 * still makes its day an evaluated day with no loss. Deterministic.
 */
export function aggregateAsIf(
  events: readonly AsIfEvent[],
  damage: ClassDamage,
): Pick<AsIfHistory, "days" | "years"> & {
  totals: Pick<AsIfHistory["totals"], "days" | "hitDays" | "lossEur">;
} {
  const byDay = new Map<
    string,
    {
      eventIds: string[];
      sources: Set<HailEventSource>;
      hits: Map<string, AsIfEventHit>;
    }
  >();
  for (const event of events) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(event.day)) continue;
    let entry = byDay.get(event.day);
    if (!entry) {
      entry = { eventIds: [], sources: new Set(), hits: new Map() };
      byDay.set(event.day, entry);
    }
    entry.eventIds.push(event.id);
    entry.sources.add(event.source);
    for (const hit of event.hits) {
      const known = entry.hits.get(hit.id);
      if (
        !known ||
        radarHailRank(hit.hailClass) > radarHailRank(known.hailClass)
      )
        entry.hits.set(hit.id, hit);
    }
  }

  const days: AsIfDay[] = [...byDay.entries()].map(([day, entry]) => {
    const hits: AsIfHit[] = [...entry.hits.values()]
      .map((hit) => {
        const exposureEur = Math.max(0, hit.exposureEur);
        return {
          id: hit.id,
          hailClass: hit.hailClass,
          exposureEur,
          lossEur: Math.round(exposureEur * (damage[hit.hailClass] ?? 0)),
        };
      })
      .sort((a, b) => b.lossEur - a.lossEur || a.id.localeCompare(b.id));
    let maxClass: RadarHailClass | null = null;
    for (const hit of hits)
      if (!maxClass || radarHailRank(hit.hailClass) > radarHailRank(maxClass))
        maxClass = hit.hailClass;
    return {
      day,
      eventIds: [...entry.eventIds].sort(),
      sources: [...entry.sources].sort(),
      hitCount: hits.length,
      exposureEur: Math.round(hits.reduce((s, h) => s + h.exposureEur, 0)),
      lossEur: hits.reduce((s, h) => s + h.lossEur, 0),
      maxClass,
      hits: hits.slice(0, AS_IF_HITS_PER_DAY),
    };
  });
  days.sort((a, b) => b.day.localeCompare(a.day));

  const byYear = new Map<number, AsIfYear>();
  for (const day of days) {
    const year = Number(day.day.slice(0, 4));
    const row = byYear.get(year) ?? {
      year,
      days: 0,
      hitDays: 0,
      lossEur: 0,
      worstDay: null,
      worstDayLossEur: 0,
    };
    row.days += 1;
    if (day.hitCount > 0) row.hitDays += 1;
    row.lossEur += day.lossEur;
    // Days are newest first: on a tie the earlier day of the year wins.
    if (day.lossEur > 0 && day.lossEur >= row.worstDayLossEur) {
      row.worstDay = day.day;
      row.worstDayLossEur = day.lossEur;
    }
    byYear.set(year, row);
  }
  const years = [...byYear.values()].sort((a, b) => a.year - b.year);

  return {
    days,
    years,
    totals: {
      days: days.length,
      hitDays: days.filter((d) => d.hitCount > 0).length,
      lossEur: days.reduce((s, d) => s + d.lossEur, 0),
    },
  };
}

// --- Days worth loading -----------------------------------------------------

/** Days proposed at most. */
export const MAX_CANDIDATE_DAYS = 30;

export const CandidateDaySchema = z.object({
  day: z.string(),
  /** Stations near the portfolio that observed hail that day. */
  stations: z.number().int().nonnegative(),
  /** Locations whose nearest station observed hail that day. */
  sites: z.number().int().nonnegative(),
  /** Exposure of those locations. */
  exposureEur: z.number().nonnegative(),
  /** Already stored as a historic day. */
  loaded: z.boolean(),
});
export type CandidateDay = z.infer<typeof CandidateDaySchema>;

export const CandidateDaysSchema = z.object({
  days: z.array(CandidateDaySchema),
  /** Stations whose records were read. */
  stationsUsed: z.number().int().nonnegative(),
  /** Locations with a station in reach, of all locations sent. */
  sitesCovered: z.number().int().nonnegative(),
  sitesTotal: z.number().int().nonnegative(),
  /** Years the stations' records cover from 2001 on; null without any. */
  firstYear: z.number().int().nullable(),
  lastYear: z.number().int().nullable(),
  evidence: RiskEvidenceSchema,
});
export type CandidateDays = z.infer<typeof CandidateDaysSchema>;

export const CandidateDaysRequestSchema = z.object({
  sites: z.array(AsIfSiteSchema).max(MAX_AS_IF_SITES),
});

/**
 * Hail days observed at the stations nearest to the locations, ranked by
 * the exposure of the locations whose station reported hail (then by the
 * number of locations, then newest first). `assignments` maps each covered
 * location to its station; `datesByStation` holds the stations' hail dates
 * (YYYY-MM-DD). Deterministic.
 */
export function rankCandidateDays(
  assignments: ReadonlyArray<{ stationId: string; exposureEur: number }>,
  datesByStation: ReadonlyMap<string, readonly string[]>,
  options: {
    /** Earliest day to propose, YYYY-MM-DD. */
    from: string;
    /** Latest day to propose, YYYY-MM-DD. */
    to: string;
    loaded?: ReadonlySet<string>;
    limit?: number;
  },
): CandidateDay[] {
  const perStation = new Map<string, { sites: number; exposureEur: number }>();
  for (const a of assignments) {
    const entry = perStation.get(a.stationId) ?? { sites: 0, exposureEur: 0 };
    entry.sites += 1;
    entry.exposureEur += Math.max(0, a.exposureEur);
    perStation.set(a.stationId, entry);
  }
  const byDay = new Map<
    string,
    { stations: number; sites: number; exposureEur: number }
  >();
  for (const [stationId, served] of perStation) {
    for (const day of new Set(datesByStation.get(stationId) ?? [])) {
      if (day < options.from || day > options.to) continue;
      const entry = byDay.get(day) ?? { stations: 0, sites: 0, exposureEur: 0 };
      entry.stations += 1;
      entry.sites += served.sites;
      entry.exposureEur += served.exposureEur;
      byDay.set(day, entry);
    }
  }
  return [...byDay.entries()]
    .map(([day, entry]) => ({
      day,
      stations: entry.stations,
      sites: entry.sites,
      exposureEur: Math.round(entry.exposureEur),
      loaded: options.loaded?.has(day) ?? false,
    }))
    .sort(
      (a, b) =>
        b.exposureEur - a.exposureEur ||
        b.sites - a.sites ||
        b.day.localeCompare(a.day),
    )
    .slice(0, options.limit ?? MAX_CANDIDATE_DAYS);
}
