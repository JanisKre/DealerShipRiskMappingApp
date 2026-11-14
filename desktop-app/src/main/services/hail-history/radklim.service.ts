import { createGunzip } from "node:zlib";
import type { RiskEvidence } from "@shared/types";
import type { RadarHailClass } from "@shared/radar-hail";
import {
  MAX_EVENT_CELLS,
  summarizeEvent,
  type Bbox,
  type HailEventCell,
  type HailEventSummary,
} from "@shared/hail-events";
import { cached } from "../cache.service";
import { fetchWithResilience } from "../http.service";

/**
 * Historic storm days from the DWD radar climatology RADKLIM (YW, version
 * 2017.002): 5-minute precipitation on a 1 km grid over Germany since
 * 2001, open data. RADKLIM is a precipitation product, not a hail product.
 * The app uses its most intense convective cores as a **hail proxy**: a
 * 5-minute sum of at least 6 mm (≈ 72 mm/h, about 53 dBZ by
 * Marshall–Palmer) marks a core; larger sums raise the class. Connected
 * core pixels form a cell; cells are linked into tracks like the live
 * radar cells.
 *
 * Download: each month is one uncompressed tar of daily `.tar.gz`
 * archives. The month's tar is indexed with HTTP range requests (one
 * 512-byte header per day), then only the requested day is fetched
 * (10–35 MB). Nothing about the portfolio is sent.
 *
 * Methodology and limitations: docs/risk-model.md, "Historic storm days".
 */

export const RADKLIM_BASE =
  "https://opendata.dwd.de/climate_environment/CDC/grids_germany/5_minutes/radolan/reproc/2017_002/bin";

/** First day RADKLIM YW covers. */
export const RADKLIM_FIRST_DAY = "2001-01-01";

/** 5-minute sums (mm) for the proxy classes. */
export const CORE_THRESHOLDS_MM: Record<RadarHailClass, number> = {
  mixed: 6,
  hail: 9,
  large: 14,
};
/** Cores smaller than this (km², pixels) are noise or single clutter pixels. */
const MIN_CORE_PIXELS = 3;
/** A day's archive is 10–35 MB; anything far larger is not one. */
const MAX_DAY_BYTES = 120 * 1024 * 1024;
const NROWS = 1100;
const NCOLS = 900;
const MONTH_INDEX_TTL = 30 * 24 * 60 * 60 * 1000;

// --- Grid geometry (RADOLAN polar stereographic, 1100 × 900 km grid) ------

const EARTH_R = 6370.04;
const PHI0 = (60 * Math.PI) / 180;
const LAM0 = 10;

function project(lon: number, lat: number): [number, number] {
  const phi = (lat * Math.PI) / 180;
  const lam = ((lon - LAM0) * Math.PI) / 180;
  const m = (1 + Math.sin(PHI0)) / (1 + Math.sin(phi));
  return [
    EARTH_R * m * Math.cos(phi) * Math.sin(lam),
    -EARTH_R * m * Math.cos(phi) * Math.cos(lam),
  ];
}

function unproject(x: number, y: number): [number, number] {
  const lon = LAM0 + (Math.atan(-x / y) * 180) / Math.PI;
  const k = EARTH_R * EARTH_R * (1 + Math.sin(PHI0)) ** 2;
  const r2 = x * x + y * y;
  const lat = (Math.asin((k - r2) / (k + r2)) * 180) / Math.PI;
  return [lon, lat];
}

// The 1100 × 900 grid puts 9° E 51° N at column 370, row 550 (rows from
// the south), as in wradlib's RADOLAN grid definitions.
const [REF_X, REF_Y] = project(9, 51);
const ORIGIN_X = REF_X - 370;
const ORIGIN_Y = REF_Y - 550;

/** Lon/lat of a grid corner (column, row from the south; may be fractional). */
export function gridToLonLat(col: number, row: number): [number, number] {
  return unproject(ORIGIN_X + col, ORIGIN_Y + row);
}

/** Grid column and row of a point. */
export function lonLatToGrid(lon: number, lat: number): [number, number] {
  const [x, y] = project(lon, lat);
  return [x - ORIGIN_X, y - ORIGIN_Y];
}

// --- YW file parsing --------------------------------------------------------

/** Time (Unix ms, UTC) of a RADKLIM YW file name, e.g. `…-1307281530-dwd---bin`. */
export function ywFileTime(name: string): number | null {
  const m = /-(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})-dwd/.exec(name);
  if (!m) return null;
  const year = Number(m[1]) + 2000;
  return Date.UTC(
    year,
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
  );
}

/**
 * 5-minute sums in mm of one YW file (row 0 = south), NaN where there are
 * no data. The header ends at ETX (0x03); values are 16-bit little endian
 * with 12 value bits (0.01 mm) and bit 0x2000 for "no data".
 */
export function parseYw(data: Uint8Array): Float32Array | null {
  const etx = data.indexOf(3);
  if (etx < 0 || etx > 1024) return null;
  const header = Buffer.from(data.subarray(0, etx)).toString("latin1");
  if (!/GP\s*1100x\s*900/.test(header)) return null;
  const precision = /PR\s*E-(\d+)/.exec(header);
  const scale = precision ? 10 ** -Number(precision[1]) : 0.01;
  const body = data.subarray(etx + 1);
  if (body.length < NROWS * NCOLS * 2) return null;
  const out = new Float32Array(NROWS * NCOLS);
  const view = new DataView(body.buffer, body.byteOffset, NROWS * NCOLS * 2);
  for (let i = 0; i < NROWS * NCOLS; i++) {
    const v = view.getUint16(i * 2, true);
    out[i] = v & 0x2000 ? Number.NaN : (v & 0x0fff) * scale;
  }
  return out;
}

const round5 = (n: number): number => Math.round(n * 1e5) / 1e5;

/** Convex hull (Andrew's monotone chain) of integer grid points. */
function hull(points: Array<[number, number]>): Array<[number, number]> {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: number[], a: number[], b: number[]): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Array<[number, number]> = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: Array<[number, number]> = [];
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, p) <= 0)
      upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function classOf(maxMm: number): RadarHailClass {
  return maxMm >= CORE_THRESHOLDS_MM.large
    ? "large"
    : maxMm >= CORE_THRESHOLDS_MM.hail
      ? "hail"
      : "mixed";
}

/** Reflectivity (dBZ) of a 5-minute sum by Marshall–Palmer (Z = 200 R^1.6). */
export function dbzOf(mmPer5Min: number): number {
  const r = mmPer5Min * 12;
  return Math.round(10 * Math.log10(200 * r ** 1.6) * 10) / 10;
}

/** A core before track linking. */
export interface Core {
  t: number;
  c: RadarHailClass;
  d: number;
  lat: number;
  lon: number;
  b: Bbox;
  r: number[][];
}

/**
 * Cores of one 5-minute grid: 8-connected pixels with at least the
 * `mixed` threshold, at least {@link MIN_CORE_PIXELS} large. The outline
 * is the convex hull of the pixel corners; the class comes from the
 * core's highest sum.
 */
export function coresOfGrid(grid: Float32Array, t: number): Core[] {
  const threshold = CORE_THRESHOLDS_MM.mixed;
  const seen = new Uint8Array(NROWS * NCOLS);
  const cores: Core[] = [];
  const stack: number[] = [];
  for (let start = 0; start < grid.length; start++) {
    if (seen[start] || !(grid[start] >= threshold)) continue;
    const pixels: number[] = [];
    seen[start] = 1;
    stack.push(start);
    while (stack.length > 0) {
      const i = stack.pop()!;
      pixels.push(i);
      const row = Math.floor(i / NCOLS);
      const col = i % NCOLS;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const r = row + dr;
          const c = col + dc;
          if (r < 0 || r >= NROWS || c < 0 || c >= NCOLS) continue;
          const j = r * NCOLS + c;
          if (!seen[j] && grid[j] >= threshold) {
            seen[j] = 1;
            stack.push(j);
          }
        }
    }
    if (pixels.length < MIN_CORE_PIXELS) continue;
    let max = 0;
    let sum = 0;
    let cx = 0;
    let cy = 0;
    const corners: Array<[number, number]> = [];
    for (const i of pixels) {
      const row = Math.floor(i / NCOLS);
      const col = i % NCOLS;
      const v = grid[i];
      max = Math.max(max, v);
      sum += v;
      cx += (col + 0.5) * v;
      cy += (row + 0.5) * v;
      corners.push(
        [col, row],
        [col + 1, row],
        [col, row + 1],
        [col + 1, row + 1],
      );
    }
    const ring: number[] = [];
    const b: Bbox = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [col, row] of hull(corners)) {
      const [lon, lat] = gridToLonLat(col, row);
      ring.push(round5(lon), round5(lat));
      b[0] = Math.min(b[0], lon);
      b[2] = Math.max(b[2], lon);
      b[1] = Math.min(b[1], lat);
      b[3] = Math.max(b[3], lat);
    }
    const [lon, lat] = gridToLonLat(cx / sum, cy / sum);
    cores.push({
      t,
      c: classOf(max),
      d: dbzOf(max),
      lat: round5(lat),
      lon: round5(lon),
      b,
      r: [ring],
    });
  }
  return cores;
}

// --- Tar handling ------------------------------------------------------------

function octal(buf: Uint8Array, offset: number, length: number): number {
  const text = Buffer.from(buf.subarray(offset, offset + length))
    .toString("ascii")
    .replace(/\0.*$/s, "")
    .trim();
  return text ? Number.parseInt(text, 8) : 0;
}

/** A tar entry header: name, size, type, and where its data starts. */
export interface TarEntry {
  name: string;
  size: number;
  type: string;
  data: number;
}

export function parseTarHeader(
  block: Uint8Array,
  offset: number,
): TarEntry | null {
  if (block.length < 512 || block.every((b) => b === 0)) return null;
  return {
    name: Buffer.from(block.subarray(0, 100))
      .toString("ascii")
      .replace(/\0.*$/s, ""),
    size: octal(block, 124, 12),
    type: String.fromCharCode(block[156] || 48),
    data: offset + 512,
  };
}

/** Calls `onEntry` for each file of a tar stream (pax headers skipped). */
export class TarStreamReader {
  private buf: Buffer = Buffer.alloc(0);
  private entry: TarEntry | null = null;
  private padding = 0;

  constructor(private readonly onEntry: (name: string, data: Buffer) => void) {}

  push(chunk: Buffer): void {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      if (this.padding > 0) {
        if (this.buf.length < this.padding) return;
        this.buf = this.buf.subarray(this.padding);
        this.padding = 0;
      }
      if (!this.entry) {
        if (this.buf.length < 512) return;
        const header = parseTarHeader(this.buf.subarray(0, 512), 0);
        this.buf = this.buf.subarray(512);
        if (!header) continue;
        this.entry = header;
      }
      if (this.buf.length < this.entry.size) return;
      const data = this.buf.subarray(0, this.entry.size);
      this.buf = this.buf.subarray(this.entry.size);
      this.padding = (512 - (this.entry.size % 512)) % 512;
      const { name, type } = this.entry;
      this.entry = null;
      if (type === "0" || type === "\0") this.onEntry(name, Buffer.from(data));
    }
  }
}

async function fetchRange(
  url: string,
  start: number,
  end: number,
): Promise<Buffer> {
  const response = await fetchWithResilience(
    url,
    { headers: { Range: `bytes=${start}-${end}` } },
    { timeoutMs: 30_000 },
  );
  if (response.status !== 206 && response.status !== 200)
    throw new Error(`RADKLIM request failed (${response.status})`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > end - start + 1 + 1024)
    throw new Error("RADKLIM server ignored the range");
  return buffer;
}

export function monthTarUrl(day: string): string {
  const [y, m] = day.split("-");
  return `${RADKLIM_BASE}/${y}/YW2017.002_${y}${m}.tar`;
}

/** Day archives of a month tar: name, offset and size (range requests). */
async function indexMonth(url: string): Promise<TarEntry[]> {
  return cached(`radklim:index:v1:${url}`, MONTH_INDEX_TTL, async () => {
    const entries: TarEntry[] = [];
    let offset = 0;
    for (let i = 0; i < 200; i++) {
      const header = parseTarHeader(
        await fetchRange(url, offset, offset + 511),
        offset,
      );
      if (!header) break;
      if (header.type === "0" || header.type === "\0") entries.push(header);
      offset = header.data + Math.ceil(header.size / 512) * 512;
    }
    if (entries.length === 0) throw new Error("RADKLIM month archive is empty");
    return entries;
  });
}

/** Valid calendar day between {@link RADKLIM_FIRST_DAY} and yesterday. */
export function validRadklimDay(day: string, now = Date.now()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const t = Date.parse(`${day}T00:00:00Z`);
  return (
    Number.isFinite(t) &&
    new Date(t).toISOString().slice(0, 10) === day &&
    day >= RADKLIM_FIRST_DAY &&
    t < now - 24 * 60 * 60 * 1000
  );
}

/**
 * Cores of every 5-minute step of a day archive (`.tar.gz` holding one
 * YW file per step), streamed: only one 2 MB grid is in memory at a time.
 */
export async function coresOfDayArchive(tgz: Buffer): Promise<Core[]> {
  const cores: Core[] = [];
  const reader = new TarStreamReader((name, data) => {
    const t = ywFileTime(name);
    if (t == null) return;
    const grid = parseYw(data);
    if (grid) cores.push(...coresOfGrid(grid, t));
  });
  await new Promise<void>((resolve, reject) => {
    const gunzip = createGunzip();
    gunzip.on("data", (chunk: Buffer) => {
      try {
        reader.push(chunk);
      } catch (error) {
        gunzip.destroy(error as Error);
      }
    });
    gunzip.on("end", resolve);
    gunzip.on("error", reject);
    gunzip.end(tgz);
  });
  return cores.sort((a, b) => a.t - b.t || a.lat - b.lat || a.lon - b.lon);
}

/** Track linking is injected to avoid a cycle with hail-events.service. */
export type LinkTracks = (
  cells: ReadonlyArray<{
    id: number;
    t: number;
    c: RadarHailClass;
    d: number;
    lat: number;
    lon: number;
    flat: null;
    flon: null;
    b: Bbox;
  }>,
) => number[];

/** A historic day as an event: cores linked into tracks. */
export function dayEvent(
  day: string,
  cores: readonly Core[],
  linkTracks: LinkTracks,
): { summary: HailEventSummary; cells: HailEventCell[] } {
  // Keep the strongest cores when a day has more than an event may carry.
  let kept = [...cores];
  if (kept.length > MAX_EVENT_CELLS) {
    kept = kept
      .sort((a, b) => b.d - a.d)
      .slice(0, MAX_EVENT_CELLS)
      .sort((a, b) => a.t - b.t || a.lat - b.lat || a.lon - b.lon);
  }
  const tracks = linkTracks(
    kept.map((c, id) => ({
      id,
      t: c.t,
      c: c.c,
      d: c.d,
      lat: c.lat,
      lon: c.lon,
      flat: null,
      flon: null,
      b: c.b,
    })),
  );
  const cells: HailEventCell[] = kept.map((c, i) => ({
    t: c.t,
    track: tracks[i],
    c: c.c,
    d: c.d,
    p: [c.lon, c.lat],
    b: c.b,
    r: c.r,
  }));
  const id = `radklim-${day.replace(/-/g, "")}`;
  return { summary: summarizeEvent(id, "radklim", day, true, cells), cells };
}

/**
 * Downloads one day from RADKLIM and returns it as an event. Throws with a
 * readable message when the day is not available.
 */
export async function loadRadklimDay(
  day: string,
  linkTracks: LinkTracks,
): Promise<{ summary: HailEventSummary; cells: HailEventCell[] }> {
  if (!validRadklimDay(day)) throw new Error(`No RADKLIM data for ${day}.`);
  const url = monthTarUrl(day);
  let entries: TarEntry[];
  try {
    entries = await indexMonth(url);
  } catch (error) {
    throw new Error(
      `The DWD radar climatology has no data for ${day.slice(0, 7)} yet, or DWD is not reachable.`,
      { cause: error },
    );
  }
  const compact = day.replace(/-/g, "");
  const entry = entries.find((e) => e.name.includes(`_${compact}.tar.gz`));
  if (!entry)
    throw new Error(`The DWD radar climatology has no file for ${day}.`);
  if (entry.size > MAX_DAY_BYTES)
    throw new Error("The day archive is unexpectedly large.");
  const response = await fetchWithResilience(
    url,
    {
      headers: { Range: `bytes=${entry.data}-${entry.data + entry.size - 1}` },
    },
    { timeoutMs: 60_000 },
  );
  if (response.status !== 206)
    throw new Error(`RADKLIM download failed (${response.status}).`);
  const tgz = Buffer.from(await response.arrayBuffer());
  if (tgz.length !== entry.size)
    throw new Error("The RADKLIM download was incomplete.");
  return dayEvent(day, await coresOfDayArchive(tgz), linkTracks);
}

export function radklimEvidence(): RiskEvidence {
  return {
    source:
      "Deutscher Wetterdienst (DWD), radar climatology RADKLIM YW 2017.002",
    retrievedAt: new Date().toISOString(),
    dataVersion:
      "RADKLIM YW 2017.002 (reprocessed 5-minute precipitation, 2001 onwards)",
    spatialResolution: "1 km grid, 5-minute steps",
    method: `Hail proxy: connected pixels with ≥ ${CORE_THRESHOLDS_MM.mixed} mm in 5 minutes (≈ 53 dBZ); class from the core's maximum (≥ ${CORE_THRESHOLDS_MM.hail} mm hail, ≥ ${CORE_THRESHOLDS_MM.large} mm large hail); cores linked into tracks`,
    confidence: 0.25,
    fallbackUsed: false,
    limitations: [
      "RADKLIM is a precipitation product: an intense core marks a severe thunderstorm, not proven hail",
      "Heavy rain without hail also passes the threshold; hail in weaker cores is missed",
      "The proxy thresholds are an app convention, not a validated hail detection",
      "Times are UTC; the day is the UTC day",
      "Stress test only: not used in the hail EAL and not a catastrophe-model PML",
    ],
  };
}
