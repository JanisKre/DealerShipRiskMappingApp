import type BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The cache tests run against a real in-memory cache database. */
let memoryDb: BetterSqlite3.Database | null = null;
vi.mock("../db/cache-database", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/cache-database")>()),
  getCacheDb: () => memoryDb,
}));

const { openCacheDatabase } = await import("../db/cache-database");
const {
  cached,
  cacheGet,
  cacheSet,
  pruneExpired,
  tileCacheGet,
  tileCacheSet,
  trimCacheToSize,
} = await import("./cache.service");

function put(
  table: "api_cache" | "tile_cache",
  key: string,
  value: string | Buffer,
  expiresAt: number,
): void {
  const column = table === "tile_cache" ? "data" : "value";
  memoryDb!
    .prepare(
      `INSERT INTO ${table} (key, ${column}, expires_at) VALUES (?, ?, ?)`,
    )
    .run(key, value, expiresAt);
}

function keys(table: "api_cache" | "tile_cache"): string[] {
  return (
    memoryDb!.prepare(`SELECT key FROM ${table} ORDER BY key`).all() as {
      key: string;
    }[]
  ).map((row) => row.key);
}

beforeEach(() => {
  memoryDb = openCacheDatabase(":memory:");
});
afterEach(() => {
  memoryDb?.close();
  memoryDb = null;
});

describe("persistent cache", () => {
  it("returns a fresh cached value without calling the fetcher", async () => {
    put(
      "api_cache",
      "key",
      JSON.stringify({ source: "cache" }),
      Date.now() + 60_000,
    );
    const fetcher = vi.fn().mockResolvedValue({ source: "network" });

    await expect(cached("key", 60_000, fetcher)).resolves.toEqual({
      source: "cache",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses stale data when the network is unavailable", async () => {
    put(
      "api_cache",
      "key",
      JSON.stringify({ source: "stale-cache" }),
      Date.now() - 1,
    );
    const fetcher = vi.fn().mockRejectedValue(new Error("offline"));

    await expect(cached("key", 60_000, fetcher)).resolves.toEqual({
      source: "stale-cache",
    });
  });

  it("drops an expired entry on read and a corrupt one as well", () => {
    put("api_cache", "old", JSON.stringify(1), Date.now() - 1);
    put("api_cache", "broken", "{not json", Date.now() + 60_000);
    expect(cacheGet("old")).toBeNull();
    expect(cacheGet("broken")).toBeNull();
    expect(keys("api_cache")).toEqual([]);
  });

  it("round-trips a value", () => {
    cacheSet("geocode:x", [{ lat: 1 }], 60_000);
    expect(cacheGet("geocode:x")).toEqual([{ lat: 1 }]);
  });

  it("prunes expired entries of one key prefix in a bounded batch", () => {
    const past = Date.now() - 1;
    put("tile_cache", "tile:v2:esri:live:19/1/1", Buffer.from([1]), past);
    put("tile_cache", "tile:v2:esri:live:19/1/2", Buffer.from([2]), past);
    put(
      "tile_cache",
      "tile:v2:esri:live:19/1/3",
      Buffer.from([3]),
      Date.now() + 60_000,
    );
    put("tile_cache", "tilf", Buffer.from([4]), past);

    expect(pruneExpired("tile_cache", "tile:", 1)).toBe(1);
    expect(pruneExpired("tile_cache", "tile:", 100)).toBe(1);
    expect(pruneExpired("tile_cache", "tile:", 100)).toBe(0);
    expect(keys("tile_cache")).toEqual(["tile:v2:esri:live:19/1/3", "tilf"]);
  });
});

describe("tile cache", () => {
  it("keeps tile bytes as they are", () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x42]);
    tileCacheSet("tile:a", bytes, 60_000);
    expect(tileCacheGet("tile:a")?.equals(bytes)).toBe(true);
  });

  it("never serves an expired tile", () => {
    put("tile_cache", "tile:a", Buffer.from([1]), Date.now() - 1);
    expect(tileCacheGet("tile:a")).toBeNull();
    expect(keys("tile_cache")).toEqual([]);
  });
});

describe("trimCacheToSize", () => {
  it("does nothing under the bound", () => {
    put("tile_cache", "tile:a", Buffer.alloc(100), Date.now() + 1_000);
    expect(trimCacheToSize("tile_cache", "tile:", 1_000)).toBe(0);
    expect(keys("tile_cache")).toEqual(["tile:a"]);
  });

  it("deletes the entries closest to expiry above the bound", () => {
    const now = Date.now();
    put("tile_cache", "tile:a", Buffer.alloc(600), now + 3_000);
    put("tile_cache", "tile:b", Buffer.alloc(600), now + 1_000);
    put("tile_cache", "tile:c", Buffer.alloc(600), now + 2_000);
    expect(trimCacheToSize("tile_cache", "tile:", 1_000, 2)).toBe(2);
    expect(keys("tile_cache")).toEqual(["tile:a"]);
    expect(trimCacheToSize("tile_cache", "tile:", 1_000, 2)).toBe(0);
  });
});

describe("empty geocoding answers", () => {
  it("are cached with the shorter lifetime from ttlFor", async () => {
    await cached(
      "geocode:x",
      30_000,
      async () => [],
      (v: unknown[]) => (v.length === 0 ? 1_000 : 30_000),
    );
    const { expires_at } = memoryDb!
      .prepare("SELECT expires_at FROM api_cache WHERE key = ?")
      .get("geocode:x") as { expires_at: number };
    expect(expires_at - Date.now()).toBeLessThanOrEqual(1_000);
  });
});

describe("cache database file", () => {
  it("starts afresh on a file of another schema version", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { default: Database } = await import("better-sqlite3");
    const dir = mkdtempSync(join(tmpdir(), "drm-cache-"));
    try {
      const path = join(dir, "cache.db");
      const foreign = new Database(path);
      foreign.exec("CREATE TABLE stray (x); INSERT INTO stray VALUES (1);");
      foreign.pragma("user_version = 99");
      foreign.close();

      const db = openCacheDatabase(path);
      expect(db.pragma("user_version", { simple: true })).toBe(1);
      expect(db.pragma("auto_vacuum", { simple: true })).toBe(2);
      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
          )
          .all(),
      ).toEqual([{ name: "api_cache" }, { name: "tile_cache" }]);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
