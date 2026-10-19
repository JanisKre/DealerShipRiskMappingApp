import { utilityProcess } from "electron";
import { join } from "node:path";
import { getDb } from "../db/database";
import {
  DirectoryIndex,
  type QueryLocality,
} from "./dealer-directory/directory-index";
import {
  fetchLatestRelease,
  isNewerRelease,
  type DealerRecord,
  type ExtractProgress,
  type ExtractResult,
} from "./dealer-directory/overture-dealers";
import {
  GENERIC_NAME_TOKENS,
  brandAliases,
  distanceKm,
  type ParsedPlaceQuery,
} from "./place-query";

/**
 * Local directory of German car dealers from Overture Maps places.
 *
 * Overture adds many businesses that OSM lacks (sourced from Meta, Microsoft,
 * Foursquare and others). It has no search API, so the German dealer subset
 * is downloaded once on request (worker: `overture-dealers.worker.ts`) and
 * searched locally with SQLite FTS5 next to the live OSM/Photon results.
 * An in-memory index of the same records adds typo tolerance and recognises
 * the city or postcode a query names.
 */

const META_KEY = "dealerDirectory";
const UPDATE_KEY = "dealerDirectoryUpdate";
/** Overture publishes about monthly; checking once a day is plenty. */
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FTS_CANDIDATES = 50;

export interface DealerDirectoryStatus {
  release: string;
  retrievedAt: string;
  count: number;
}

export interface DirectoryHit {
  id: string;
  label: string;
  name: string;
  street: string | null;
  lat: number;
  lon: number;
}

export interface DealerDirectoryUpdate {
  /** Newest release Overture's catalog named at `checkedAt`. */
  latestRelease: string;
  checkedAt: string;
  /** `latestRelease` is newer than the downloaded directory. */
  updateAvailable: boolean;
}

export interface DirectorySearch {
  /** Folded name tokens, place words already removed. */
  nameTokens: readonly string[];
  /** Overture categories to keep; empty keeps all. */
  categories?: readonly string[];
  /** Place the query names; hits outside it are only a fallback. */
  locality?: QueryLocality | null;
  /** Map view, used when the query names no place. */
  near?: { lat: number; lon: number };
  limit?: number;
}

interface DirectoryRow extends DealerRecord {
  rank: number;
}

export function dealerDirectoryStatus(): DealerDirectoryStatus | null {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(META_KEY) as { value: string } | undefined;
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value) as Partial<DealerDirectoryStatus>;
    return typeof parsed.release === "string" &&
      typeof parsed.retrievedAt === "string" &&
      typeof parsed.count === "number"
      ? (parsed as DealerDirectoryStatus)
      : null;
  } catch {
    return null;
  }
}

/** Replaces the whole directory atomically, so a search never sees half a release. */
export function storeDealerDirectory(
  result: ExtractResult,
  retrievedAt = new Date().toISOString(),
): DealerDirectoryStatus {
  const db = getDb();
  const status: DealerDirectoryStatus = {
    release: result.release,
    retrievedAt,
    count: result.records.length,
  };
  const insert = db.prepare(
    `INSERT OR REPLACE INTO dealer_directory
       (id, name, category, brand, street, postcode, city, lat, lon, confidence)
     VALUES (@id, @name, @category, @brand, @street, @postcode, @city, @lat, @lon, @confidence)`,
  );
  invalidateDirectoryIndex();
  db.transaction(() => {
    db.prepare("DELETE FROM dealer_directory").run();
    for (const record of result.records) insert.run(record);
    db.prepare(
      "INSERT INTO dealer_directory_fts(dealer_directory_fts) VALUES('rebuild')",
    ).run();
    db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    ).run(META_KEY, JSON.stringify(status));
  })();
  return status;
}

/**
 * Spellings of one folded token the FTS index may hold: the index keeps
 * "Müller" as "muller" and "Straße" as "straße", the query folds both to
 * "mueller"/"strasse"; brand aliases ("vw" → "volkswagen") are added too.
 */
export function tokenVariants(token: string): string[] {
  const variants = new Set([token]);
  const plain = token
    .replace(/ae/gu, "a")
    .replace(/oe/gu, "o")
    .replace(/ue/gu, "u");
  variants.add(plain);
  if (plain.includes("ss")) variants.add(plain.replace(/ss/gu, "ß"));
  for (const alias of brandAliases(token)) variants.add(alias);
  return [...variants];
}

/**
 * FTS5 prefix query: every identifying word must match the start of a token
 * in name, brand, street, postcode or city ("autohaus herz" finds "Autohaus
 * Herzog"). Generic words ("Autohaus") are only required when nothing else is
 * typed, so "Autohaus Müller" also finds "Müller Automobile".
 */
export function directoryMatchQuery(tokens: readonly string[]): string | null {
  const clean = tokens
    .map((token) => token.replace(/[^\p{L}\p{N}]+/gu, ""))
    .filter(Boolean);
  const specific = clean.filter((token) => !GENERIC_NAME_TOKENS.has(token));
  const used = (specific.length > 0 ? specific : clean).slice(0, 8);
  if (used.length === 0) return null;
  return used
    .map((token) => {
      const variants = tokenVariants(token).map((v) => `"${v}"*`);
      return variants.length === 1 ? variants[0] : `(${variants.join(" OR ")})`;
    })
    .join(" ");
}

export function directoryLabel(record: DealerRecord): string {
  const place = [record.postcode, record.city].filter(Boolean).join(" ");
  return [record.name, record.street, place].filter(Boolean).join(", ");
}

/**
 * Orders FTS candidates by text relevance (bm25, lower is better), nudged
 * towards the map view and towards confident records.
 */
export function rankDirectoryRows(
  rows: DirectoryRow[],
  near: { lat: number; lon: number } | undefined,
  limit: number,
): DirectoryHit[] {
  return rows
    .map((row) => {
      const relevance = -row.rank * (0.7 + 0.3 * row.confidence);
      const distancePenalty = near
        ? Math.log10(1 + distanceKm(near, row) / 10)
        : 0;
      return { row, score: relevance - distancePenalty };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ row }) => ({
      id: row.id,
      label: directoryLabel(row),
      name: row.name,
      street: row.street,
      lat: row.lat,
      lon: row.lon,
    }));
}

let directoryIndex: DirectoryIndex | null = null;

/** Drops the in-memory index; the next search rebuilds it from the table. */
export function invalidateDirectoryIndex(): void {
  directoryIndex = null;
}

/** Built on first use and dropped whenever the directory is replaced. */
function getDirectoryIndex(): DirectoryIndex {
  directoryIndex ??= new DirectoryIndex(
    getDb()
      .prepare(
        `SELECT id, name, category, brand, street, postcode, city, lat, lon, confidence
           FROM dealer_directory`,
      )
      .all() as DealerRecord[],
  );
  return directoryIndex;
}

/**
 * Finds the city or postcode a query names, using the directory's own
 * addresses; without a directory the query is left as it is.
 */
export function resolveQueryLocality(
  query: Pick<ParsedPlaceQuery, "nameTokens" | "postcode"> &
    Partial<Pick<ParsedPlaceQuery, "categories">>,
): { locality: QueryLocality | null; nameTokens: string[] } {
  try {
    return getDirectoryIndex().resolveLocality(
      query.nameTokens,
      query.postcode,
      (query.categories?.length ?? 0) > 0,
    );
  } catch (err) {
    console.error("Dealer directory locality lookup failed:", err);
    return { locality: null, nameTokens: [...query.nameTokens] };
  }
}

function ftsRows(
  match: string,
  categories: readonly string[],
  locality: QueryLocality | null,
): DirectoryRow[] {
  const where = ["dealer_directory_fts MATCH ?"];
  const params: Array<string | number> = [match];
  if (categories.length > 0) {
    where.push(`d.category IN (${categories.map(() => "?").join(", ")})`);
    params.push(...categories);
  }
  if (locality) {
    const dLat = locality.radiusKm / 111;
    const dLon = dLat / Math.cos((locality.lat * Math.PI) / 180);
    where.push("d.lat BETWEEN ? AND ? AND d.lon BETWEEN ? AND ?");
    params.push(
      locality.lat - dLat,
      locality.lat + dLat,
      locality.lon - dLon,
      locality.lon + dLon,
    );
  }
  return getDb()
    .prepare(
      `SELECT d.id, d.name, d.category, d.brand, d.street, d.postcode, d.city,
              d.lat, d.lon, d.confidence,
              bm25(dealer_directory_fts, 10.0, 3.0, 1.0, 2.0, 2.0) AS rank
         FROM dealer_directory_fts
         JOIN dealer_directory d ON d.rowid = dealer_directory_fts.rowid
        WHERE ${where.join(" AND ")}
        ORDER BY rank
        LIMIT ${FTS_CANDIDATES}`,
    )
    .all(...params) as DirectoryRow[];
}

function toHit(record: DealerRecord): DirectoryHit {
  return {
    id: record.id,
    label: directoryLabel(record),
    name: record.name,
    street: record.street,
    lat: record.lat,
    lon: record.lon,
  };
}

/**
 * Searches the directory: FTS prefix matches first (inside the named place,
 * else anywhere), then likely typos to fill the remaining slots. A query of
 * only a kind and a place ("Motorradhändler Dresden") lists the nearest
 * dealers of that kind.
 */
export function searchDealerDirectory({
  nameTokens,
  categories = [],
  locality = null,
  near,
  limit = 6,
}: DirectorySearch): DirectoryHit[] {
  try {
    const accept = (record: DealerRecord): boolean =>
      categories.length === 0 || categories.includes(record.category);
    const focus = locality ?? near;
    const match = directoryMatchQuery(nameTokens);
    if (!match) {
      return locality
        ? getDirectoryIndex().nearby(locality, accept, limit).map(toHit)
        : [];
    }
    let rows = ftsRows(match, categories, locality);
    if (rows.length === 0 && locality) rows = ftsRows(match, categories, null);
    const hits = rankDirectoryRows(rows, focus, limit);
    if (hits.length >= limit) return hits;

    const seen = new Set(hits.map((hit) => hit.id));
    const typos = getDirectoryIndex()
      .fuzzySearch(nameTokens, (r) => accept(r) && !seen.has(r.id), limit * 4)
      .map(({ record, similarity }) => ({
        record,
        score: focus
          ? similarity - 0.3 * Math.log10(1 + distanceKm(focus, record) / 10)
          : similarity,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit - hits.length)
      .map(({ record }) => toHit(record));
    return [...hits, ...typos];
  } catch (err) {
    // A malformed query must never break the live OSM search next to it.
    console.error("Dealer directory search failed:", err);
    return [];
  }
}

function storedUpdate(): Omit<DealerDirectoryUpdate, "updateAvailable"> | null {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(UPDATE_KEY) as { value: string } | undefined;
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value) as Partial<DealerDirectoryUpdate>;
    return typeof parsed.latestRelease === "string" &&
      typeof parsed.checkedAt === "string"
      ? { latestRelease: parsed.latestRelease, checkedAt: parsed.checkedAt }
      : null;
  } catch {
    return null;
  }
}

let activeCheck: Promise<DealerDirectoryUpdate | null> | null = null;

/**
 * Asks Overture's catalog for its newest release, at most once a day, and
 * says whether it is newer than the downloaded directory. Only runs once
 * the user has downloaded a directory; the download itself stays a click.
 */
export function checkDealerDirectoryUpdate(
  options: { now?: Date; fetchLatest?: () => Promise<string> } = {},
): Promise<DealerDirectoryUpdate | null> {
  const status = dealerDirectoryStatus();
  if (!status) return Promise.resolve(null);
  const now = options.now ?? new Date();
  const withAvailability = (
    stored: Omit<DealerDirectoryUpdate, "updateAvailable">,
  ): DealerDirectoryUpdate => ({
    ...stored,
    updateAvailable: isNewerRelease(stored.latestRelease, status.release),
  });
  const cached = storedUpdate();
  if (
    cached &&
    now.getTime() - Date.parse(cached.checkedAt) < UPDATE_CHECK_INTERVAL_MS
  ) {
    return Promise.resolve(withAvailability(cached));
  }
  activeCheck ??= (options.fetchLatest ?? fetchLatestRelease)()
    .then((latestRelease) => {
      const stored = { latestRelease, checkedAt: now.toISOString() };
      getDb()
        .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
        .run(UPDATE_KEY, JSON.stringify(stored));
      return withAvailability(stored);
    })
    .catch((err: unknown) => {
      // Offline or Overture down: keep the last known answer.
      console.warn("Dealer directory update check failed:", err);
      return cached ? withAvailability(cached) : null;
    })
    .finally(() => {
      activeCheck = null;
    });
  return activeCheck;
}

let activeRefresh: Promise<DealerDirectoryStatus> | null = null;

/**
 * Downloads the current Overture release's German dealers in a worker and
 * replaces the local directory. Only one refresh runs at a time.
 */
export function refreshDealerDirectory(
  onProgress: (progress: ExtractProgress) => void,
  signal?: AbortSignal,
): Promise<DealerDirectoryStatus> {
  if (activeRefresh) return activeRefresh;
  activeRefresh = new Promise<DealerDirectoryStatus>((resolve, reject) => {
    const proc = utilityProcess.fork(
      join(__dirname, "overture-dealers.worker.cjs"),
    );
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const onAbort = (): void => {
      proc.kill();
      finish(() => reject(new Error("Dealer directory download cancelled")));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });

    proc.on(
      "message",
      (
        msg:
          | { type: "progress"; progress: ExtractProgress }
          | { type: "result"; result: ExtractResult }
          | { type: "error"; error: string },
      ) => {
        if (msg.type === "progress") onProgress(msg.progress);
        else if (msg.type === "error") {
          proc.kill();
          finish(() => reject(new Error(msg.error)));
        } else if (msg.type === "result") {
          proc.kill();
          finish(() => {
            try {
              resolve(storeDealerDirectory(msg.result));
            } catch (err) {
              reject(err instanceof Error ? err : new Error(String(err)));
            }
          });
        }
      },
    );
    proc.on("exit", () =>
      finish(() => reject(new Error("Dealer directory worker exited"))),
    );
    proc.postMessage({ type: "start" });
  }).finally(() => {
    activeRefresh = null;
  });
  return activeRefresh;
}
