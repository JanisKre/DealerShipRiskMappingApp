import { createHash } from "node:crypto";
import { getCacheDb } from "../db/cache-database";

/**
 * Persistent key/value cache with TTL in its own SQLite file
 * (`cache-database.ts`). Survives app restarts and enables partial offline
 * operation. JSON answers go to `api_cache`, imagery tiles as bytes to
 * `tile_cache`.
 */
export function cacheGet<T>(key: string): T | null {
  const row = readCache<T>(key);

  if (!row) return null;
  if (row.expires_at < Date.now()) {
    getCacheDb().prepare("DELETE FROM api_cache WHERE key = ?").run(key);
    return null;
  }
  return row.value;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  getCacheDb()
    .prepare(
      "INSERT OR REPLACE INTO api_cache (key, value, expires_at) VALUES (?, ?, ?)",
    )
    .run(key, JSON.stringify(value), Date.now() + ttlMs);
}

/** A cached imagery tile, or null when it is missing or expired. */
export function tileCacheGet(key: string): Buffer | null {
  const db = getCacheDb();
  const row = db
    .prepare("SELECT data, expires_at FROM tile_cache WHERE key = ?")
    .get(key) as { data: Buffer; expires_at: number } | undefined;
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.prepare("DELETE FROM tile_cache WHERE key = ?").run(key);
    return null;
  }
  return row.data;
}

export function tileCacheSet(key: string, data: Buffer, ttlMs: number): void {
  getCacheDb()
    .prepare(
      "INSERT OR REPLACE INTO tile_cache (key, data, expires_at) VALUES (?, ?, ?)",
    )
    .run(key, data, Date.now() + ttlMs);
}

/** The two cache tables; never user input (it is part of the SQL). */
export type CacheTable = "api_cache" | "tile_cache";

/**
 * Deletes up to `limit` expired entries whose key starts with `prefix` and
 * returns how many were removed. Only for keys read through `cacheGet` or
 * `tileCacheGet`, which never serve an expired entry: `cached()` keeps stale
 * values as an offline fallback, so those must not be pruned.
 */
export function pruneExpired(
  table: CacheTable,
  prefix: string,
  limit = 500,
): number {
  return getCacheDb()
    .prepare(
      `DELETE FROM ${table} WHERE key IN (
         SELECT key FROM ${table}
          WHERE key >= ? AND key < ? AND expires_at < ? LIMIT ?)`,
    )
    .run(prefix, `${prefix}\uffff`, Date.now(), limit).changes;
}

/**
 * Deletes up to `limit` entries under `prefix`, those closest to expiry
 * first, while the entries under it hold more than `maxBytes`. Returns how
 * many were removed; call again until it returns 0.
 */
export function trimCacheToSize(
  table: CacheTable,
  prefix: string,
  maxBytes: number,
  limit = 500,
): number {
  const db = getCacheDb();
  const column = table === "tile_cache" ? "data" : "value";
  const range = [prefix, `${prefix}\uffff`] as const;
  const { bytes } = db
    .prepare(
      `SELECT COALESCE(SUM(length(${column})), 0) AS bytes FROM ${table}
        WHERE key >= ? AND key < ?`,
    )
    .get(...range) as { bytes: number };
  if (bytes <= maxBytes) return 0;
  return db
    .prepare(
      `DELETE FROM ${table} WHERE key IN (
         SELECT key FROM ${table} WHERE key >= ? AND key < ?
          ORDER BY expires_at ASC LIMIT ?)`,
    )
    .run(...range, limit).changes;
}

/** Cache-first helper: returns the cached value or calls fetcher() and caches it. */
export async function cached<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
  /** Lifetime for a particular value, e.g. shorter for an empty answer. */
  ttlFor?: (value: T) => number,
): Promise<T> {
  const cachedEntry = readCache<T>(key);
  if (cachedEntry && cachedEntry.expires_at >= Date.now()) {
    return cachedEntry.value;
  }
  try {
    const value = await fetcher();
    cacheSet(key, value, ttlFor ? ttlFor(value) : ttlMs);
    return value;
  } catch (error) {
    // Offline mode remains useful with stale data. Callers can still expose
    // the retrieval timestamp through their evidence metadata.
    if (cachedEntry) return cachedEntry.value;
    throw error;
  }
}

interface CacheEntry<T> {
  value: T;
  expires_at: number;
}

function readCache<T>(key: string): CacheEntry<T> | null {
  const row = getCacheDb()
    .prepare("SELECT value, expires_at FROM api_cache WHERE key = ?")
    .get(key) as { value: string; expires_at: number } | undefined;
  if (!row) return null;
  try {
    return { value: JSON.parse(row.value) as T, expires_at: row.expires_at };
  } catch {
    // Corrupt cache entries are disposable; the caller can fetch fresh data.
    getCacheDb().prepare("DELETE FROM api_cache WHERE key = ?").run(key);
    return null;
  }
}

/**
 * Short, deterministic fragment for embedding free-form config (a custom WMS
 * URL, a parser identifier) into a cache key. A cache key must change when
 * the *meaning* of a request changes — a raw URL would work too, but it can
 * contain characters that make keys unwieldy to read in the `api_cache` table.
 */
export function cacheKeyFragment(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 10);
}

export const TTL = {
  geocode: 30 * 24 * 60 * 60 * 1000, // 30 d
  overpass: 60 * 60 * 1000, // 1 h
  buildings: 7 * 24 * 60 * 60 * 1000, // 7 d
  weather: 12 * 60 * 60 * 1000, // 12 h
  osmDetails: 7 * 24 * 60 * 60 * 1000, // 7 d
  /**
   * Fences, roads, buildings and land use barely move. Re-fetching them at the
   * 1 h `overpass` TTL is pure latency on every re-analysis.
   */
  osmVector: 7 * 24 * 60 * 60 * 1000, // 7 d
  /** Cadastral parcels change on the order of years. */
  cadastre: 30 * 24 * 60 * 60 * 1000, // 30 d
  /** Esri republishes World Imagery roughly monthly; a week keeps new scenes visible. */
  imageryMetadata: 7 * 24 * 60 * 60 * 1000, // 7 d
  /** Esri publishes a new Wayback version every few weeks. */
  waybackConfig: 24 * 60 * 60 * 1000, // 24 h
  /** A published Wayback version is frozen; only its listing can be revised. */
  waybackArchive: 30 * 24 * 60 * 60 * 1000, // 30 d
} as const;
