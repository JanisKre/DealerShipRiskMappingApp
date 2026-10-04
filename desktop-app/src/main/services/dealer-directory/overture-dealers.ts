/**
 * Extracts every car dealership in Germany from the Overture Maps places
 * theme (https://docs.overturemaps.org/guides/places/).
 *
 * Overture publishes GeoParquet files rather than a search API. This reads
 * them straight from the public bucket with HTTP range requests (hyparquet,
 * pure JS — no DuckDB or native module):
 *
 *   1. The STAC catalog names the latest release and each file's bbox, so only
 *      the files overlapping Germany are opened.
 *   2. Each file's footer carries per-row-group bbox statistics, so only the
 *      row groups overlapping Germany are read.
 *   3. Pass one reads just the tiny `basic_category` column; pass two reads
 *      name, address and position only for row groups that contain dealers.
 *
 * Kept free of Electron imports: it runs inside a utilityProcess worker
 * (zstd decompression is CPU-heavy) and is unit-tested with plain fixtures.
 */
import { parquetMetadataAsync, parquetReadObjects } from "hyparquet";
import type { AsyncBuffer, FileMetaData } from "hyparquet";
import { compressors } from "hyparquet-compressors";
import { fetchWithResilience } from "../http.service";

export const STAC_ROOT = "https://stac.overturemaps.org/catalog.json";
/** West, south, east, north — generous enough to include border towns. */
export const GERMANY_BBOX: Bbox = [5.85, 47.25, 15.05, 55.1];
/** Hosts the extraction may fetch from; STAC content is remote input. */
const ALLOWED_HOSTS = new Set([
  "stac.overturemaps.org",
  "overturemaps-us-west-2.s3.us-west-2.amazonaws.com",
]);
/**
 * Below this Overture confidence a place is usually a stale or duplicate
 * record (closed businesses, misplaced pins); Overture's own guidance treats
 * low scores as unreliable.
 */
export const MIN_CONFIDENCE = 0.5;
/** Overture `basic_category` values that cover vehicle dealers. */
const DEALER_BASIC_CATEGORIES = new Set(["auto_dealer", "vehicle_dealer"]);
/**
 * `vehicle_dealer` also contains forklifts, boats and mobile homes; keep the
 * road-vehicle dealers whose stock sits outside like a car lot.
 */
const VEHICLE_DEALER_TAXONOMY = new Set([
  "vehicle_dealer",
  "truck_dealer",
  "commercial_vehicle_dealer",
  "motorcycle_dealer",
  "recreational_vehicle_dealer",
  "trailer_dealer",
]);
const READ_CONCURRENCY = 4;

export type Bbox = [west: number, south: number, east: number, north: number];

export interface DealerRecord {
  /** Overture GERS id — stable across releases. */
  id: string;
  name: string;
  /** Overture taxonomy primary category, e.g. `auto_dealer`, `used_auto_dealer`. */
  category: string;
  brand: string | null;
  street: string | null;
  postcode: string | null;
  city: string | null;
  lat: number;
  lon: number;
  confidence: number;
}

export interface ExtractProgress {
  phase: "discover" | "read";
  doneRowGroups: number;
  totalRowGroups: number;
  found: number;
}

export interface ExtractResult {
  release: string;
  records: DealerRecord[];
}

interface PlaceFile {
  url: string;
  byteLength: number;
}

type FetchJson = (url: string) => Promise<unknown>;

export function bboxIntersects(a: Bbox, b: Bbox): boolean {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

function assertAllowedUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid Overture URL: ${url}`);
  }
  if (parsed.protocol !== "https:" || !ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error(`Unexpected Overture host: ${parsed.host}`);
  }
  return parsed.toString();
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const res = await fetchWithResilience(
    assertAllowedUrl(url),
    {},
    {
      timeoutMs: 30_000,
    },
  );
  if (!res.ok) throw new Error(`Overture STAC ${res.status}: ${url}`);
  return res.json();
}

interface StacLink {
  rel?: string;
  href?: string;
  title?: string;
}

function links(doc: unknown): StacLink[] {
  const value = (doc as { links?: unknown })?.links;
  return Array.isArray(value) ? (value as StacLink[]) : [];
}

function childHref(doc: unknown, title: string): string {
  const link = links(doc).find((l) => l.rel === "child" && l.title === title);
  if (!link?.href) throw new Error(`Overture STAC: no '${title}' child`);
  return link.href;
}

/** Latest release plus the places files whose bbox overlaps `bbox`. */
export async function discoverPlaceFiles(
  bbox: Bbox,
  fetchJson: FetchJson = defaultFetchJson,
): Promise<{ release: string; files: PlaceFile[] }> {
  const root = (await fetchJson(STAC_ROOT)) as { latest?: unknown };
  const release = typeof root.latest === "string" ? root.latest : null;
  if (!release || !/^\d{4}-\d{2}-\d{2}\.\d+$/u.test(release)) {
    throw new Error("Overture STAC: latest release missing");
  }
  const releaseLink = links(root).find(
    (l) => l.rel === "child" && l.href?.includes(`/${release}/`),
  );
  if (!releaseLink?.href) throw new Error("Overture STAC: release not linked");
  const releaseCatalog = await fetchJson(releaseLink.href);
  const placesCatalog = await fetchJson(childHref(releaseCatalog, "places"));
  const collection = await fetchJson(childHref(placesCatalog, "place"));
  const itemHrefs = links(collection)
    .filter((l) => l.rel === "item" && l.href)
    .map((l) => l.href as string);

  const files: PlaceFile[] = [];
  for (const href of itemHrefs) {
    const item = (await fetchJson(href)) as {
      bbox?: number[];
      assets?: { aws?: { href?: string; "file:size"?: number } };
    };
    const itemBbox = item.bbox;
    const asset = item.assets?.aws;
    if (
      !Array.isArray(itemBbox) ||
      itemBbox.length !== 4 ||
      !asset?.href ||
      typeof asset["file:size"] !== "number"
    ) {
      continue;
    }
    if (!bboxIntersects(itemBbox as Bbox, bbox)) continue;
    files.push({
      url: assertAllowedUrl(asset.href),
      byteLength: asset["file:size"],
    });
  }
  if (files.length === 0) throw new Error("Overture STAC: no places files");
  return { release, files };
}

/** Parquet file over HTTP range requests with retries on dropped connections. */
export function rangeBuffer(
  file: PlaceFile,
  signal?: AbortSignal,
): AsyncBuffer {
  return {
    byteLength: file.byteLength,
    async slice(start: number, end?: number): Promise<ArrayBuffer> {
      const last = (end ?? file.byteLength) - 1;
      const res = await fetchWithResilience(
        file.url,
        { headers: { Range: `bytes=${start}-${last}` }, signal },
        { timeoutMs: 120_000, retries: 4, backoffMs: 500 },
      );
      if (res.status !== 206) {
        throw new Error(`Overture range request failed (${res.status})`);
      }
      return res.arrayBuffer();
    },
  };
}

/** Row ranges of the row groups whose bbox statistics overlap `bbox`. */
export function rowGroupsInBbox(
  metadata: FileMetaData,
  bbox: Bbox,
): Array<{ rowStart: number; rowEnd: number }> {
  const groups: Array<{ rowStart: number; rowEnd: number }> = [];
  let rowStart = 0;
  for (const group of metadata.row_groups) {
    const rows = Number(group.num_rows);
    const stat = (path: string): number | undefined => {
      const column = group.columns.find(
        (c) => c.meta_data?.path_in_schema.join(".") === path,
      );
      const stats = column?.meta_data?.statistics;
      const value = path.endsWith("min")
        ? (stats?.min_value ?? stats?.min)
        : (stats?.max_value ?? stats?.max);
      return typeof value === "number" ? value : undefined;
    };
    const west = stat("bbox.xmin");
    const south = stat("bbox.ymin");
    const east = stat("bbox.xmax");
    const north = stat("bbox.ymax");
    // Missing statistics: read the group rather than silently dropping data.
    const overlaps =
      west === undefined ||
      south === undefined ||
      east === undefined ||
      north === undefined ||
      bboxIntersects([west, south, east, north], bbox);
    if (overlaps) groups.push({ rowStart, rowEnd: rowStart + rows });
    rowStart += rows;
  }
  return groups;
}

export function isDealerPlace(
  basicCategory: unknown,
  taxonomyPrimary: unknown,
): boolean {
  if (typeof basicCategory !== "string") return false;
  if (!DEALER_BASIC_CATEGORIES.has(basicCategory)) return false;
  if (basicCategory === "auto_dealer") return true;
  return (
    typeof taxonomyPrimary === "string" &&
    VEHICLE_DEALER_TAXONOMY.has(taxonomyPrimary)
  );
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

interface OvertureRow {
  id?: unknown;
  names?: { primary?: unknown } | null;
  basic_category?: unknown;
  taxonomy?: { primary?: unknown } | null;
  brand?: { names?: { primary?: unknown } | null } | null;
  addresses?: Array<{
    freeform?: unknown;
    locality?: unknown;
    postcode?: unknown;
    country?: unknown;
  }> | null;
  bbox?: { xmin?: unknown; ymin?: unknown } | null;
  confidence?: unknown;
  operating_status?: unknown;
}

/**
 * Turns one Overture place into a directory record, or `null` when it is not
 * a usable German dealership (other category, abroad, closed, unnamed or below
 * `MIN_CONFIDENCE`).
 */
export function toDealerRecord(
  row: OvertureRow,
  bbox: Bbox = GERMANY_BBOX,
): DealerRecord | null {
  const category = text(row.taxonomy?.primary) ?? text(row.basic_category);
  if (!isDealerPlace(row.basic_category, row.taxonomy?.primary)) return null;
  const id = text(row.id);
  const name = text(row.names?.primary);
  const lon = row.bbox?.xmin;
  const lat = row.bbox?.ymin;
  const confidence = row.confidence;
  if (!id || !name || !category) return null;
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  if (lon < bbox[0] || lon > bbox[2] || lat < bbox[1] || lat > bbox[3]) {
    return null;
  }
  if (typeof confidence !== "number" || confidence < MIN_CONFIDENCE) {
    return null;
  }
  const status = text(row.operating_status);
  if (status && status !== "open") return null;
  const address = row.addresses?.[0];
  const country = text(address?.country);
  // The bbox also clips corners of every neighbour; a stated country decides.
  if (country && country.toUpperCase() !== "DE") return null;
  return {
    id,
    name,
    category,
    brand: text(row.brand?.names?.primary),
    street: text(address?.freeform),
    postcode: text(address?.postcode),
    city: text(address?.locality),
    lat,
    lon,
    confidence,
  };
}

/**
 * Downloads the German dealer subset of the latest Overture release.
 * `onProgress` reports per row group; aborting `signal` stops all requests.
 */
export async function extractGermanDealers(
  options: {
    onProgress?: (progress: ExtractProgress) => void;
    signal?: AbortSignal;
    fetchJson?: FetchJson;
  } = {},
): Promise<ExtractResult> {
  const { onProgress, signal } = options;
  onProgress?.({
    phase: "discover",
    doneRowGroups: 0,
    totalRowGroups: 0,
    found: 0,
  });
  const { release, files } = await discoverPlaceFiles(
    GERMANY_BBOX,
    options.fetchJson,
  );

  const plans: Array<{
    buffer: AsyncBuffer;
    metadata: FileMetaData;
    groups: Array<{ rowStart: number; rowEnd: number }>;
  }> = [];
  for (const file of files) {
    signal?.throwIfAborted();
    const buffer = rangeBuffer(file, signal);
    const metadata = await parquetMetadataAsync(buffer);
    plans.push({
      buffer,
      metadata,
      groups: rowGroupsInBbox(metadata, GERMANY_BBOX),
    });
  }

  const tasks = plans.flatMap((plan) =>
    plan.groups.map((group) => ({ ...plan, group })),
  );
  const byId = new Map<string, DealerRecord>();
  let done = 0;
  const report = (): void =>
    onProgress?.({
      phase: "read",
      doneRowGroups: done,
      totalRowGroups: tasks.length,
      found: byId.size,
    });
  report();

  let next = 0;
  async function worker(): Promise<void> {
    while (next < tasks.length) {
      signal?.throwIfAborted();
      const { buffer, metadata, group } = tasks[next++];
      const read = (columns: string[]): Promise<Record<string, unknown>[]> =>
        parquetReadObjects({
          file: buffer,
          metadata,
          compressors,
          columns,
          rowStart: group.rowStart,
          rowEnd: group.rowEnd,
        });
      const categories = await read(["basic_category"]);
      const candidate = categories.some(
        (row) =>
          typeof row.basic_category === "string" &&
          DEALER_BASIC_CATEGORIES.has(row.basic_category),
      );
      if (candidate) {
        const rows = await read([
          "id",
          "names",
          "basic_category",
          "taxonomy",
          "brand",
          "addresses",
          "bbox",
          "confidence",
          "operating_status",
        ]);
        for (const row of rows) {
          const record = toDealerRecord(row as OvertureRow);
          if (record) byId.set(record.id, record);
        }
      }
      done++;
      report();
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(READ_CONCURRENCY, tasks.length) }, () =>
      worker(),
    ),
  );
  return { release, records: [...byId.values()] };
}
