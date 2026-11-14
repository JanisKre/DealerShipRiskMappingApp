import { z } from "zod";
import { RiskEvidenceSchema } from "./types";
import {
  RADAR_HAIL_RADIUS_KM,
  RadarHailClassSchema,
  radarHailRank,
} from "./radar-hail";
import type { RadarHailClass } from "./radar-hail";

/**
 * Hail events for the map replay: hail cells from the local radar archive
 * (DWD KONRAD3D), linked into tracks and grouped into events, or footprints
 * the user imported as GeoJSON. The impact on the portfolio is a
 * deterministic stress test, not a hail EAL and not a catastrophe-model
 * PML. Methodology and limitations: docs/risk-model.md, "Hail event replay".
 */

/**
 * Where an event comes from: the live radar archive, a historic day from
 * the DWD radar climatology (RADKLIM), an imported footprint, a generated
 * storm, or a storm drawn on the map.
 */
export const HAIL_EVENT_SOURCES = [
  "radar",
  "radklim",
  "import",
  "simulation",
  "drawn",
] as const;
export const HailEventSourceSchema = z.enum(HAIL_EVENT_SOURCES);
export type HailEventSource = z.infer<typeof HailEventSourceSchema>;

/** [west, south, east, north] in degrees. */
export const BboxSchema = z.tuple([
  z.number(),
  z.number(),
  z.number(),
  z.number(),
]);
export type Bbox = z.infer<typeof BboxSchema>;

/** One cell outline at one time step. */
export const HailEventCellSchema = z.object({
  /** Unix ms of the radar step (or of the imported feature). */
  t: z.number(),
  /** Track the cell belongs to, numbered 0… within the event. */
  track: z.number().int().nonnegative(),
  c: RadarHailClassSchema,
  /** Maximum reflectivity (dBZ); 0 for imported footprints. */
  d: z.number(),
  /** Centroid [lon, lat]. */
  p: z.tuple([z.number(), z.number()]),
  b: BboxSchema,
  /** Outlines as flat [lon, lat, lon, lat, …] arrays. */
  r: z.array(z.array(z.number())),
});
export type HailEventCell = z.infer<typeof HailEventCellSchema>;

export const HailEventSummarySchema = z.object({
  id: z.string().min(1),
  source: HailEventSourceSchema,
  /** User-given name of an import; radar events are named by date. */
  name: z.string().nullable(),
  start: z.number(),
  end: z.number(),
  /** False for an import without times: shown as a static footprint. */
  timed: z.boolean(),
  maxClass: RadarHailClassSchema,
  maxDbz: z.number(),
  tracks: z.number().int().nonnegative(),
  cells: z.number().int().nonnegative(),
  bbox: BboxSchema,
});
export type HailEventSummary = z.infer<typeof HailEventSummarySchema>;

export const HailEventListSchema = z.object({
  events: z.array(HailEventSummarySchema),
  /** Time span of the radar archive, null while it is empty. */
  archiveFrom: z.string().nullable(),
  archiveTo: z.string().nullable(),
  steps: z.number().int().nonnegative(),
  synced: z.boolean(),
  syncing: z.boolean(),
});
export type HailEventList = z.infer<typeof HailEventListSchema>;

export const HailEventDetailSchema = z.object({
  summary: HailEventSummarySchema,
  /** Sorted by time, then track. */
  cells: z.array(HailEventCellSchema),
  evidence: RiskEvidenceSchema,
});
export type HailEventDetail = z.infer<typeof HailEventDetailSchema>;

/** Most cells one event may carry (import limit and IPC guard). */
export const MAX_EVENT_CELLS = 50_000;
/** Largest GeoJSON file accepted for an import. */
export const MAX_FOOTPRINT_BYTES = 20 * 1024 * 1024;

/** Summary of an event from its cells (sorted by time). */
export function summarizeEvent(
  id: string,
  source: HailEventSource,
  name: string | null,
  timed: boolean,
  cells: ReadonlyArray<{
    t: number;
    c: RadarHailClass;
    d: number;
    b: Bbox;
    track?: number;
  }>,
  tracks?: number,
): HailEventSummary {
  let maxClass: RadarHailClass = "mixed";
  let maxDbz = 0;
  const bbox: Bbox = [Infinity, Infinity, -Infinity, -Infinity];
  const trackIds = new Set<number>();
  for (const c of cells) {
    if (radarHailRank(c.c) > radarHailRank(maxClass)) maxClass = c.c;
    maxDbz = Math.max(maxDbz, c.d);
    bbox[0] = Math.min(bbox[0], c.b[0]);
    bbox[1] = Math.min(bbox[1], c.b[1]);
    bbox[2] = Math.max(bbox[2], c.b[2]);
    bbox[3] = Math.max(bbox[3], c.b[3]);
    if (c.track != null) trackIds.add(c.track);
  }
  return {
    id,
    source,
    name,
    start: cells[0]?.t ?? 0,
    end: cells.at(-1)?.t ?? 0,
    timed,
    maxClass,
    maxDbz,
    tracks: tracks ?? trackIds.size,
    cells: cells.length,
    bbox: cells.length > 0 ? bbox : [0, 0, 0, 0],
  };
}

/** Ids of stored events: import, saved scenario or historic day. */
export const STORED_EVENT_PREFIXES = ["import-", "saved-", "radklim-"] as const;

export function isStoredEventId(id: string): boolean {
  return STORED_EVENT_PREFIXES.some((p) => id.startsWith(p));
}

// --- Geometry -------------------------------------------------------------

const KM_PER_DEG_LAT = 111.32;

function kmPerDegLon(lat: number): number {
  return KM_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180) || 1e-9;
}

/** Distance from a point to a set of outlines in km; 0 inside one. */
export function distanceToRingsKm(
  lat: number,
  lon: number,
  rings: readonly (readonly number[])[],
): number {
  const kx = kmPerDegLon(lat);
  let best = Infinity;
  for (const ring of rings) {
    let inside = false;
    const n = ring.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = (ring[2 * i] - lon) * kx;
      const yi = (ring[2 * i + 1] - lat) * KM_PER_DEG_LAT;
      const xj = (ring[2 * j] - lon) * kx;
      const yj = (ring[2 * j + 1] - lat) * KM_PER_DEG_LAT;
      if (yi > 0 !== yj > 0 && 0 < ((xj - xi) * (0 - yi)) / (yj - yi) + xi)
        inside = !inside;
      const dx = xj - xi;
      const dy = yj - yi;
      const len2 = dx * dx + dy * dy;
      const t =
        len2 === 0 ? 0 : Math.max(0, Math.min(1, -(xi * dx + yi * dy) / len2));
      best = Math.min(best, Math.hypot(xi + t * dx, yi + t * dy));
    }
    if (inside) return 0;
  }
  return best;
}

/** True when the point lies within `radiusKm` of the box. */
export function nearBbox(
  lat: number,
  lon: number,
  b: Bbox,
  radiusKm: number,
): boolean {
  const dLat = radiusKm / KM_PER_DEG_LAT;
  const dLon = radiusKm / kmPerDegLon(lat);
  return (
    lon >= b[0] - dLon &&
    lon <= b[2] + dLon &&
    lat >= b[1] - dLat &&
    lat <= b[3] + dLat
  );
}

/** Shift on the ground, in km east and north. */
export interface EventShift {
  eastKm: number;
  northKm: number;
}

export const NO_SHIFT: EventShift = { eastKm: 0, northKm: 0 };

/** Degrees of longitude and latitude that a shift moves at `lat`. */
export function shiftDegrees(
  shift: EventShift,
  lat: number,
): { dLon: number; dLat: number } {
  return {
    dLon: shift.eastKm / kmPerDegLon(lat),
    dLat: shift.northKm / KM_PER_DEG_LAT,
  };
}

/**
 * The event moved on the ground. The degrees are taken at the event's
 * centre latitude, so a shift of 30 km north is 30 km everywhere in it
 * (to within the curvature over a few hundred km, well under 1 %).
 */
export function shiftCells(
  cells: readonly HailEventCell[],
  shift: EventShift,
  refLat: number,
): HailEventCell[] {
  if (shift.eastKm === 0 && shift.northKm === 0) return [...cells];
  const { dLon, dLat } = shiftDegrees(shift, refLat);
  return cells.map((cell) => ({
    ...cell,
    p: [cell.p[0] + dLon, cell.p[1] + dLat],
    b: [cell.b[0] + dLon, cell.b[1] + dLat, cell.b[2] + dLon, cell.b[3] + dLat],
    r: cell.r.map((ring) =>
      ring.map((v, i) => v + (i % 2 === 0 ? dLon : dLat)),
    ),
  }));
}

export function bboxCenterLat(b: Bbox): number {
  return (b[1] + b[3]) / 2;
}

// --- Impact on the portfolio ----------------------------------------------

/** A location as the impact needs it. */
export interface ImpactSite {
  id: string;
  lat: number;
  lon: number;
  exposureEur: number;
}

/** Damage fraction of the exposure per hail class. */
export type ClassDamage = Record<RadarHailClass, number>;

export const HailEventHitSchema = z.object({
  id: z.string(),
  /** First radar step with a cell within the radius (Unix ms). */
  firstAt: z.number(),
  /** Worst class among the cells within the radius. */
  hailClass: RadarHailClassSchema,
  /** Closest distance to a cell outline; 0 inside. */
  distanceKm: z.number().nonnegative(),
  exposureEur: z.number().nonnegative(),
  lossEur: z.number().nonnegative(),
});
export type HailEventHit = z.infer<typeof HailEventHitSchema>;

export interface HailEventImpact {
  /** Sorted by first hit, then id. */
  hits: HailEventHit[];
  totalExposureEur: number;
  totalLossEur: number;
  radiusKm: number;
}

/**
 * Locations a hail event reaches: a cell outline passes within `radiusKm`
 * (on the ground) of the site. The loss is the site's exposure times the
 * damage fraction of the worst class that reached it. Deterministic: the
 * same cells, sites and parameters always give the same result.
 */
export function computeHailEventImpact(
  cells: readonly HailEventCell[],
  sites: readonly ImpactSite[],
  damage: ClassDamage,
  radiusKm = RADAR_HAIL_RADIUS_KM,
): HailEventImpact {
  const hits: HailEventHit[] = [];
  if (cells.length > 0) {
    const all: Bbox = [Infinity, Infinity, -Infinity, -Infinity];
    for (const c of cells) {
      all[0] = Math.min(all[0], c.b[0]);
      all[1] = Math.min(all[1], c.b[1]);
      all[2] = Math.max(all[2], c.b[2]);
      all[3] = Math.max(all[3], c.b[3]);
    }
    for (const site of sites) {
      if (!Number.isFinite(site.lat) || !Number.isFinite(site.lon)) continue;
      if (!nearBbox(site.lat, site.lon, all, radiusKm)) continue;
      let hit: HailEventHit | null = null;
      for (const cell of cells) {
        if (!nearBbox(site.lat, site.lon, cell.b, radiusKm)) continue;
        const distance = distanceToRingsKm(site.lat, site.lon, cell.r);
        if (distance > radiusKm) continue;
        if (!hit) {
          hit = {
            id: site.id,
            firstAt: cell.t,
            hailClass: cell.c,
            distanceKm: distance,
            exposureEur: Math.max(0, site.exposureEur),
            lossEur: 0,
          };
          continue;
        }
        hit.firstAt = Math.min(hit.firstAt, cell.t);
        hit.distanceKm = Math.min(hit.distanceKm, distance);
        if (radarHailRank(cell.c) > radarHailRank(hit.hailClass))
          hit.hailClass = cell.c;
      }
      if (!hit) continue;
      hit.distanceKm = Math.round(hit.distanceKm * 100) / 100;
      hit.lossEur = Math.round(hit.exposureEur * (damage[hit.hailClass] ?? 0));
      hits.push(hit);
    }
  }
  hits.sort((a, b) => a.firstAt - b.firstAt || a.id.localeCompare(b.id));
  return {
    hits,
    totalExposureEur: hits.reduce((s, h) => s + h.exposureEur, 0),
    totalLossEur: hits.reduce((s, h) => s + h.lossEur, 0),
    radiusKm,
  };
}

/**
 * Damage fraction per class from the scenario parameters: large hail →
 * high, hail → medium, rain–hail mixture → low.
 */
export function classDamageFromParameters(p: {
  scenarioDamageLow: number;
  scenarioDamageMedium: number;
  scenarioDamageHigh: number;
}): ClassDamage {
  return {
    large: p.scenarioDamageHigh,
    hail: p.scenarioDamageMedium,
    mixed: p.scenarioDamageLow,
  };
}

// --- Replay frames ----------------------------------------------------------

/** Index of the first cell with `t > time` (cells sorted by time). */
export function upperBoundByTime(
  cells: readonly HailEventCell[],
  time: number,
): number {
  let lo = 0;
  let hi = cells.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cells[mid].t <= time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** A cell as drawn at one moment of the replay. */
export interface ReplayCell {
  cell: HailEventCell;
  /** Translation applied to the outline, degrees. */
  dLon: number;
  dLat: number;
}

/**
 * The cells to draw at `time`: per track the latest step at or before
 * `time`, moved towards the track's next step by the elapsed fraction, so
 * the cells glide instead of jumping every 5 minutes. A track whose last
 * step is more than `holdMs` old is no longer drawn as live.
 */
export function replayFrame(
  cells: readonly HailEventCell[],
  time: number,
  holdMs = 5 * 60 * 1000,
): ReplayCell[] {
  const end = upperBoundByTime(cells, time);
  const latest = new Map<number, number>();
  for (let i = 0; i < end; i++) latest.set(cells[i].track, i);
  const frame: ReplayCell[] = [];
  for (const [track, index] of latest) {
    const cell = cells[index];
    if (time - cell.t > holdMs) continue;
    let next: HailEventCell | null = null;
    for (let i = end; i < cells.length; i++) {
      if (cells[i].t - cell.t > holdMs * 2) break;
      if (cells[i].track === track) {
        next = cells[i];
        break;
      }
    }
    let dLon = 0;
    let dLat = 0;
    if (next && next.t > cell.t) {
      const f = Math.min(1, (time - cell.t) / (next.t - cell.t));
      dLon = (next.p[0] - cell.p[0]) * f;
      dLat = (next.p[1] - cell.p[1]) * f;
    }
    frame.push({ cell, dLon, dLat });
  }
  return frame.sort((a, b) => a.cell.track - b.cell.track);
}
