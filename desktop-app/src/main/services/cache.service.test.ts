import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const statement = { get: vi.fn(), run: vi.fn() };
  return {
    statement,
    db: { prepare: vi.fn(() => statement) },
  };
});

vi.mock("../db/database", () => ({ getDb: () => mocks.db }));

import { cached, pruneExpired, trimCacheToSize } from "./cache.service";

describe("persistent cache", () => {
  beforeEach(() => {
    mocks.statement.get.mockReset();
    mocks.statement.run.mockReset();
  });

  it("returns a fresh cached value without calling the fetcher", async () => {
    mocks.statement.get.mockReturnValue({
      value: JSON.stringify({ source: "cache" }),
      expires_at: Date.now() + 60_000,
    });
    const fetcher = vi.fn().mockResolvedValue({ source: "network" });

    await expect(cached("key", 60_000, fetcher)).resolves.toEqual({
      source: "cache",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses stale data when the network is unavailable", async () => {
    mocks.statement.get.mockReturnValue({
      value: JSON.stringify({ source: "stale-cache" }),
      expires_at: Date.now() - 1,
    });
    const fetcher = vi.fn().mockRejectedValue(new Error("offline"));

    await expect(cached("key", 60_000, fetcher)).resolves.toEqual({
      source: "stale-cache",
    });
  });

  it("prunes expired entries of one key prefix in a bounded batch", () => {
    mocks.statement.run.mockReturnValue({ changes: 7 });
    const before = Date.now();

    expect(pruneExpired("tile:", 100)).toBe(7);

    const [from, to, now, limit] = mocks.statement.run.mock.calls[0] as [
      string,
      string,
      number,
      number,
    ];
    expect(from).toBe("tile:");
    expect("tile:v2:esri:live:19/1/2" < to).toBe(true);
    expect("tilf" < to).toBe(false);
    expect(now).toBeGreaterThanOrEqual(before);
    expect(limit).toBe(100);
  });
});

describe("trimCacheToSize", () => {
  beforeEach(() => {
    mocks.statement.get.mockReset();
    mocks.statement.run.mockReset();
  });

  it("does nothing under the bound", () => {
    mocks.statement.get.mockReturnValue({ bytes: 100 });
    expect(trimCacheToSize("tile:", 1_000)).toBe(0);
    expect(mocks.statement.run).not.toHaveBeenCalled();
  });

  it("deletes the entries closest to expiry above the bound", () => {
    mocks.statement.get.mockReturnValue({ bytes: 5_000 });
    mocks.statement.run.mockReturnValue({ changes: 3 });
    expect(trimCacheToSize("tile:", 1_000, 3)).toBe(3);
    const calls = mocks.db.prepare.mock.calls as unknown as string[][];
    const sql = String(calls.at(-1)?.[0]);
    expect(sql).toMatch(/ORDER BY expires_at ASC LIMIT/);
  });
});

describe("empty geocoding answers", () => {
  it("are cached with the shorter lifetime from ttlFor", async () => {
    mocks.statement.get.mockReturnValue(undefined);
    mocks.statement.run.mockReset();
    await cached(
      "geocode:x",
      30_000,
      async () => [],
      (v: unknown[]) => (v.length === 0 ? 1_000 : 30_000),
    );
    const expires = mocks.statement.run.mock.calls[0]?.at(-1) as number;
    expect(expires - Date.now()).toBeLessThanOrEqual(1_000);
  });
});
