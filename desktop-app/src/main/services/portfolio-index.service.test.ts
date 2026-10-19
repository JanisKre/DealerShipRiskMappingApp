import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const fingerprint = { get: vi.fn() };
  const rows = { all: vi.fn() };
  const db = {
    prepare: vi.fn((sql: string) =>
      sql.includes("count(*)") ? fingerprint : rows,
    ),
  };
  return { fingerprint, rows, db };
});
vi.mock("../db/database", () => ({ getDb: () => mocks.db }));

import {
  matchPortfolio,
  noteExcerpt,
  portfolioEntries,
  portfolioEntriesOf,
  type PortfolioEntry,
} from "./portfolio-index.service";

const session = { id: "s1", name: "Sachsen" };
const dealership = {
  id: "d1",
  name: "Autohaus Muster",
  lat: 51.05,
  lon: 13.74,
  notes: "Dach 2025 erneuert",
};

beforeEach(() => vi.clearAllMocks());

describe("portfolioEntriesOf", () => {
  it("reads both the envelope and the old bare-array format", () => {
    const expected: PortfolioEntry[] = [
      {
        sessionId: "s1",
        sessionName: "Sachsen",
        dealershipId: "d1",
        name: "Autohaus Muster",
        lat: 51.05,
        lon: 13.74,
        notes: "Dach 2025 erneuert",
      },
    ];
    expect(
      portfolioEntriesOf(
        session,
        JSON.stringify({ dealerships: [dealership] }),
      ),
    ).toEqual(expected);
    expect(portfolioEntriesOf(session, JSON.stringify([dealership]))).toEqual(
      expected,
    );
  });

  it("skips locations without coordinates and corrupt data", () => {
    expect(
      portfolioEntriesOf(
        session,
        JSON.stringify([{ id: "x", name: "No pos" }]),
      ),
    ).toEqual([]);
    expect(portfolioEntriesOf(session, "{oops")).toEqual([]);
  });
});

describe("portfolioEntries", () => {
  it("re-reads the sessions only when they changed", () => {
    mocks.rows.all.mockReturnValue([
      { ...session, data: JSON.stringify([dealership]) },
    ]);
    mocks.fingerprint.get.mockReturnValue({ n: 1, t: "2026-10-01" });

    expect(portfolioEntries()).toHaveLength(1);
    expect(portfolioEntries()).toHaveLength(1);
    expect(mocks.rows.all).toHaveBeenCalledTimes(1);

    mocks.fingerprint.get.mockReturnValue({ n: 1, t: "2026-10-02" });
    portfolioEntries();
    expect(mocks.rows.all).toHaveBeenCalledTimes(2);
  });
});

describe("matchPortfolio", () => {
  const entries = portfolioEntriesOf(session, JSON.stringify([dealership]));

  it("matches the same spot whatever the name", () => {
    expect(
      matchPortfolio(
        { lat: 51.0501, lon: 13.7401, name: "Hauptstr. 1" },
        entries,
      ),
    ).toHaveLength(1);
  });

  it("matches a similar name a building away, not a different business", () => {
    expect(
      matchPortfolio(
        { lat: 51.0508, lon: 13.7408, name: "Muster Automobile" },
        entries,
      )[0],
    ).toEqual({
      sessionId: "s1",
      sessionName: "Sachsen",
      dealershipId: "d1",
      name: "Autohaus Muster",
      notesExcerpt: "Dach 2025 erneuert",
    });
    expect(
      matchPortfolio(
        { lat: 51.0508, lon: 13.7408, name: "Auto Schmidt" },
        entries,
      ),
    ).toEqual([]);
  });
});

it("shortens long notes on a word-friendly single line", () => {
  const long = `${"Sehr lange Notiz ".repeat(10)}\n\nEnde`;
  const excerpt = noteExcerpt(long);
  expect(excerpt.length).toBeLessThanOrEqual(90);
  expect(excerpt.endsWith("…")).toBe(true);
  expect(excerpt).not.toContain("\n");
});
