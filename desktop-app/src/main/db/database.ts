import Database from "better-sqlite3";
import { app } from "electron";
import { copyFileSync, existsSync } from "node:fs";
import { join } from "path";

/**
 * Lokale SQLite-DB im userData-Pfad. Single-File, kein Server.
 * Tabellen werden über versionierte, transaktionale Migrationen erstellt.
 */
let db: Database.Database | null = null;
const SCHEMA_VERSION = 1;

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
    for (
      let version = currentVersion + 1;
      version <= SCHEMA_VERSION;
      version++
    ) {
      const migrate = MIGRATIONS[version];
      if (!migrate) throw new Error(`Missing database migration ${version}`);
      db.transaction(() => {
        migrate(db as Database.Database);
        db?.pragma(`user_version = ${version}`);
      })();
    }
  } catch (error) {
    db.close();
    db = null;
    throw error;
  }

  return db;
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
      data       TEXT NOT NULL           -- JSON: { prompt, spec: DashboardSpec }
    );

    -- Persistent API cache with TTL (replaces the ephemeral nginx cache)
    CREATE TABLE IF NOT EXISTS api_cache (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      expires_at INTEGER NOT NULL        -- Unix ms
    );
  `),
};

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
    );
  }
}

export function closeDb(): void {
  if (!db) return;
  db.close();
  db = null;
}
