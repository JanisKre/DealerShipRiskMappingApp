import Database from "better-sqlite3";
import { app } from "electron";
import { copyFileSync, existsSync } from "node:fs";
import { join } from "path";

/**
 * Lokale SQLite-DB im userData-Pfad. Single-File, kein Server.
 * Tabellen werden über versionierte, transaktionale Migrationen erstellt.
 */
let db: Database.Database | null = null;
const SCHEMA_VERSION = 3;

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

  return db;
}

/** Runs the migrations after `fromVersion`, each in its own transaction. */
export function migrateDatabase(
  database: Database.Database,
  fromVersion = Number(database.pragma("user_version", { simple: true })),
): void {
  for (let version = fromVersion + 1; version <= SCHEMA_VERSION; version++) {
    const migrate = MIGRATIONS[version];
    if (!migrate) throw new Error(`Missing database migration ${version}`);
    database.transaction(() => {
      migrate(database);
      database.pragma(`user_version = ${version}`);
    })();
  }
}

type Migration = (database: Database.Database) => void;

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
};

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
