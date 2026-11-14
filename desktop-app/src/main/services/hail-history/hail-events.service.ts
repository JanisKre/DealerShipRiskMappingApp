import { createHash } from "node:crypto";
import type { RiskEvidence } from "@shared/types";
import { radarHailRank, type RadarHailClass } from "@shared/radar-hail";
import {
  HailEventCellSchema,
  MAX_EVENT_CELLS,
  MAX_FOOTPRINT_BYTES,
  type Bbox,
  type HailEventCell,
  type HailEventDetail,
  type HailEventList,
  type HailEventSummary,
} from "@shared/hail-events";
import { getDb } from "../../db/database";
import {
  archiveSpan,
  archivedCells,
  archivedCellsBetween,
  radarArchiveVersion,
  radarHailSyncing,
  syncBriefly,
  type ArchivedHailCell,
} from "./radar-hail.service";

/**
 * Hail events for the map replay. Radar cells from the local KONRAD3D
 * archive are linked into tracks (one storm cell over time) and the tracks
 * into events (a hail spell with no gap of {@link EVENT_GAP_MS} or more).
 * Imported GeoJSON footprints are kept as events of their own.
 *
 * Pure parts (linking, grouping, GeoJSON parsing) are exported for tests.
 * Methodology: docs/risk-model.md, "Hail event replay".
 */

/** Longest gap between two steps of one track (one missing radar step). */
export const TRACK_MAX_GAP_MS = 10 * 60 * 1000;
/** A cell continues a track when it lies this close to the predicted spot. */
export const TRACK_LINK_KM = 12;
/** Hail-free time that separates two events. */
export const EVENT_GAP_MS = 3 * 60 * 60 * 1000;

const KM_PER_DEG_LAT = 111.32;

function distanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const kx = KM_PER_DEG_LAT * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
  return Math.hypot((lon2 - lon1) * kx, (lat2 - lat1) * KM_PER_DEG_LAT);
}

function boxesOverlap(a: Bbox, b: Bbox): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

interface TrackState {
  id: number;
  last: ArchivedHailCell;
  /** Motion from the last two steps, degrees per ms. */
  vLon: number;
  vLat: number;
}

/** Where a track's cell is expected at time `t`. */
function predict(track: TrackState, t: number): [number, number] {
  const { last } = track;
  const dt = t - last.t;
  // KONRAD3D's own +5 min forecast is the best guess for the next step.
  if (last.flat != null && last.flon != null && Math.abs(dt - 300_000) < 60_000)
    return [last.flon, last.flat];
  return [last.lon + track.vLon * dt, last.lat + track.vLat * dt];
}

/**
 * Track number per cell (same order as `cells`, which must be sorted by
 * time). At each radar step the cells are matched one-to-one to the
 * running tracks, nearest prediction first; a cell continues a track when
 * it lies within {@link TRACK_LINK_KM} of the predicted position or its
 * box overlaps the track's last box. Unmatched cells start a track.
 * Deterministic: ties are broken by track number and cell order.
 */
export function linkTracks(cells: readonly ArchivedHailCell[]): number[] {
  const trackOf = new Array<number>(cells.length);
  let active: TrackState[] = [];
  let nextId = 0;
  let i = 0;
  while (i < cells.length) {
    const t = cells[i].t;
    let j = i;
    while (j < cells.length && cells[j].t === t) j++;
    active = active.filter((tr) => t - tr.last.t <= TRACK_MAX_GAP_MS);
    const pairs: Array<{ d: number; track: number; cell: number }> = [];
    active.forEach((tr, ti) => {
      const [plon, plat] = predict(tr, t);
      for (let k = i; k < j; k++) {
        const c = cells[k];
        const d = distanceKm(plat, plon, c.lat, c.lon);
        if (d <= TRACK_LINK_KM || boxesOverlap(tr.last.b, c.b))
          pairs.push({ d, track: ti, cell: k });
      }
    });
    pairs.sort(
      (a, b) =>
        a.d - b.d || active[a.track].id - active[b.track].id || a.cell - b.cell,
    );
    const usedTrack = new Set<number>();
    const usedCell = new Set<number>();
    const continued: TrackState[] = [];
    for (const pair of pairs) {
      if (usedTrack.has(pair.track) || usedCell.has(pair.cell)) continue;
      usedTrack.add(pair.track);
      usedCell.add(pair.cell);
      const tr = active[pair.track];
      const c = cells[pair.cell];
      const dt = c.t - tr.last.t || 1;
      trackOf[pair.cell] = tr.id;
      continued.push({
        id: tr.id,
        last: c,
        vLon: (c.lon - tr.last.lon) / dt,
        vLat: (c.lat - tr.last.lat) / dt,
      });
    }
    const waiting = active.filter((_, ti) => !usedTrack.has(ti));
    for (let k = i; k < j; k++) {
      if (usedCell.has(k)) continue;
      trackOf[k] = nextId;
      continued.push({ id: nextId++, last: cells[k], vLon: 0, vLat: 0 });
    }
    active = [...continued, ...waiting];
    i = j;
  }
  return trackOf;
}

/** Index ranges [from, to) of the events in time-sorted cells. */
export function splitEvents(
  cells: readonly { t: number }[],
): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let start = 0;
  for (let i = 1; i <= cells.length; i++) {
    if (i === cells.length || cells[i].t - cells[i - 1].t >= EVENT_GAP_MS) {
      if (i > start) ranges.push([start, i]);
      start = i;
    }
  }
  return ranges;
}

function radarEventId(start: number): string {
  return `radar-${new Date(start).toISOString().replace(/[-:]/g, "").slice(0, 13)}`;
}

function summarize(
  id: string,
  source: HailEventSummary["source"],
  name: string | null,
  timed: boolean,
  cells: ReadonlyArray<{ t: number; c: RadarHailClass; d: number; b: Bbox }>,
  tracks: number,
): HailEventSummary {
  let maxClass: RadarHailClass = "mixed";
  let maxDbz = 0;
  const bbox: Bbox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const c of cells) {
    if (radarHailRank(c.c) > radarHailRank(maxClass)) maxClass = c.c;
    maxDbz = Math.max(maxDbz, c.d);
    bbox[0] = Math.min(bbox[0], c.b[0]);
    bbox[1] = Math.min(bbox[1], c.b[1]);
    bbox[2] = Math.max(bbox[2], c.b[2]);
    bbox[3] = Math.max(bbox[3], c.b[3]);
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
    tracks,
    cells: cells.length,
    bbox,
  };
}

/** Radar events of the archive, newest first. */
export function radarEvents(
  cells: readonly ArchivedHailCell[],
): HailEventSummary[] {
  return splitEvents(cells)
    .map(([from, to]) => {
      const part = cells.slice(from, to);
      const tracks = new Set(linkTracks(part)).size;
      return summarize(
        radarEventId(part[0].t),
        "radar",
        null,
        true,
        part,
        tracks,
      );
    })
    .reverse();
}

let eventsMemo: { version: number; events: HailEventSummary[] } | null = null;

function radarEventsMemo(): HailEventSummary[] {
  const version = radarArchiveVersion();
  if (eventsMemo?.version !== version) {
    eventsMemo = { version, events: radarEvents(archivedCells()) };
  }
  return eventsMemo.events;
}

/** Test hook. */
export function resetHailEventsForTests(): void {
  eventsMemo = null;
}

function radarEventEvidence(): RiskEvidence {
  return {
    source: "Deutscher Wetterdienst (DWD), KONRAD3D radar cell tracking",
    retrievedAt: new Date().toISOString(),
    dataVersion: "weather/radar/konrad3d, local archive",
    spatialResolution: "cell outlines on a 250 m radar grid, 5-minute steps",
    method: `Hail cells linked into tracks (≤ ${TRACK_LINK_KM} km from KONRAD3D's +5 min centroid forecast); an event ends after ${EVENT_GAP_MS / 3_600_000} h without hail cells`,
    confidence: 0.4,
    fallbackUsed: false,
    limitations: [
      "The outline is the whole storm cell; hail falls in part of it, so a cell over a site does not prove hail on the lot",
      "Only steps the app fetched while DWD still listed them (48 h) are in the archive",
      "Track linking is a heuristic: splits and merges of cells can start or end a track",
      "Stress test only: not used in the hail EAL and not a catastrophe-model PML",
    ],
  };
}

// --- Imported footprints ---------------------------------------------------

/** An imported event as stored in `hail_event_imports`. */
interface ImportedEvent {
  summary: HailEventSummary;
  cells: HailEventCell[];
}

const CLASS_ALIASES: Record<string, RadarHailClass> = {
  large: "large",
  large_hail: "large",
  "large hail": "large",
  grosshagel: "large",
  großhagel: "large",
  hail: "hail",
  hagel: "hail",
  mixed: "mixed",
  graupel: "mixed",
  "rain-hail": "mixed",
};

/**
 * Hail class of an imported feature: a `class` / `hail_class` property, or
 * a hail size in cm (`hail_size_cm`, `max_hail_size_cm`, `size_cm`):
 * ≥ 3 cm large, ≥ 1 cm hail, below that a mixture. Default: hail.
 */
export function importedClass(props: Record<string, unknown>): RadarHailClass {
  for (const key of ["class", "hail_class", "hailClass", "category"]) {
    const v = props[key];
    if (typeof v === "string") {
      const c = CLASS_ALIASES[v.trim().toLowerCase()];
      if (c) return c;
    }
  }
  for (const key of [
    "hail_size_cm",
    "max_hail_size_cm",
    "size_cm",
    "hailSizeCm",
  ]) {
    const v = Number(props[key]);
    if (Number.isFinite(v) && v > 0)
      return v >= 3 ? "large" : v >= 1 ? "hail" : "mixed";
  }
  return "hail";
}

function importedTime(props: Record<string, unknown>): number | null {
  for (const key of ["time", "datetime", "timestamp", "start", "date"]) {
    const v = props[key];
    if (typeof v === "string" || typeof v === "number") {
      const t = typeof v === "number" ? v : Date.parse(v);
      if (Number.isFinite(t)) return t;
    }
  }
  return null;
}

const round5 = (n: number): number => Math.round(n * 1e5) / 1e5;

function ringsOf(geometry: unknown): number[][][] {
  if (!geometry || typeof geometry !== "object") return [];
  const g = geometry as { type?: unknown; coordinates?: unknown };
  const polygons =
    g.type === "Polygon"
      ? [g.coordinates]
      : g.type === "MultiPolygon" && Array.isArray(g.coordinates)
        ? g.coordinates
        : [];
  const out: number[][][] = [];
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || !Array.isArray(polygon[0])) continue;
    // Outer ring only: holes in a hail swath do not change who it reaches
    // at the screening radius.
    const flat: number[] = [];
    for (const pt of polygon[0] as unknown[]) {
      if (!Array.isArray(pt)) continue;
      const [lon, lat] = pt as unknown[];
      if (typeof lon !== "number" || typeof lat !== "number") continue;
      if (
        !Number.isFinite(lon) ||
        !Number.isFinite(lat) ||
        Math.abs(lat) > 90 ||
        Math.abs(lon) > 180
      )
        continue;
      flat.push(round5(lon), round5(lat));
    }
    if (flat.length >= 6) out.push([flat]);
  }
  return out;
}

/**
 * Parses a GeoJSON FeatureCollection (or a single Feature) of hail
 * footprints: Polygon / MultiPolygon features in WGS84 with optional
 * properties `time` (ISO or Unix ms), `track` (features with the same
 * value form one track) and a class or hail size. Without any time the
 * event is a static footprint. Throws with a readable message on input
 * that is not usable.
 */
export function parseFootprintGeoJson(
  text: string,
  name: string,
  now = Date.now(),
): ImportedEvent {
  if (text.length > MAX_FOOTPRINT_BYTES)
    throw new Error("The file is larger than 20 MB.");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("The file is not valid JSON.");
  }
  const root = json as {
    type?: unknown;
    features?: unknown;
    properties?: unknown;
  };
  const features =
    root?.type === "FeatureCollection" && Array.isArray(root.features)
      ? root.features
      : root?.type === "Feature"
        ? [root]
        : null;
  if (!features)
    throw new Error("Expected a GeoJSON FeatureCollection or Feature.");
  const rootProps = (
    root.properties && typeof root.properties === "object"
      ? root.properties
      : {}
  ) as Record<string, unknown>;
  const rootTime = importedTime(rootProps);

  const drafts: Array<{
    t: number | null;
    track: string;
    c: RadarHailClass;
    rings: number[][];
  }> = [];
  features.forEach((feature: unknown, index: number) => {
    const f = feature as { geometry?: unknown; properties?: unknown };
    const props = (
      f?.properties && typeof f.properties === "object" ? f.properties : {}
    ) as Record<string, unknown>;
    const track =
      props.track ?? props.track_id ?? props.id ?? `feature-${index}`;
    for (const rings of ringsOf(f?.geometry)) {
      drafts.push({
        t: importedTime(props) ?? rootTime,
        track: String(track),
        c: importedClass(props),
        rings,
      });
    }
  });
  if (drafts.length === 0)
    throw new Error("The file has no polygon footprints in WGS84 (lon/lat).");
  if (drafts.length > MAX_EVENT_CELLS)
    throw new Error(`The file has more than ${MAX_EVENT_CELLS} polygons.`);

  const timed = drafts.some((d) => d.t != null);
  const fallbackT = drafts.find((d) => d.t != null)?.t ?? rootTime ?? now;
  const trackIds = new Map<string, number>();
  const cells: HailEventCell[] = drafts
    .map((d) => {
      let west = Infinity;
      let south = Infinity;
      let east = -Infinity;
      let north = -Infinity;
      for (const ring of d.rings)
        for (let i = 0; i < ring.length; i += 2) {
          west = Math.min(west, ring[i]);
          east = Math.max(east, ring[i]);
          south = Math.min(south, ring[i + 1]);
          north = Math.max(north, ring[i + 1]);
        }
      if (!trackIds.has(d.track)) trackIds.set(d.track, trackIds.size);
      return HailEventCellSchema.parse({
        t: d.t ?? fallbackT,
        track: trackIds.get(d.track)!,
        c: d.c,
        d: 0,
        p: [round5((west + east) / 2), round5((south + north) / 2)],
        b: [west, south, east, north],
        r: d.rings,
      });
    })
    .sort((a, b) => a.t - b.t || a.track - b.track);

  const id = `import-${createHash("sha1").update(text).digest("hex").slice(0, 12)}`;
  const label = name.trim().slice(0, 120) || "Imported footprint";
  return {
    summary: summarize(id, "import", label, timed, cells, trackIds.size),
    cells,
  };
}

function importEvidence(name: string | null): RiskEvidence {
  return {
    source: `Imported footprint${name ? ` (${name})` : ""}`,
    retrievedAt: new Date().toISOString(),
    dataVersion: "user-supplied GeoJSON",
    method:
      "Polygons as supplied; hail class from the file's class or hail-size property (≥ 3 cm large, ≥ 1 cm hail), else hail",
    confidence: 0.3,
    fallbackUsed: false,
    limitations: [
      "Supplied by the user and not verified by the app; source and licence are the user's responsibility",
      "Stress test only: not used in the hail EAL and not a catastrophe-model PML",
    ],
  };
}

function readImports(): ImportedEvent[] {
  const rows = getDb()
    .prepare("SELECT data FROM hail_event_imports ORDER BY created_at DESC")
    .all() as Array<{ data: string }>;
  const out: ImportedEvent[] = [];
  for (const row of rows) {
    try {
      out.push(JSON.parse(row.data) as ImportedEvent);
    } catch {
      // A damaged row is skipped; the user can import the file again.
    }
  }
  return out;
}

function readImport(id: string): ImportedEvent | null {
  const row = getDb()
    .prepare("SELECT data FROM hail_event_imports WHERE id = ?")
    .get(id) as { data: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.data) as ImportedEvent;
  } catch {
    return null;
  }
}

/** Stores an imported footprint; importing the same file again replaces it. */
export function importFootprint(
  content: string,
  name: string,
): HailEventSummary {
  const event = parseFootprintGeoJson(content, name);
  getDb()
    .prepare(
      "INSERT OR REPLACE INTO hail_event_imports (id, name, created_at, data) VALUES (?, ?, ?, ?)",
    )
    .run(
      event.summary.id,
      event.summary.name ?? "",
      new Date().toISOString(),
      JSON.stringify(event),
    );
  return event.summary;
}

export function deleteImportedEvent(id: string): boolean {
  return (
    getDb().prepare("DELETE FROM hail_event_imports WHERE id = ?").run(id)
      .changes > 0
  );
}

// --- IPC entry points ------------------------------------------------------

/** Radar events (synced briefly) and imported footprints. */
export async function listHailEvents(): Promise<HailEventList> {
  const synced = await syncBriefly();
  const span = archiveSpan();
  return {
    events: [...readImports().map((e) => e.summary), ...radarEventsMemo()],
    archiveFrom: span.from,
    archiveTo: span.to,
    steps: span.steps,
    synced,
    syncing: radarHailSyncing(),
  };
}

/** One event with its cells, ready to replay. Null when it is gone. */
export function hailEventDetail(id: string): HailEventDetail | null {
  if (id.startsWith("import-")) {
    const event = readImport(id);
    return event
      ? {
          summary: event.summary,
          cells: event.cells,
          evidence: importEvidence(event.summary.name),
        }
      : null;
  }
  const summary = radarEventsMemo().find((e) => e.id === id);
  if (!summary) return null;
  const rows = archivedCellsBetween(summary.start, summary.end).slice(
    0,
    MAX_EVENT_CELLS,
  );
  const tracks = linkTracks(rows);
  const cells: HailEventCell[] = rows.map((row, i) => ({
    t: row.t,
    track: tracks[i],
    c: row.c,
    d: row.d,
    p: [row.lon, row.lat],
    b: row.b,
    r: row.r,
  }));
  return { summary, cells, evidence: radarEventEvidence() };
}
