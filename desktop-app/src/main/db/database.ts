import Database from "better-sqlite3";
import { app } from "electron";
import { join } from "path";

/**
 * Lokale SQLite-DB im userData-Pfad. Single-File, kein Server.
 * Tabellen werden idempotent per raw SQL erstellt (wie im DRM-Original).
 */
let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = join(app.getPath("userData"), "dealership-risk.db");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
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
  `);

  return db;
}
