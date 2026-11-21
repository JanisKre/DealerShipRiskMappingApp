import Database from "better-sqlite3";
import { app } from "electron";
import { rmSync } from "node:fs";
import { join } from "node:path";

/**
 * Second SQLite file for everything that can be fetched again: API answers
 * and imagery tiles. Kept apart from the portfolio database so that its
 * migration backups stay small and a damaged or outdated cache never stands
 * in the way of the user's data: an unreadable cache file, or one written by
 * another schema version, is deleted and started afresh.
 */

export const CACHE_DATABASE_FILE = "dealership-risk-cache.db";

/** Bumped when the cache tables change; an older or newer file is dropped. */
export const CACHE_SCHEMA_VERSION = 1;

const SCHEMA = `
  -- JSON answers of public services with their lifetime (Unix ms).
  CREATE TABLE IF NOT EXISTS api_cache (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );

  -- Imagery tiles as the bytes the server sent (JPEG/PNG).
  CREATE TABLE IF NOT EXISTS tile_cache (
    key        TEXT PRIMARY KEY,
    data       BLOB NOT NULL,
    expires_at INTEGER NOT NULL
  );
`;

let cacheDb: Database.Database | null = null;

export function cacheDatabasePath(): string {
  return join(app.getPath("userData"), CACHE_DATABASE_FILE);
}

export function getCacheDb(): Database.Database {
  if (cacheDb) return cacheDb;
  cacheDb = openCacheDatabase(cacheDatabasePath());
  return cacheDb;
}

/**
 * Opens (or creates) a cache database at `path`. A file that cannot be read
 * or has another schema version is replaced by an empty one.
 */
export function openCacheDatabase(path: string): Database.Database {
  try {
    return openOrCreate(path);
  } catch (error) {
    console.warn("Imagery and API cache unreadable, starting afresh:", error);
    removeCacheFiles(path);
    return openOrCreate(path);
  }
}

function openOrCreate(path: string): Database.Database {
  const database = new Database(path);
  try {
    const version = Number(database.pragma("user_version", { simple: true }));
    if (version !== 0 && version !== CACHE_SCHEMA_VERSION) {
      throw new Error(
        `Cache schema ${version} is not ${CACHE_SCHEMA_VERSION}; it is rebuilt`,
      );
    }
    if (version === 0) {
      // Only takes effect before the first table exists: free pages are then
      // handed back to the file system by `incremental_vacuum`.
      database.pragma("auto_vacuum = INCREMENTAL");
    }
    database.pragma("journal_mode = WAL");
    // A lost last write only costs a download again.
    database.pragma("synchronous = NORMAL");
    if (version === 0) {
      database.exec(SCHEMA);
      database.pragma(`user_version = ${CACHE_SCHEMA_VERSION}`);
    }
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

function removeCacheFiles(path: string): void {
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    rmSync(`${path}${suffix}`, { force: true });
  }
}

/**
 * Hands free pages of the cache file back to the file system, at most
 * `pages` at a time (0: all). Called after expired entries were deleted.
 */
export function reclaimCacheSpace(pages = 0): void {
  getCacheDb().pragma(`incremental_vacuum(${Math.max(0, Math.floor(pages))})`);
}

export function closeCacheDb(): void {
  if (!cacheDb) return;
  cacheDb.close();
  cacheDb = null;
}
