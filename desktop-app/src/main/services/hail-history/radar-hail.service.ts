import type { RiskEvidence } from "@shared/types";
import {
  RADAR_HAIL_RADIUS_KM,
  radarHailRank,
  type RadarHailClass,
  type RadarHailDay,
  type RadarHailResult,
} from "@shared/radar-hail";
import { cacheGet, cacheSet } from "../cache.service";
import { fetchWithResilience } from "../http.service";

/**
 * Local archive of the hail cells tracked by DWD's radar cell tracking
 * KONRAD3D (open data, `weather/radar/konrad3d`). DWD keeps the last 48
 * hours of 5-minute XML files on the server; each sync downloads the files
 * not yet in the archive and keeps only cells with hail (by the hydrometeor
 * classification in the file), so the archive grows from the first use on
 * and costs a few kilobytes per hail cell.
 *
 * Nothing about the portfolio is sent: the files cover all of Germany and
 * the comparison with the locations runs locally.
 *
 * Context only — this never enters the hail EAL.
 * Data basis: Deutscher Wetterdienst (open data, attribution required).
 */

export const KONRAD3D_URL = "https://opendata.dwd.de/weather/radar/konrad3d/";
const FILE_PATTERN = /KONRAD3D_(\d{8})T(\d{6})\.xml/g;
const KEY = "radarhail:v1";
const INDEX_KEY = `${KEY}:days`;
/** The archive is the point: entries never expire in practice. */
const ARCHIVE_TTL = 50 * 365 * 24 * 60 * 60 * 1000;
/** A sync within this interval is skipped (DWD adds a file every 5 min). */
const MIN_SYNC_INTERVAL_MS = 10 * 60 * 1000;
/** Files are 4 KB to a few MB; anything far larger is not one. */
const MAX_FILE_BYTES = 40 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;

/** A hail cell as stored: time, class, max reflectivity, bbox, outlines. */
export interface StoredHailCell {
  /** ISO time of the radar step. */
  t: string;
  c: RadarHailClass;
  /** Maximum reflectivity in the cell (dBZ). */
  d: number;
  /** [west, south, east, north] in degrees. */
  b: [number, number, number, number];
  /** Outlines as flat [lon, lat, lon, lat, …] arrays. */
  r: number[][];
}

interface StoredDay {
  /** Radar steps processed for this day (file names). */
  files: string[];
  cells: StoredHailCell[];
}

// --- Parsing (pure, unit-tested) ---------------------------------------

/** File names in a directory listing, oldest first, without duplicates. */
export function parseKonradListing(html: string): string[] {
  const names = new Set<string>();
  for (const m of html.matchAll(FILE_PATTERN)) names.add(m[0]);
  return [...names].sort();
}

/** UTC day (YYYYMMDD) and ISO time of a KONRAD3D file name. */
export function konradFileTime(
  name: string,
): { day: string; iso: string } | null {
  const m = /KONRAD3D_(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})\.xml$/.exec(
    name,
  );
  if (!m) return null;
  return {
    day: `${m[1]}${m[2]}${m[3]}`,
    iso: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`,
  };
}

function numberIn(block: string, tag: string): number | null {
  const m = new RegExp(
    `<${tag}(?:\\s[^>]*)?>\\s*(-?[\\d.]+)\\s*</${tag}>`,
  ).exec(block);
  if (!m) return null;
  const value = Number(m[1]);
  // KONRAD3D writes -1e9 for "not available".
  return Number.isFinite(value) && value > -1e8 ? value : null;
}

/**
 * Hail class of one cell from its hydrometeor classification: an area of
 * large hail or hail, or a rain–hail mixture where the cell's hail flag is
 * set. Null for a cell without hail.
 */
export function cellHailClass(feature: string): RadarHailClass | null {
  if ((numberIn(feature, "area_large_hail") ?? 0) > 0) return "large";
  if ((numberIn(feature, "area_hail") ?? 0) > 0) return "hail";
  if (
    numberIn(feature, "hail_flag") === 1 &&
    (numberIn(feature, "area_rain_hail") ?? 0) > 0
  )
    return "mixed";
  return null;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
/** Points kept per outline: cells are a few km across, the grid 250 m. */
const MAX_RING_POINTS = 32;

/** Hail cells of one KONRAD3D file. */
export function parseKonradHailCells(xml: string): StoredHailCell[] {
  const cells: StoredHailCell[] = [];
  const cellsStart = xml.indexOf("<cells");
  if (cellsStart < 0) return cells;
  const features = xml
    .slice(cellsStart)
    .split(/<feature\s/)
    .slice(1);
  for (const feature of features) {
    const hailClass = cellHailClass(feature);
    if (!hailClass) continue;
    const time = /<reference_time[^>]*>([^<]+)<\/reference_time>/.exec(
      feature,
    )?.[1];
    if (!time) continue;
    const rings: number[][] = [];
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    const polygonPattern =
      /<latitudes>([^<]+)<\/latitudes>\s*<longitudes>([^<]+)<\/longitudes>/g;
    for (const m of feature.matchAll(polygonPattern)) {
      const lats = m[1].trim().split(/\s+/).map(Number);
      const lons = m[2].trim().split(/\s+/).map(Number);
      if (lats.length !== lons.length || lats.length < 3) continue;
      const flat: number[] = [];
      const stride = Math.ceil(lats.length / MAX_RING_POINTS);
      for (let i = 0; i < lats.length; i += stride) {
        const lat = lats[i];
        const lon = lons[i];
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        flat.push(round4(lon), round4(lat));
        west = Math.min(west, lon);
        east = Math.max(east, lon);
        south = Math.min(south, lat);
        north = Math.max(north, lat);
      }
      if (flat.length >= 6) rings.push(flat);
    }
    if (rings.length === 0) continue;
    cells.push({
      t: new Date(time.trim()).toISOString(),
      c: hailClass,
      d: numberIn(feature, "max_value") ?? 0,
      b: [round4(west), round4(south), round4(east), round4(north)],
      r: rings,
    });
  }
  return cells;
}

// --- Geometry ----------------------------------------------------------

const KM_PER_DEG_LAT = 111.32;

/** Distance from a point to a cell's outlines in km; 0 inside one. */
export function distanceToCellKm(
  lat: number,
  lon: number,
  cell: StoredHailCell,
): number {
  const kx = KM_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  let best = Infinity;
  for (const ring of cell.r) {
    let inside = false;
    const n = ring.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = (ring[2 * i] - lon) * kx;
      const yi = (ring[2 * i + 1] - lat) * KM_PER_DEG_LAT;
      const xj = (ring[2 * j] - lon) * kx;
      const yj = (ring[2 * j + 1] - lat) * KM_PER_DEG_LAT;
      if (yi > 0 !== yj > 0 && 0 < ((xj - xi) * (0 - yi)) / (yj - yi) + xi)
        inside = !inside;
      // Distance from the origin (the point) to the segment.
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

function nearBox(
  lat: number,
  lon: number,
  b: StoredHailCell["b"],
  radiusKm: number,
): boolean {
  const dLat = radiusKm / KM_PER_DEG_LAT;
  const dLon =
    radiusKm / (KM_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180) || 1);
  return (
    lon >= b[0] - dLon &&
    lon <= b[2] + dLon &&
    lat >= b[1] - dLat &&
    lat <= b[3] + dLat
  );
}

/** Days with a hail cell within `radiusKm` of the point, newest first. */
export function hailDaysAt(
  lat: number,
  lon: number,
  cells: readonly StoredHailCell[],
  radiusKm = RADAR_HAIL_RADIUS_KM,
): RadarHailDay[] {
  const byDate = new Map<string, RadarHailDay>();
  for (const cell of cells) {
    if (!nearBox(lat, lon, cell.b, radiusKm)) continue;
    const distance = distanceToCellKm(lat, lon, cell);
    if (distance > radiusKm) continue;
    const date = cell.t.slice(0, 10);
    const day = byDate.get(date);
    if (!day) {
      byDate.set(date, {
        date,
        hailClass: cell.c,
        firstAt: cell.t,
        lastAt: cell.t,
        distanceKm: round2(distance),
        maxDbz: cell.d,
        steps: 1,
      });
      continue;
    }
    if (radarHailRank(cell.c) > radarHailRank(day.hailClass))
      day.hailClass = cell.c;
    if (cell.t < day.firstAt) day.firstAt = cell.t;
    if (cell.t > day.lastAt) day.lastAt = cell.t;
    day.distanceKm = Math.min(day.distanceKm, round2(distance));
    day.maxDbz = Math.max(day.maxDbz, cell.d);
    day.steps++;
  }
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// --- Archive -----------------------------------------------------------

function dayKey(day: string): string {
  return `${KEY}:day:${day}`;
}

function archiveDays(): string[] {
  return cacheGet<string[]>(INDEX_KEY) ?? [];
}

function readDay(day: string): StoredDay {
  return cacheGet<StoredDay>(dayKey(day)) ?? { files: [], cells: [] };
}

interface Archive {
  cells: StoredHailCell[];
  from: string | null;
  to: string | null;
  steps: number;
}

/** Read once per sync: a season of cells is several megabytes of JSON. */
let archiveMemo: Archive | null = null;

/** Every stored cell, plus the archive's time span and step count. */
export function readArchive(): Archive {
  archiveMemo ??= loadArchive();
  return archiveMemo;
}

function loadArchive(): Archive {
  const cells: StoredHailCell[] = [];
  let from: string | null = null;
  let to: string | null = null;
  let steps = 0;
  for (const day of archiveDays()) {
    const stored = readDay(day);
    cells.push(...stored.cells);
    steps += stored.files.length;
    for (const file of stored.files) {
      const iso = konradFileTime(file)?.iso;
      if (!iso) continue;
      if (from == null || iso < from) from = iso;
      if (to == null || iso > to) to = iso;
    }
  }
  return { cells, from, to, steps };
}

let syncing: Promise<boolean> | null = null;
let lastSyncAt = 0;
let lastSyncOk = false;

/** Test hook: forget the last sync time. */
export function resetRadarHailSyncForTests(): void {
  syncing = null;
  lastSyncAt = 0;
  lastSyncOk = false;
  archiveMemo = null;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetchWithResilience(
    url,
    {},
    { timeoutMs: FETCH_TIMEOUT_MS },
  );
  if (!response.ok)
    throw new Error(`KONRAD3D request failed (${response.status})`);
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_FILE_BYTES) throw new Error("KONRAD3D file too large");
  const text = await response.text();
  if (text.length > MAX_FILE_BYTES) throw new Error("KONRAD3D file too large");
  return text;
}

/**
 * Downloads the files on the server that are not in the archive yet. True
 * when DWD was reached. Concurrent calls share one run; a call within
 * {@link MIN_SYNC_INTERVAL_MS} of a successful sync returns at once.
 */
export function syncRadarHail(): Promise<boolean> {
  if (syncing) return syncing;
  if (lastSyncOk && Date.now() - lastSyncAt < MIN_SYNC_INTERVAL_MS)
    return Promise.resolve(true);
  syncing = (async () => {
    try {
      const names = parseKonradListing(await fetchText(KONRAD3D_URL));
      const known = new Map<string, Set<string>>();
      const pending = names.filter((name) => {
        const time = konradFileTime(name);
        if (!time) return false;
        let files = known.get(time.day);
        if (!files) {
          files = new Set(readDay(time.day).files);
          known.set(time.day, files);
        }
        return !files.has(name);
      });
      // The host gate limits parallel requests to opendata.dwd.de.
      const results = await Promise.all(
        pending.map(async (name) => {
          try {
            return {
              name,
              cells: parseKonradHailCells(await fetchText(KONRAD3D_URL + name)),
            };
          } catch (error) {
            console.warn(`KONRAD3D file ${name} skipped`, error);
            return null;
          }
        }),
      );
      const byDay = new Map<
        string,
        Array<{ name: string; cells: StoredHailCell[] }>
      >();
      for (const result of results) {
        if (!result) continue;
        const day = konradFileTime(result.name)!.day;
        const list = byDay.get(day) ?? [];
        list.push(result);
        byDay.set(day, list);
      }
      const days = new Set(archiveDays());
      for (const [day, list] of byDay) {
        const stored = readDay(day);
        const files = new Set(stored.files);
        for (const { name, cells } of list) {
          if (files.has(name)) continue;
          files.add(name);
          stored.cells.push(...cells);
        }
        cacheSet(
          dayKey(day),
          { files: [...files].sort(), cells: stored.cells },
          ARCHIVE_TTL,
        );
        days.add(day);
      }
      cacheSet(INDEX_KEY, [...days].sort(), ARCHIVE_TTL);
      archiveMemo = null;
      lastSyncOk = true;
      return true;
    } catch (error) {
      console.warn("KONRAD3D sync failed; showing the local archive", error);
      lastSyncOk = false;
      return false;
    } finally {
      lastSyncAt = Date.now();
      syncing = null;
    }
  })();
  return syncing;
}

export function radarHailEvidence(from: string | null): RiskEvidence {
  return {
    source: "Deutscher Wetterdienst (DWD), KONRAD3D radar cell tracking",
    retrievedAt: new Date().toISOString(),
    dataVersion:
      "weather/radar/konrad3d (5-minute cells, last 48 h on the server)",
    spatialResolution: "cell outlines on a 250 m radar grid",
    method: `Days on which a cell classified as hail, large hail or rain–hail mixture passed within ${RADAR_HAIL_RADIUS_KM} km of the location`,
    confidence: 0.45,
    fallbackUsed: false,
    limitations: [
      from
        ? `Local archive since ${from.slice(0, 10)}: DWD keeps only the last 48 hours, earlier hail is not in it`
        : "The local archive is empty: DWD keeps only the last 48 hours",
      "The outline is the whole storm cell; hail falls in part of it, so a cell over the site does not prove hail on the lot",
      "Rain–hail mixtures in the cold season are mostly graupel",
      "Context only: not used in the hail EAL",
    ],
  };
}

/** How long a query waits for a running sync before it reads the archive. */
const SYNC_WAIT_MS = 4_000;

/**
 * Syncs, but answers after {@link SYNC_WAIT_MS} at the latest: the first
 * sync fetches 48 hours of files (a few minutes) and keeps running in the
 * background. True when the sync finished and reached DWD.
 */
async function syncBriefly(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), SYNC_WAIT_MS);
  });
  try {
    return await Promise.race([syncRadarHail(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** True while a sync runs in the background. */
export function radarHailSyncing(): boolean {
  return syncing != null;
}

/** Radar hail days at one location from the archive (synced briefly). */
export async function radarHailAt(
  lat: number,
  lon: number,
): Promise<RadarHailResult> {
  const synced = await syncBriefly();
  const archive = readArchive();
  return {
    days: hailDaysAt(lat, lon, archive.cells),
    archiveFrom: archive.from,
    archiveTo: archive.to,
    steps: archive.steps,
    radiusKm: RADAR_HAIL_RADIUS_KM,
    synced,
    syncing: radarHailSyncing(),
    evidence: radarHailEvidence(archive.from),
  };
}
