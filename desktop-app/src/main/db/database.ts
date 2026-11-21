import Database from "better-sqlite3";
import { app } from "electron";
import { copyFileSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { basename, dirname } from "node:path";
import { join } from "path";
import { getCacheDb } from "./cache-database";

/**
 * Lokale SQLite-DB im userData-Pfad. Single-File, kein Server.
 * Tabellen werden über versionierte, transaktionale Migrationen erstellt.
 */
let db: Database.Database | null = null;
const SCHEMA_VERSION = 6;
/** First schema without the API and tile cache (now `cache-database.ts`). */
const SCHEMA_WITHOUT_CACHE = 5;

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = join(app.getPath("userData"), "dealership-risk.db");
  const databaseAlreadyExists = existsSync(dbPath);
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const currentVersion = Number(db.pragma("user_version", { simple: true }));
  if (currentVersion > SCHEMA_VERSION) {
    db.close();
    db = null;
    throw new Error(
      `Database schema ${currentVersion} is newer than this app supports (${SCHEMA_VERSION})`,
    );
  }
  if (databaseAlreadyExists && currentVersion < SCHEMA_VERSION) {
    createDatabaseBackup(db, dbPath);
  }

  try {
    migrateDatabase(db, currentVersion);
  } catch (error) {
    db.close();
    db = null;
    throw error;
  }
  if (databaseAlreadyExists && currentVersion < SCHEMA_WITHOUT_CACHE) {
    // The cache left this file: shrink it, and drop the cache from the
    // migration backups too (they held up to several hundred MB of tiles
    // each). Both are one-off and take about a second per file.
    compactDatabase(db);
    stripCacheFromBackups(dbPath);
  }

  return db;
}

export interface MigrationOptions {
  /** Last schema version to migrate to (tests); default: the current one. */
  toVersion?: number;
  /** Where migration 5 moves the cache; opened only if there is any. */
  openCache?: () => Database.Database;
}

/** Runs the migrations after `fromVersion`, each in its own transaction. */
export function migrateDatabase(
  database: Database.Database,
  fromVersion = Number(database.pragma("user_version", { simple: true })),
  options: MigrationOptions = {},
): void {
  const toVersion = options.toVersion ?? SCHEMA_VERSION;
  const context: MigrationContext = {
    openCache: options.openCache ?? getCacheDb,
  };
  for (let version = fromVersion + 1; version <= toVersion; version++) {
    const migrate = MIGRATIONS[version];
    if (!migrate) throw new Error(`Missing database migration ${version}`);
    database.transaction(() => {
      migrate(database, context);
      database.pragma(`user_version = ${version}`);
    })();
  }
}

interface MigrationContext {
  openCache: () => Database.Database;
}

type Migration = (
  database: Database.Database,
  context: MigrationContext,
) => void;

const MIGRATIONS: Record<number, Migration> = {
  1: (database) =>
    database.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data       TEXT NOT NULL           -- JSON: AnalyzedDealership[]
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data       TEXT NOT NULL           -- JSON: ChatMessage[]
    );

    CREATE TABLE IF NOT EXISTS dashboards (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data       TEXT NOT NULL           -- JSON: { prompt, surface: A2uiSurface }
    );

    -- Persistent API cache with TTL (replaces the ephemeral nginx cache)
    CREATE TABLE IF NOT EXISTS api_cache (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      expires_at INTEGER NOT NULL        -- Unix ms
    );
  `),
  // Local car-dealer directory from Overture Maps places, searched alongside
  // OSM/Photon. Fully replaced on every refresh; `rowid` links the FTS index.
  2: (database) =>
    database.exec(`
    CREATE TABLE IF NOT EXISTS dealer_directory (
      id         TEXT PRIMARY KEY,       -- Overture GERS id
      name       TEXT NOT NULL,
      category   TEXT NOT NULL,          -- Overture taxonomy primary
      brand      TEXT,
      street     TEXT,
      postcode   TEXT,
      city       TEXT,
      lat        REAL NOT NULL,
      lon        REAL NOT NULL,
      confidence REAL NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS dealer_directory_fts USING fts5(
      name, brand, street, postcode, city,
      content = 'dealer_directory',
      content_rowid = 'rowid',
      tokenize = 'unicode61 remove_diacritics 2'
    );
  `),
  // Radar hail archive in its own tables: until now every day was one JSON
  // blob in `api_cache`, rewritten on every sync and read in full for each
  // query. Cells get an R-tree for the location query and a time index for
  // event replay; the old blobs are copied over and removed.
  // `hail_event_imports` keeps footprints the user imported (GeoJSON).
  3: (database) => {
    database.exec(`
    CREATE TABLE IF NOT EXISTS radar_hail_cells (
      id    INTEGER PRIMARY KEY,
      t     INTEGER NOT NULL,            -- radar step, Unix ms
      class TEXT    NOT NULL,            -- large | hail | mixed
      dbz   REAL    NOT NULL,
      lat   REAL    NOT NULL,            -- cell centroid
      lon   REAL    NOT NULL,
      flat  REAL,                        -- KONRAD3D centroid forecast +5 min
      flon  REAL,
      rings TEXT    NOT NULL             -- JSON: flat [lon, lat, …] outlines
    );
    CREATE INDEX IF NOT EXISTS radar_hail_cells_t ON radar_hail_cells (t);
    CREATE VIRTUAL TABLE IF NOT EXISTS radar_hail_cells_box
      USING rtree(id, west, east, south, north);

    -- File names already processed; pruned once DWD no longer lists them.
    CREATE TABLE IF NOT EXISTS radar_hail_files (
      name TEXT PRIMARY KEY,
      t    INTEGER NOT NULL
    );

    -- Radar steps processed per UTC day: the archive's coverage.
    CREATE TABLE IF NOT EXISTS radar_hail_coverage (
      day     TEXT PRIMARY KEY,          -- YYYYMMDD
      steps   INTEGER NOT NULL,
      first_t INTEGER NOT NULL,
      last_t  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hail_event_imports (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      created_at TEXT NOT NULL,
      data       TEXT NOT NULL           -- JSON: ImportedHailEvent
    );
  `);
    migrateRadarHailCache(database);
  },
  // AI record book: one row per request sent to an AI provider (local only).
  4: (database) =>
    database.exec(`
    CREATE TABLE IF NOT EXISTS ai_log (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      at             TEXT    NOT NULL,   -- ISO timestamp
      feature        TEXT    NOT NULL,   -- IPC channel or gateway route
      provider       TEXT    NOT NULL,
      model          TEXT    NOT NULL,
      endpoint_host  TEXT    NOT NULL,
      local          INTEGER NOT NULL,   -- 1: endpoint on this computer
      status         TEXT    NOT NULL,   -- ok | error | aborted
      duration_ms    INTEGER NOT NULL,
      request_chars  INTEGER NOT NULL,
      response_chars INTEGER NOT NULL,
      image_count    INTEGER NOT NULL,
      error          TEXT,
      request        TEXT    NOT NULL,   -- clipped (shared/ai-log.ts)
      response       TEXT    NOT NULL
    );
  `),
  // API answers and imagery tiles move to their own file (cache-database.ts):
  // they made up 95 % of this database and of every migration backup.
  5: (database, { openCache }) => {
    moveApiCache(database, openCache);
    database.exec("DROP TABLE IF EXISTS api_cache");
  },
  // One row per location instead of one JSON blob per portfolio, so a save
  // writes only the locations that changed (sessions.repo.ts). `revision`
  // counts saves; a save of changes names the revision it builds on.
  6: (database) => {
    database.exec(`
    CREATE TABLE IF NOT EXISTS session_sites (
      session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
      site_id    TEXT NOT NULL,
      data       TEXT NOT NULL,          -- JSON: AnalyzedDealership
      PRIMARY KEY (session_id, site_id)
    );
    ALTER TABLE sessions ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
  `);
    splitSessionSites(database);
  },
};

/**
 * Moves the locations of every saved portfolio into `session_sites`; their
 * order stays in the portfolio row (`order`). A portfolio whose locations
 * lack unique ids keeps them inline, which the loader still reads.
 */
export function splitSessionSites(database: Database.Database): number {
  const sessions = database
    .prepare("SELECT id, data FROM sessions")
    .all() as Array<{ id: string; data: string }>;
  const insert = database.prepare(
    "INSERT INTO session_sites (session_id, site_id, data) VALUES (?, ?, ?)",
  );
  const update = database.prepare("UPDATE sessions SET data = ? WHERE id = ?");
  let split = 0;
  for (const session of sessions) {
    let stored: unknown;
    try {
      stored = JSON.parse(session.data);
    } catch {
      continue;
    }
    const envelope: Record<string, unknown> | null = Array.isArray(stored)
      ? { dealerships: stored }
      : typeof stored === "object" && stored !== null
        ? (stored as Record<string, unknown>)
        : null;
    const sites = envelope?.dealerships;
    if (!envelope || !Array.isArray(sites)) continue;
    const ids = sites.map((site) =>
      typeof (site as { id?: unknown })?.id === "string"
        ? (site as { id: string }).id
        : null,
    );
    if (ids.some((id) => id == null) || new Set(ids).size !== ids.length) {
      continue;
    }
    sites.forEach((site, i) =>
      insert.run(session.id, ids[i], JSON.stringify(site)),
    );
    const { dealerships: _inline, ...rest } = envelope;
    update.run(JSON.stringify({ ...rest, order: ids }), session.id);
    split++;
  }
  return split;
}

/**
 * Copies `api_cache` into the cache database: JSON answers as they are,
 * imagery tiles (base64 text until now) as bytes. Expired tiles are left
 * behind; expired answers are kept, `cached()` serves them when offline.
 * Returns how many entries were copied.
 */
export function moveApiCache(
  database: Database.Database,
  openCache: () => Database.Database,
): { entries: number; tiles: number } {
  const moved = { entries: 0, tiles: 0 };
  const table = database
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'api_cache'",
    )
    .get();
  if (!table) return moved;
  const { n } = database
    .prepare("SELECT COUNT(*) AS n FROM api_cache")
    .get() as { n: number };
  if (n === 0) return moved;

  const cache = openCache();
  const insertEntry = cache.prepare(
    "INSERT OR REPLACE INTO api_cache (key, value, expires_at) VALUES (?, ?, ?)",
  );
  const insertTile = cache.prepare(
    "INSERT OR REPLACE INTO tile_cache (key, data, expires_at) VALUES (?, ?, ?)",
  );
  const rows = database
    .prepare(
      `SELECT key, value, expires_at FROM api_cache
        WHERE key NOT LIKE 'tile:%' OR expires_at >= ?`,
    )
    .iterate(Date.now()) as IterableIterator<{
    key: string;
    value: string;
    expires_at: number;
  }>;
  cache.transaction(() => {
    for (const row of rows) {
      if (!row.key.startsWith("tile:")) {
        insertEntry.run(row.key, row.value, row.expires_at);
        moved.entries++;
        continue;
      }
      let base64: unknown;
      try {
        base64 = JSON.parse(row.value);
      } catch {
        continue;
      }
      if (typeof base64 !== "string" || base64.length === 0) continue;
      insertTile.run(row.key, Buffer.from(base64, "base64"), row.expires_at);
      moved.tiles++;
    }
  })();
  return moved;
}

/**
 * Rewrites the file without its free pages and switches it to incremental
 * vacuum, so pages freed later can be given back without a full rewrite.
 */
export function compactDatabase(database: Database.Database): void {
  try {
    database.pragma("auto_vacuum = INCREMENTAL");
    database.exec("VACUUM");
  } catch (error) {
    // Only disk space: the data is unaffected.
    console.warn("Compacting the local database failed:", error);
  }
}

/** Gives free pages back to the file system (housekeeping, cheap). */
export function reclaimDatabaseSpace(): void {
  try {
    getDb().pragma("incremental_vacuum");
  } catch (error) {
    console.warn("Shrinking the local database failed:", error);
  }
}

/**
 * Empties the API cache inside the migration backups of `dbPath`. The
 * table itself stays, so an old backup still migrates; only cached answers
 * and tiles go, which are fetched again when needed.
 */
export function stripCacheFromBackups(dbPath: string): string[] {
  const dir = dirname(dbPath);
  const prefix = `${basename(dbPath)}.backup-`;
  const stripped: string[] = [];
  for (const name of readdirSync(dir).filter((n) => n.startsWith(prefix))) {
    let backup: Database.Database | null = null;
    try {
      backup = new Database(join(dir, name));
      const table = backup
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'api_cache'",
        )
        .get();
      if (!table) continue;
      const hasRows = backup.prepare("SELECT 1 FROM api_cache LIMIT 1").get();
      if (!hasRows) continue;
      backup.exec("DELETE FROM api_cache");
      backup.exec("VACUUM");
      stripped.push(name);
    } catch (error) {
      console.warn("Could not shrink the database backup:", name, error);
    } finally {
      backup?.close();
    }
  }
  return stripped;
}

interface LegacyHailCell {
  t: string;
  c: string;
  d: number;
  b: [number, number, number, number];
  r: number[][];
}

/**
 * Copies the radar hail archive of schema 2 (`api_cache` keys
 * `radarhail:v1:*`) into the tables of schema 3. A malformed day is
 * skipped, never fatal: the archive is context data.
 */
export function migrateRadarHailCache(database: Database.Database): void {
  const rows = database
    .prepare(
      "SELECT key, value FROM api_cache WHERE key LIKE 'radarhail:v1:day:%'",
    )
    .all() as Array<{ key: string; value: string }>;
  const insertCell = database.prepare(
    "INSERT INTO radar_hail_cells (t, class, dbz, lat, lon, rings) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const insertBox = database.prepare(
    "INSERT INTO radar_hail_cells_box (id, west, east, south, north) VALUES (?, ?, ?, ?, ?)",
  );
  const insertFile = database.prepare(
    "INSERT OR IGNORE INTO radar_hail_files (name, t) VALUES (?, ?)",
  );
  const upsertCoverage = database.prepare(
    `INSERT INTO radar_hail_coverage (day, steps, first_t, last_t) VALUES (?, ?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET steps = steps + excluded.steps,
       first_t = MIN(first_t, excluded.first_t), last_t = MAX(last_t, excluded.last_t)`,
  );
  for (const row of rows) {
    let stored: { files?: unknown; cells?: unknown };
    try {
      stored = JSON.parse(row.value) as typeof stored;
    } catch {
      continue;
    }
    const day = row.key.slice("radarhail:v1:day:".length);
    const files = Array.isArray(stored.files)
      ? stored.files.filter((f): f is string => typeof f === "string")
      : [];
    const times = files
      .map((f) => /T(\d{2})(\d{2})(\d{2})\.xml$/.exec(f))
      .filter((m): m is RegExpExecArray => m != null)
      .map((m) =>
        Date.UTC(
          Number(day.slice(0, 4)),
          Number(day.slice(4, 6)) - 1,
          Number(day.slice(6, 8)),
          Number(m[1]),
          Number(m[2]),
          Number(m[3]),
        ),
      );
    if (times.length > 0 && /^\d{8}$/.test(day)) {
      upsertCoverage.run(
        day,
        times.length,
        Math.min(...times),
        Math.max(...times),
      );
      files.forEach((f, i) => {
        if (times[i] != null) insertFile.run(f, times[i]);
      });
    }
    const cells = Array.isArray(stored.cells)
      ? (stored.cells as LegacyHailCell[])
      : [];
    for (const cell of cells) {
      const t = Date.parse(cell?.t);
      const b = cell?.b;
      if (!Number.isFinite(t) || !Array.isArray(b) || b.length !== 4) continue;
      if (!["large", "hail", "mixed"].includes(cell.c)) continue;
      const { lastInsertRowid } = insertCell.run(
        t,
        cell.c,
        Number(cell.d) || 0,
        (b[1] + b[3]) / 2,
        (b[0] + b[2]) / 2,
        JSON.stringify(cell.r ?? []),
      );
      insertBox.run(lastInsertRowid, b[0], b[2], b[1], b[3]);
    }
  }
  database
    .prepare("DELETE FROM api_cache WHERE key LIKE 'radarhail:v1:%'")
    .run();
}

/** Pre-migration backups kept; older ones only took up disk space. */
export const MIGRATION_BACKUPS_KEPT = 3;

/** Deletes all but the newest `MIGRATION_BACKUPS_KEPT` migration backups. */
export function pruneOldBackups(dbPath: string): string[] {
  const dir = dirname(dbPath);
  const prefix = `${basename(dbPath)}.backup-`;
  const backups = readdirSync(dir)
    .filter((name) => name.startsWith(prefix))
    // ISO timestamps sort chronologically as text.
    .sort();
  const old = backups.slice(
    0,
    Math.max(0, backups.length - MIGRATION_BACKUPS_KEPT),
  );
  const removed: string[] = [];
  for (const name of old) {
    try {
      unlinkSync(join(dir, name));
      removed.push(name);
    } catch (error) {
      // A locked or vanished file is retried at the next migration.
      console.warn("Could not delete an old database backup:", name, error);
    }
  }
  return removed;
}

function createDatabaseBackup(
  database: Database.Database,
  dbPath: string,
): void {
  try {
    // Checkpoint WAL pages so the backup is a standalone SQLite file.
    database.pragma("wal_checkpoint(TRUNCATE)");
    const backupPath = `${dbPath}.backup-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}`;
    copyFileSync(dbPath, backupPath);
    pruneOldBackups(dbPath);
  } catch (error) {
    // A backup failure must never silently turn into a destructive migration.
    throw new Error(
      `Could not create database backup before migration: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

export function closeDb(): void {
  if (!db) return;
  db.close();
  db = null;
}
