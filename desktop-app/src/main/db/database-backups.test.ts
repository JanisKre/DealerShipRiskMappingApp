import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => tmpdir() } }));

import Database from "better-sqlite3";
import {
  MIGRATION_BACKUPS_KEPT,
  migrateDatabase,
  moveApiCache,
  pruneOldBackups,
  stripCacheFromBackups,
} from "./database";
import { openCacheDatabase } from "./cache-database";

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("pruneOldBackups", () => {
  it("keeps the newest backups and nothing else of theirs", () => {
    dir = mkdtempSync(join(tmpdir(), "drm-backups-"));
    const db = join(dir, "dealership-risk.db");
    writeFileSync(db, "");
    const stamps = [
      "2026-01-01T00-00-00-000Z",
      "2026-03-01T00-00-00-000Z",
      "2026-06-01T00-00-00-000Z",
      "2026-09-01T00-00-00-000Z",
      "2026-11-01T00-00-00-000Z",
    ];
    for (const s of stamps) writeFileSync(`${db}.backup-${s}`, "");
    writeFileSync(join(dir, "other.backup-2020"), "");

    const removed = pruneOldBackups(db);

    expect(removed).toHaveLength(stamps.length - MIGRATION_BACKUPS_KEPT);
    const left = readdirSync(dir).filter((n) => n.includes(".db.backup-"));
    expect(left.sort()).toEqual(
      stamps
        .slice(-MIGRATION_BACKUPS_KEPT)
        .map((s) => `dealership-risk.db.backup-${s}`),
    );
    expect(readdirSync(dir)).toContain("other.backup-2020");
  });
});

describe("the cache leaves the portfolio database (schema 5)", () => {
  function schema4WithCache(): Database.Database {
    const db = new Database(":memory:");
    migrateDatabase(db, 0, { toVersion: 4 });
    const put = db.prepare(
      "INSERT INTO api_cache (key, value, expires_at) VALUES (?, ?, ?)",
    );
    const future = Date.now() + 60_000;
    put.run("alkis:a", JSON.stringify({ parcels: 1 }), future);
    put.run("geocode:stale", JSON.stringify([]), 1);
    put.run("tile:v2:esri:live:20/1/1", JSON.stringify("/9j/AAEC"), future);
    put.run("tile:v2:esri:live:20/1/2", JSON.stringify("/9j/AAED"), 1);
    put.run("tile:v2:esri:live:20/1/3", "{broken", future);
    return db;
  }

  it("moves answers as they are and live tiles as bytes", () => {
    const db = schema4WithCache();
    const cache = openCacheDatabase(":memory:");
    expect(moveApiCache(db, () => cache)).toEqual({ entries: 2, tiles: 1 });
    expect(
      cache.prepare("SELECT key FROM api_cache ORDER BY key").all(),
    ).toEqual([{ key: "alkis:a" }, { key: "geocode:stale" }]);
    const tile = cache
      .prepare("SELECT data FROM tile_cache WHERE key = ?")
      .get("tile:v2:esri:live:20/1/1") as { data: Buffer };
    expect(tile.data.equals(Buffer.from("/9j/AAEC", "base64"))).toBe(true);
  });

  it("drops the table from the portfolio database", () => {
    const db = schema4WithCache();
    const cache = openCacheDatabase(":memory:");
    migrateDatabase(db, 4, { openCache: () => cache });
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE name = 'api_cache'")
        .get(),
    ).toBeUndefined();
    expect(cache.prepare("SELECT COUNT(*) AS n FROM tile_cache").get()).toEqual(
      { n: 1 },
    );
  });

  it("opens no cache file when there is nothing to move", () => {
    const db = new Database(":memory:");
    const openCache = vi.fn();
    migrateDatabase(db, 0, { openCache });
    expect(openCache).not.toHaveBeenCalled();
  });

  it("empties the cache inside old backups but keeps their table", () => {
    dir = mkdtempSync(join(tmpdir(), "drm-backups-"));
    const dbPath = join(dir, "dealership-risk.db");
    const backupPath = `${dbPath}.backup-2026-11-15T09-47-24-855Z`;
    const backup = new Database(backupPath);
    migrateDatabase(backup, 0, { toVersion: 4 });
    backup
      .prepare(
        "INSERT INTO api_cache (key, value, expires_at) VALUES (?, ?, ?)",
      )
      .run("tile:x", JSON.stringify("x".repeat(500_000)), 1);
    backup
      .prepare(
        "INSERT INTO sessions (id, name, created_at, updated_at, data) VALUES ('s', 'S', '', '', '[]')",
      )
      .run();
    backup.close();

    expect(stripCacheFromBackups(dbPath)).toEqual([
      "dealership-risk.db.backup-2026-11-15T09-47-24-855Z",
    ]);
    const reopened = new Database(backupPath, { readonly: true });
    expect(
      reopened.prepare("SELECT COUNT(*) AS n FROM api_cache").get(),
    ).toEqual({ n: 0 });
    expect(reopened.prepare("SELECT id FROM sessions").all()).toEqual([
      { id: "s" },
    ]);
    reopened.close();
    // Nothing left to strip the second time.
    expect(stripCacheFromBackups(dbPath)).toEqual([]);
  });
});
