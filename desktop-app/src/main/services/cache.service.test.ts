import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const statement = { get: vi.fn(), run: vi.fn() };
  return {
    statement,
    db: { prepare: vi.fn(() => statement) },
  };
});

vi.mock("../db/database", () => ({ getDb: () => mocks.db }));

import { cached } from "./cache.service";

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
});
