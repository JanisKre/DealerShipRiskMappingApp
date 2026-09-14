import { createHash } from "node:crypto";
import { getDb } from "../db/database";

/**
 * Persistent key/value cache with TTL based on the SQLite DB.
 * Survives app restarts and enables partial offline operation.
 */
export function cacheGet<T>(key: string): T | null {
  const row = readCache<T>(key);

  if (!row) return null;
  if (row.expires_at < Date.now()) {
    getDb().prepare("DELETE FROM api_cache WHERE key = ?").run(key);
    return null;
  }
  return row.value;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  getDb()
    .prepare(
      "INSERT OR REPLACE INTO api_cache (key, value, expires_at) VALUES (?, ?, ?)",
    )
    .run(key, JSON.stringify(value), Date.now() + ttlMs);
}

/** Cache-first helper: returns the cached value or calls fetcher() and caches it. */
export async function cached<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const cachedEntry = readCache<T>(key);
  if (cachedEntry && cachedEntry.expires_at >= Date.now()) {
    return cachedEntry.value;
  }
  try {
    const value = await fetcher();
    cacheSet(key, value, ttlMs);
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
  const row = getDb()
    .prepare("SELECT value, expires_at FROM api_cache WHERE key = ?")
    .get(key) as { value: string; expires_at: number } | undefined;
  if (!row) return null;
  try {
    return { value: JSON.parse(row.value) as T, expires_at: row.expires_at };
  } catch {
    // Corrupt cache entries are disposable; the caller can fetch fresh data.
    getDb().prepare("DELETE FROM api_cache WHERE key = ?").run(key);
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
} as const;
