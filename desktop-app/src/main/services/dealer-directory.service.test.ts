import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const statement = { run: vi.fn(), get: vi.fn(), all: vi.fn() };
  /** FTS search rows and full-table rows (in-memory index) by SQL. */
  const fts = { all: vi.fn() };
  const table = { all: vi.fn() };
  const db = {
    prepare: vi.fn((sql: string) => {
      if (sql.includes("dealer_directory_fts MATCH")) return fts;
      if (/^SELECT[^]*FROM dealer_directory\s*$/u.test(sql)) return table;
      return statement;
    }),
    transaction: vi.fn((fn: () => void) => fn),
  };
  return { statement, fts, table, db };
});

vi.mock("electron", () => ({ utilityProcess: { fork: vi.fn() } }));
vi.mock("../db/database", () => ({ getDb: () => mocks.db }));

import {
  checkDealerDirectoryUpdate,
  dealerDirectoryStatus,
  directoryLabel,
  directoryMatchQuery,
  invalidateDirectoryIndex,
  rankDirectoryRows,
  resolveQueryLocality,
  searchDealerDirectory,
  storeDealerDirectory,
  tokenVariants,
  UPDATE_CHECK_INTERVAL_MS,
} from "./dealer-directory.service";
import { foldedTokens } from "./place-query";

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
  mocks.fts.all.mockReturnValue([]);
  mocks.table.all.mockReturnValue([]);
  invalidateDirectoryIndex();
});

describe("directoryMatchQuery", () => {
  it("turns every word into a prefix match and drops legal forms", () => {
    expect(directoryMatchQuery(foldedTokens("Autohaus Herz GmbH"))).toBe(
      '"herz"*',
    );
    expect(directoryMatchQuery(foldedTokens("Autohaus"))).toBe('"autohaus"*');
  });

  it("strips FTS syntax characters instead of passing them through", () => {
    expect(directoryMatchQuery(foldedTokens('Auto" OR name:*'))).toBe(
      '"or"* "name"*',
    );
    expect(directoryMatchQuery(['x"y'])).toBe('"xy"*');
    expect(directoryMatchQuery(foldedTokens("  ,;  "))).toBe(null);
  });

  it("matches umlaut, ß and brand spellings the index may hold", () => {
    expect(directoryMatchQuery(foldedTokens("Müller"))).toBe(
      '("mueller"* OR "muller"*)',
    );
    expect(tokenVariants("strasse")).toContain("straße");
    expect(directoryMatchQuery(["vw"])).toBe('("vw"* OR "volkswagen"*)');
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

    expect(searchDealerDirectory({ nameTokens: ["autohaus"] })).toEqual([]);
  });
});

const dresden = [
  record,
  {
    ...record,
    id: "b",
    name: "Motorrad Kühn",
    category: "motorcycle_dealer",
    lat: 51.06,
    lon: 13.75,
  },
  { ...record, id: "c", name: "Autohaus Müller", lat: 51.04, lon: 13.73 },
];
const hamburgMueller = {
  ...record,
  id: "h",
  name: "Autohaus Müller",
  postcode: "20095",
  city: "Hamburg",
  lat: 53.55,
  lon: 9.99,
};

describe("searchDealerDirectory", () => {
  it("searches inside the named city, then anywhere", () => {
    mocks.table.all.mockReturnValue([...dresden, hamburgMueller]);
    const { locality, nameTokens } = resolveQueryLocality({
      nameTokens: foldedTokens("Autohaus Müller Dresden"),
      postcode: null,
    });
    expect(locality?.name).toBe("Dresden");
    expect(nameTokens).toEqual(["autohaus", "mueller"]);

    mocks.fts.all
      .mockReturnValueOnce([])
      .mockReturnValueOnce([{ ...hamburgMueller, rank: -5 }]);
    const hits = searchDealerDirectory({ nameTokens, locality, limit: 1 });

    expect(mocks.fts.all).toHaveBeenCalledTimes(2);
    // First call is limited to the city's bounding box.
    expect(mocks.fts.all.mock.calls[0]).toHaveLength(5);
    expect(mocks.fts.all.mock.calls[1]).toHaveLength(1);
    expect(hits.map((h) => h.id)).toEqual(["h"]);
  });

  it("lists the nearest dealers of a kind for 'Motorradhändler Dresden'", () => {
    mocks.table.all.mockReturnValue([...dresden, hamburgMueller]);
    const { locality } = resolveQueryLocality({
      nameTokens: ["dresden"],
      postcode: "01067",
    });

    const hits = searchDealerDirectory({
      nameTokens: [],
      categories: ["motorcycle_dealer"],
      locality,
    });

    expect(locality?.kind).toBe("postcode");
    expect(hits.map((h) => h.id)).toEqual(["b"]);
    expect(mocks.fts.all).not.toHaveBeenCalled();
  });

  it("fills free slots with likely typos", () => {
    mocks.table.all.mockReturnValue([...dresden, hamburgMueller]);

    const hits = searchDealerDirectory({
      nameTokens: ["autohaus", "mueler"],
      near: { lat: 51.05, lon: 13.74 },
      limit: 3,
    });

    // Both Müllers, the one near the map first; "Muster" is no typo of it.
    expect(hits.map((h) => h.id)).toEqual(["c", "h"]);
  });

  it("returns nothing for a query without a name or a place", () => {
    expect(searchDealerDirectory({ nameTokens: [] })).toEqual([]);
  });
});

describe("checkDealerDirectoryUpdate", () => {
  const status = { release: "2026-09-23.1", retrievedAt: "t", count: 3 };
  const now = new Date("2026-10-19T08:00:00.000Z");

  function stored(update?: { latestRelease: string; checkedAt: string }): void {
    mocks.statement.get.mockImplementation((key: string) => {
      if (key === "dealerDirectory") return { value: JSON.stringify(status) };
      if (key === "dealerDirectoryUpdate" && update) {
        return { value: JSON.stringify(update) };
      }
      return undefined;
    });
  }

  it("does not go online before a directory was downloaded", async () => {
    mocks.statement.get.mockReturnValue(undefined);
    const fetchLatest = vi.fn();

    expect(await checkDealerDirectoryUpdate({ now, fetchLatest })).toBeNull();
    expect(fetchLatest).not.toHaveBeenCalled();
  });

  it("asks Overture and stores the answer", async () => {
    stored();
    const fetchLatest = vi.fn(async () => "2026-10-21.0");

    const update = await checkDealerDirectoryUpdate({ now, fetchLatest });

    expect(update).toEqual({
      latestRelease: "2026-10-21.0",
      checkedAt: now.toISOString(),
      updateAvailable: true,
    });
    expect(mocks.statement.run).toHaveBeenCalledWith(
      "dealerDirectoryUpdate",
      JSON.stringify({
        latestRelease: "2026-10-21.0",
        checkedAt: now.toISOString(),
      }),
    );
  });

  it("answers from the daily cache", async () => {
    stored({
      latestRelease: "2026-09-23.1",
      checkedAt: new Date(
        now.getTime() - UPDATE_CHECK_INTERVAL_MS / 2,
      ).toISOString(),
    });
    const fetchLatest = vi.fn();

    const update = await checkDealerDirectoryUpdate({ now, fetchLatest });

    expect(fetchLatest).not.toHaveBeenCalled();
    expect(update?.updateAvailable).toBe(false);
  });

  it("keeps the last answer when offline", async () => {
    const old = {
      latestRelease: "2026-10-21.0",
      checkedAt: new Date(
        now.getTime() - 2 * UPDATE_CHECK_INTERVAL_MS,
      ).toISOString(),
    };
    stored(old);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const update = await checkDealerDirectoryUpdate({
      now,
      fetchLatest: async () => {
        throw new Error("offline");
      },
    });

    expect(update).toEqual({ ...old, updateAvailable: true });
  });
});
