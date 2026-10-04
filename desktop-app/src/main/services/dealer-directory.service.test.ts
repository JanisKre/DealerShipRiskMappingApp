import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const statement = { run: vi.fn(), get: vi.fn(), all: vi.fn() };
  const db = {
    prepare: vi.fn(() => statement),
    transaction: vi.fn((fn: () => void) => fn),
  };
  return { statement, db };
});

vi.mock("electron", () => ({ utilityProcess: { fork: vi.fn() } }));
vi.mock("../db/database", () => ({ getDb: () => mocks.db }));

import {
  dealerDirectoryStatus,
  directoryLabel,
  directoryMatchQuery,
  rankDirectoryRows,
  searchDealerDirectory,
  storeDealerDirectory,
} from "./dealer-directory.service";

const record = {
  id: "a",
  name: "Autohaus Muster",
  category: "auto_dealer",
  brand: null,
  street: "Ringweg 3",
  postcode: "01067",
  city: "Dresden",
  lat: 51.05,
  lon: 13.74,
  confidence: 0.9,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("directoryMatchQuery", () => {
  it("turns every word into a prefix match and drops legal forms", () => {
    expect(directoryMatchQuery("Autohaus Herz GmbH")).toBe(
      '"autohaus"* "herz"*',
    );
  });

  it("strips FTS syntax characters instead of passing them through", () => {
    expect(directoryMatchQuery('Auto" OR name:*')).toBe(
      '"auto"* "or"* "name"*',
    );
    expect(directoryMatchQuery("  ,;  ")).toBe(null);
  });
});

describe("rankDirectoryRows", () => {
  it("prefers the nearer of two equally relevant dealers", () => {
    const far = { ...record, id: "far", lat: 53.55, lon: 9.99, rank: -5 };
    const near = { ...record, id: "near", rank: -5 };

    const hits = rankDirectoryRows([far, near], { lat: 51.05, lon: 13.74 }, 5);

    expect(hits.map((h) => h.id)).toEqual(["near", "far"]);
  });

  it("keeps text relevance first without a map position", () => {
    const strong = { ...record, id: "strong", rank: -9 };
    const weak = { ...record, id: "weak", rank: -2 };

    expect(rankDirectoryRows([weak, strong], undefined, 5)[0].id).toBe(
      "strong",
    );
  });
});

it("labels a record like the OSM suggestions", () => {
  expect(directoryLabel(record)).toBe(
    "Autohaus Muster, Ringweg 3, 01067 Dresden",
  );
  expect(directoryLabel({ ...record, street: null, postcode: null })).toBe(
    "Autohaus Muster, Dresden",
  );
});

describe("storage and status", () => {
  it("replaces the directory, rebuilds the index and records the release", () => {
    const status = storeDealerDirectory(
      { release: "2026-09-23.1", records: [record] },
      "2026-10-04T10:00:00.000Z",
    );

    expect(status).toEqual({
      release: "2026-09-23.1",
      retrievedAt: "2026-10-04T10:00:00.000Z",
      count: 1,
    });
    const sql = (mocks.db.prepare.mock.calls as unknown as string[][]).map(
      ([q]) => q,
    );
    expect(sql.some((q) => q.startsWith("DELETE FROM dealer_directory"))).toBe(
      true,
    );
    expect(sql.some((q) => q.includes("'rebuild'"))).toBe(true);
    expect(mocks.db.transaction).toHaveBeenCalledTimes(1);
  });

  it("reads the stored status and ignores a corrupt one", () => {
    mocks.statement.get.mockReturnValueOnce({
      value: JSON.stringify({ release: "r", retrievedAt: "t", count: 3 }),
    });
    expect(dealerDirectoryStatus()).toEqual({
      release: "r",
      retrievedAt: "t",
      count: 3,
    });

    mocks.statement.get.mockReturnValueOnce({ value: "{oops" });
    expect(dealerDirectoryStatus()).toBeNull();
  });

  it("returns no hits instead of throwing when the query fails", () => {
    mocks.statement.all.mockImplementationOnce(() => {
      throw new Error("no such table");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(searchDealerDirectory("Autohaus")).toEqual([]);
  });
});
