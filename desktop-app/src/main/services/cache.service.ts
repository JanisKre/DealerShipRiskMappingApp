import { getDb } from "../db/database";

/**
 * Persistent key/value cache with TTL based on the SQLite DB.
 * Survives app restarts and enables partial offline operation.
 */
export function cacheGet<T>(key: string): T | null {
  const row = getDb()
    .prepare("SELECT value, expires_at FROM api_cache WHERE key = ?")
    .get(key) as { value: string; expires_at: number } | undefined;

  if (!row) return null;
  if (row.expires_at < Date.now()) {
    getDb().prepare("DELETE FROM api_cache WHERE key = ?").run(key);
    return null;
  }
  return JSON.parse(row.value) as T;
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
  const hit = cacheGet<T>(key);
  if (hit !== null) return hit;
  const value = await fetcher();
  cacheSet(key, value, ttlMs);
  return value;
}

export const TTL = {
  geocode: 30 * 24 * 60 * 60 * 1000, // 30 d
  overpass: 60 * 60 * 1000, // 1 h
  buildings: 7 * 24 * 60 * 60 * 1000, // 7 d
  weather: 12 * 60 * 60 * 1000, // 12 h
  osmDetails: 7 * 24 * 60 * 60 * 1000, // 7 d
} as const;
