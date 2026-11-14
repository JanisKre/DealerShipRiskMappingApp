import type { RiskEvidence } from "@shared/types";
import {
  RADAR_HAIL_RADIUS_KM,
  radarHailRank,
  type RadarHailClass,
  type RadarHailDay,
  type RadarHailResult,
} from "@shared/radar-hail";
import { distanceToRingsKm, nearBbox } from "@shared/hail-events";
import { getDb } from "../../db/database";
import { fetchWithResilience } from "../http.service";

/**
 * Local archive of the hail cells tracked by DWD's radar cell tracking
 * KONRAD3D (open data, `weather/radar/konrad3d`). DWD keeps the last 48
 * hours of 5-minute XML files on the server; each sync downloads the files
 * not yet in the archive and keeps only cells with hail (by the hydrometeor
 * classification in the file), so the archive grows from the first use on
 * and costs a few kilobytes per hail cell. While the app runs it syncs in
 * the background every {@link BACKGROUND_SYNC_INTERVAL_MS}.
 *
 * Storage (schema 3): one row per cell in `radar_hail_cells`, its bounding
 * box in the R-tree `radar_hail_cells_box`, the processed file names in
 * `radar_hail_files` (pruned once DWD no longer lists them) and the steps
 * per day in `radar_hail_coverage`. A sync appends rows; nothing is
 * rewritten, and a location query reads only the cells near it.
 *
 * Nothing about the portfolio is sent: the files cover all of Germany and
 * the comparison with the locations runs locally.
 *
 * Context only — this never enters the hail EAL.
 * Data basis: Deutscher Wetterdienst (open data, attribution required).
 */

export const KONRAD3D_URL = "https://opendata.dwd.de/weather/radar/konrad3d/";
const FILE_PATTERN = /KONRAD3D_(\d{8})T(\d{6})\.xml/g;
/** A sync within this interval is skipped (DWD adds a file every 5 min). */
const MIN_SYNC_INTERVAL_MS = 10 * 60 * 1000;
/** Files are 4 KB to a few MB; anything far larger is not one. */
const MAX_FILE_BYTES = 40 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;

/** A hail cell as parsed: time, class, max reflectivity, bbox, outlines. */
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
  /** Centroid [lon, lat]; the bbox centre when the file has none. */
  p?: [number, number];
  /** KONRAD3D's centroid forecast for the next step (+5 min), [lon, lat]. */
  f?: [number, number];
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

/**
 * The first [lon, lat] inside the first `<block…>` element of a feature
 * (`centroid_3d`, or the first `centroid_forecast`, which is +5 min).
 */
function coordinateIn(feature: string, block: string): [number, number] | null {
  const start = feature.search(new RegExp(`<${block}[\\s>]`));
  if (start < 0) return null;
  const end = feature.indexOf(`</${block}>`, start);
  const part = feature.slice(start, end < 0 ? undefined : end);
  const lat = numberIn(part, "latitude");
  const lon = numberIn(part, "longitude");
  if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180)
    return null;
  return [round4(lon), round4(lat)];
}
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
    const centroid = coordinateIn(feature, "centroid_3d");
    const forecast = coordinateIn(feature, "centroid_forecast");
    cells.push({
      t: new Date(time.trim()).toISOString(),
      c: hailClass,
      d: numberIn(feature, "max_value") ?? 0,
      b: [round4(west), round4(south), round4(east), round4(north)],
      r: rings,
      p: centroid ?? [round4((west + east) / 2), round4((south + north) / 2)],
      ...(forecast ? { f: forecast } : {}),
    });
  }
  return cells;
}

// --- Geometry ----------------------------------------------------------

/** Distance from a point to a cell's outlines in km; 0 inside one. */
export function distanceToCellKm(
  lat: number,
  lon: number,
  cell: StoredHailCell,
): number {
  return distanceToRingsKm(lat, lon, cell.r);
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
    if (!nearBbox(lat, lon, cell.b, radiusKm)) continue;
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

// --- Archive (SQLite) --------------------------------------------------

/** File names older than this are no longer on the DWD server. */
const FILE_NAME_RETENTION_MS = 4 * 24 * 60 * 60 * 1000;

/** A cell row as the archive returns it. */
export interface ArchivedHailCell {
  id: number;
  /** Unix ms. */
  t: number;
  c: RadarHailClass;
  d: number;
  lat: number;
  lon: number;
  /** Forecast centroid +5 min, when KONRAD3D gave one. */
  flat: number | null;
  flon: number | null;
  b: [number, number, number, number];
}

interface CellRow {
  id: number;
  t: number;
  class: RadarHailClass;
  dbz: number;
  lat: number;
  lon: number;
  flat: number | null;
  flon: number | null;
  west: number;
  south: number;
  east: number;
  north: number;
  rings?: string;
}

const CELL_COLUMNS =
  "c.id, c.t, c.class, c.dbz, c.lat, c.lon, c.flat, c.flon, b.west, b.south, b.east, b.north";

function toArchived(row: CellRow): ArchivedHailCell {
  return {
    id: row.id,
    t: row.t,
    c: row.class,
    d: row.dbz,
    lat: row.lat,
    lon: row.lon,
    flat: row.flat,
    flon: row.flon,
    b: [row.west, row.south, row.east, row.north],
  };
}

function parseRings(json: string | undefined): number[][] {
  try {
    const rings = JSON.parse(json ?? "[]") as unknown;
    return Array.isArray(rings)
      ? rings.filter(
          (r): r is number[] => Array.isArray(r) && r.every(Number.isFinite),
        )
      : [];
  } catch {
    return [];
  }
}

/**
 * Stores the hail cells of one radar file, once: a file already processed
 * is ignored. One transaction per file, so an interrupted sync leaves only
 * complete steps behind. True when the file was new.
 */
export function storeKonradFile(
  name: string,
  cells: readonly StoredHailCell[],
): boolean {
  const time = konradFileTime(name);
  if (!time) return false;
  const db = getDb();
  const t = Date.parse(time.iso);
  return db.transaction(() => {
    const added = db
      .prepare("INSERT OR IGNORE INTO radar_hail_files (name, t) VALUES (?, ?)")
      .run(name, t);
    if (added.changes === 0) return false;
    db.prepare(
      `INSERT INTO radar_hail_coverage (day, steps, first_t, last_t) VALUES (?, 1, ?, ?)
       ON CONFLICT(day) DO UPDATE SET steps = steps + 1,
         first_t = MIN(first_t, excluded.first_t), last_t = MAX(last_t, excluded.last_t)`,
    ).run(time.day, t, t);
    const insertCell = db.prepare(
      "INSERT INTO radar_hail_cells (t, class, dbz, lat, lon, flat, flon, rings) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const insertBox = db.prepare(
      "INSERT INTO radar_hail_cells_box (id, west, east, south, north) VALUES (?, ?, ?, ?, ?)",
    );
    for (const cell of cells) {
      const p = cell.p ?? [
        (cell.b[0] + cell.b[2]) / 2,
        (cell.b[1] + cell.b[3]) / 2,
      ];
      const { lastInsertRowid } = insertCell.run(
        Date.parse(cell.t),
        cell.c,
        cell.d,
        p[1],
        p[0],
        cell.f?.[1] ?? null,
        cell.f?.[0] ?? null,
        JSON.stringify(cell.r),
      );
      insertBox.run(
        lastInsertRowid,
        cell.b[0],
        cell.b[2],
        cell.b[1],
        cell.b[3],
      );
    }
    archiveVersion++;
    return true;
  })();
}

/** Names of the files already in the archive. */
function knownFiles(): Set<string> {
  const rows = getDb()
    .prepare("SELECT name FROM radar_hail_files")
    .all() as Array<{
    name: string;
  }>;
  return new Set(rows.map((r) => r.name));
}

/** Drops file names DWD no longer lists; coverage and cells stay. */
export function pruneFileNames(now = Date.now()): void {
  getDb()
    .prepare("DELETE FROM radar_hail_files WHERE t < ?")
    .run(now - FILE_NAME_RETENTION_MS);
}

/** Cells whose box lies within `radiusKm` of the point (R-tree query). */
export function cellsNear(
  lat: number,
  lon: number,
  radiusKm: number,
): StoredHailCell[] {
  const dLat = radiusKm / 111.32;
  const dLon = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180) || 1);
  const rows = getDb()
    .prepare(
      `SELECT ${CELL_COLUMNS}, c.rings FROM radar_hail_cells_box b
       JOIN radar_hail_cells c ON c.id = b.id
       WHERE b.west <= ? AND b.east >= ? AND b.south <= ? AND b.north >= ?`,
    )
    .all(lon + dLon, lon - dLon, lat + dLat, lat - dLat) as CellRow[];
  return rows.map((row) => ({
    t: new Date(row.t).toISOString(),
    c: row.class,
    d: row.dbz,
    b: [row.west, row.south, row.east, row.north],
    r: parseRings(row.rings),
    p: [row.lon, row.lat],
  }));
}

/** Every cell without outlines, oldest first: enough to link tracks. */
export function archivedCells(): ArchivedHailCell[] {
  const rows = getDb()
    .prepare(
      `SELECT ${CELL_COLUMNS} FROM radar_hail_cells c
       JOIN radar_hail_cells_box b ON b.id = c.id ORDER BY c.t, c.id`,
    )
    .all() as CellRow[];
  return rows.map(toArchived);
}

/** Cells between two times (inclusive) with their outlines. */
export function archivedCellsBetween(
  from: number,
  to: number,
): Array<ArchivedHailCell & { r: number[][] }> {
  const rows = getDb()
    .prepare(
      `SELECT ${CELL_COLUMNS}, c.rings FROM radar_hail_cells c
       JOIN radar_hail_cells_box b ON b.id = c.id
       WHERE c.t BETWEEN ? AND ? ORDER BY c.t, c.id`,
    )
    .all(from, to) as CellRow[];
  return rows.map((row) => ({ ...toArchived(row), r: parseRings(row.rings) }));
}

interface ArchiveSpan {
  from: string | null;
  to: string | null;
  steps: number;
}

/** Time span and radar steps the archive covers. */
export function archiveSpan(): ArchiveSpan {
  const row = getDb()
    .prepare(
      "SELECT MIN(first_t) AS first, MAX(last_t) AS last, COALESCE(SUM(steps), 0) AS steps FROM radar_hail_coverage",
    )
    .get() as { first: number | null; last: number | null; steps: number };
  return {
    from: row.first == null ? null : new Date(row.first).toISOString(),
    to: row.last == null ? null : new Date(row.last).toISOString(),
    steps: row.steps,
  };
}

/** Bumped on every stored file, so derived results know to recompute. */
let archiveVersion = 0;

export function radarArchiveVersion(): number {
  return archiveVersion;
}

let syncing: Promise<boolean> | null = null;
let lastSyncAt = 0;
let lastSyncOk = false;

/** Test hook: forget the last sync time. */
export function resetRadarHailSyncForTests(): void {
  syncing = null;
  lastSyncAt = 0;
  lastSyncOk = false;
  archiveVersion = 0;
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

/** Files fetched at once; the host gate allows two requests to DWD. */
const SYNC_BATCH = 4;

/**
 * Downloads the files on the server that are not in the archive yet and
 * stores each one as soon as it is parsed, so memory stays at a few files
 * and an interrupted sync keeps what it fetched. True when DWD was
 * reached. Concurrent calls share one run; a call within
 * {@link MIN_SYNC_INTERVAL_MS} of a successful sync returns at once.
 */
export function syncRadarHail(): Promise<boolean> {
  if (syncing) return syncing;
  if (lastSyncOk && Date.now() - lastSyncAt < MIN_SYNC_INTERVAL_MS)
    return Promise.resolve(true);
  syncing = (async () => {
    try {
      const known = knownFiles();
      const pending = parseKonradListing(await fetchText(KONRAD3D_URL)).filter(
        (name) => konradFileTime(name) != null && !known.has(name),
      );
      for (let i = 0; i < pending.length; i += SYNC_BATCH) {
        await Promise.all(
          pending.slice(i, i + SYNC_BATCH).map(async (name) => {
            try {
              const cells = parseKonradHailCells(
                await fetchText(KONRAD3D_URL + name),
              );
              storeKonradFile(name, cells);
            } catch (error) {
              console.warn(`KONRAD3D file ${name} skipped`, error);
            }
          }),
        );
      }
      pruneFileNames();
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

/** Background sync while the app runs: DWD keeps only 48 hours. */
export const BACKGROUND_SYNC_INTERVAL_MS = 30 * 60 * 1000;
const BACKGROUND_SYNC_FIRST_DELAY_MS = 20_000;
let backgroundTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Starts the background sync (first run shortly after start, then every
 * {@link BACKGROUND_SYNC_INTERVAL_MS}). The timers do not keep the
 * process alive. Only file names are requested from DWD; nothing about
 * the portfolio leaves the machine.
 */
export function startRadarHailBackgroundSync(): void {
  if (backgroundTimer) return;
  const run = (): void => void syncRadarHail();
  setTimeout(run, BACKGROUND_SYNC_FIRST_DELAY_MS).unref?.();
  backgroundTimer = setInterval(run, BACKGROUND_SYNC_INTERVAL_MS);
  backgroundTimer.unref?.();
}

export function stopRadarHailBackgroundSync(): void {
  if (backgroundTimer) clearInterval(backgroundTimer);
  backgroundTimer = null;
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
      "The app fetches new files every 30 minutes while it runs; hail on days when it was closed for more than 48 hours is missing",
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
export async function syncBriefly(): Promise<boolean> {
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
  const span = archiveSpan();
  return {
    days: hailDaysAt(lat, lon, cellsNear(lat, lon, RADAR_HAIL_RADIUS_KM)),
    archiveFrom: span.from,
    archiveTo: span.to,
    steps: span.steps,
    radiusKm: RADAR_HAIL_RADIUS_KM,
    synced,
    syncing: radarHailSyncing(),
    evidence: radarHailEvidence(span.from),
  };
}
