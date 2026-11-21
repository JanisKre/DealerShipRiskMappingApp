import type BetterSqlite3 from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AnalyzedDealership,
  BoundaryResult,
  Session,
} from "@shared/types";

/** The repository runs against a real, migrated in-memory database. */
let memoryDb: BetterSqlite3.Database | null = null;
vi.mock("../db/database", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/database")>()),
  getDb: () => memoryDb,
}));

const { default: Database } = await import("better-sqlite3");
const { migrateDatabase } = await import("../db/database");

function storedData(id: string): Record<string, unknown> {
  const row = memoryDb!
    .prepare("SELECT data FROM sessions WHERE id = ?")
    .get(id) as { data: string };
  return JSON.parse(row.data) as Record<string, unknown>;
}

const {
  deleteSession,
  listSessions,
  loadSession,
  saveSession,
  saveSessionChanges,
  validBoundaryEdits,
  validPendingAnalysis,
} = await import("./sessions.repo");

const boundary = (areaSqm: number): BoundaryResult => ({
  source: "manual",
  polygon: {
    type: "Polygon",
    coordinates: [
      [
        [7, 51],
        [7.001, 51],
        [7.001, 51.001],
        [7, 51],
      ],
    ],
  },
  areaSqm,
  confidence: 1,
});

const session = (extra: Partial<Session> = {}): Session => ({
  id: "s1",
  name: "Portfolio",
  createdAt: "2026-11-13T00:00:00.000Z",
  updatedAt: "2026-11-13T00:00:00.000Z",
  dealerships: [{ id: "one", name: "First", lat: 51, lon: 7 }],
  ...extra,
});

beforeEach(() => {
  memoryDb?.close();
  memoryDb = new Database(":memory:");
  memoryDb.pragma("foreign_keys = ON");
  migrateDatabase(memoryDb, 0);
});

describe("boundary edits in a saved session", () => {
  it("keeps undo steps and the unsaved flag across save and load", () => {
    saveSession(
      session({
        boundaryEdits: {
          one: { history: [boundary(100), boundary(200)], unsaved: true },
        },
      }),
    );
    const loaded = loadSession("s1");
    expect(loaded?.boundaryEdits?.one.unsaved).toBe(true);
    expect(loaded?.boundaryEdits?.one.history.map((b) => b.areaSqm)).toEqual([
      100, 200,
    ]);
  });

  it("stores nothing extra when there are no edits", () => {
    saveSession(session());
    expect(storedData("s1")).not.toHaveProperty("boundaryEdits");
    expect(loadSession("s1")).not.toHaveProperty("boundaryEdits");
  });

  it("drops an entry that no longer parses instead of failing the load", () => {
    expect(
      validBoundaryEdits({
        one: { history: [boundary(100)], unsaved: false },
        two: { history: "broken" },
      }),
    ).toEqual({ one: { history: [boundary(100)], unsaved: false } });
    expect(validBoundaryEdits(null)).toEqual({});
  });
});

describe("an analysis cut short", () => {
  const queued = [
    { id: "two", name: "Second", lat: 52, lon: 8 },
    { id: "three", name: "Third", address: "Hauptstr. 1, Köln" },
  ];

  it("keeps the inputs still to analyse across save and load", () => {
    saveSession(session({ pendingAnalysis: queued }));
    expect(loadSession("s1")?.pendingAnalysis).toEqual(queued);
  });

  it("stores no queue when nothing is pending", () => {
    saveSession(session({ pendingAnalysis: [] }));
    expect(storedData("s1")).not.toHaveProperty("pendingAnalysis");
    expect(loadSession("s1")).not.toHaveProperty("pendingAnalysis");
  });

  it("drops an entry that no longer parses", () => {
    expect(validPendingAnalysis([queued[0], { name: 42 }])).toEqual([
      queued[0],
    ]);
    expect(validPendingAnalysis("broken")).toEqual([]);
  });
});

describe("damaged session rows", () => {
  it("returns null instead of throwing for a row holding JSON null", () => {
    memoryDb!
      .prepare(
        "INSERT INTO sessions (id, name, created_at, updated_at, data) VALUES (?, ?, ?, ?, ?)",
      )
      .run("broken", "Broken", "2026-01-01", "2026-01-01", "null");
    expect(loadSession("broken")).toBeNull();
  });
});

describe("saved states (UW-09)", () => {
  it("keeps the snapshot flag through save, load and list", () => {
    saveSession(session());
    saveSession(session({ id: "snap", name: "P – Stand", snapshotOf: "s1" }));
    expect(loadSession("snap")?.snapshotOf).toBe("s1");
    expect(loadSession("s1")?.snapshotOf).toBeUndefined();
    const list = listSessions();
    expect(list.find((s) => s.id === "snap")?.snapshotOf).toBe("s1");
    expect(list.find((s) => s.id === "s1")).not.toHaveProperty("snapshotOf");
  });

  it("keeps why queued inputs failed", () => {
    saveSession(
      session({
        id: "failed",
        pendingAnalysis: [{ id: "row-1", name: "Autohaus Nirgendwo" }],
        pendingErrors: { "row-1": "Address could not be resolved" },
      }),
    );
    expect(loadSession("failed")?.pendingErrors).toEqual({
      "row-1": "Address could not be resolved",
    });
  });

  it("keeps the parameter revision a session was saved under", () => {
    saveSession(session({ id: "rev", parametersRevision: 1 }));
    saveSession(session({ id: "old" }));
    expect(loadSession("rev")?.parametersRevision).toBe(1);
    expect(loadSession("old")?.parametersRevision).toBeUndefined();
  });
});

describe("one row per location", () => {
  const site = (
    id: string,
    extra: Partial<AnalyzedDealership> = {},
  ): AnalyzedDealership => ({
    id,
    name: `Site ${id}`,
    lat: 51,
    lon: 7,
    ...extra,
  });
  const siteRows = (): Array<{ site_id: string; data: string }> =>
    memoryDb!
      .prepare(
        "SELECT site_id, data FROM session_sites WHERE session_id = 's1' ORDER BY site_id",
      )
      .all() as Array<{ site_id: string; data: string }>;
  const meta = (s: Session): Omit<Session, "dealerships"> => {
    const { dealerships: _sites, ...rest } = s;
    return rest;
  };

  it("stores locations as rows and keeps their order", () => {
    saveSession(session({ dealerships: [site("b"), site("a"), site("c")] }));
    expect(siteRows().map((r) => r.site_id)).toEqual(["a", "b", "c"]);
    expect(storedData("s1")).toMatchObject({ order: ["b", "a", "c"] });
    expect(storedData("s1")).not.toHaveProperty("dealerships");
    expect(loadSession("s1")?.dealerships.map((d) => d.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("removes rows of deleted locations and of a deleted portfolio", () => {
    saveSession(session({ dealerships: [site("a"), site("b")] }));
    saveSession(session({ dealerships: [site("b")] }));
    expect(siteRows().map((r) => r.site_id)).toEqual(["b"]);
    deleteSession("s1");
    expect(siteRows()).toEqual([]);
  });

  it("does not rewrite a location that did not change", () => {
    saveSession(session({ dealerships: [site("a"), site("b")] }));
    const before = memoryDb!.prepare("SELECT total_changes() AS n").get() as {
      n: number;
    };
    saveSession(
      session({ dealerships: [site("a"), site("b", { notes: "x" })] }),
    );
    const after = memoryDb!.prepare("SELECT total_changes() AS n").get() as {
      n: number;
    };
    // The portfolio row and the one changed location.
    expect(after.n - before.n).toBe(2);
  });

  it("applies changes on top of the revision they build on", () => {
    const full = session({ dealerships: [site("a"), site("b")] });
    const { revision } = saveSession(full);
    const result = saveSessionChanges({
      session: meta(full),
      baseRevision: revision,
      order: ["c", "a"],
      upserts: [site("c"), site("a", { notes: "checked" })],
      removed: ["b"],
    });
    expect(result).toEqual({ ok: true, revision: revision + 1 });
    expect(loadSession("s1")?.dealerships).toEqual([
      site("c"),
      site("a", { notes: "checked" }),
    ]);
  });

  it("refuses changes built on an older revision or not adding up", () => {
    const full = session({ dealerships: [site("a"), site("b")] });
    const { revision } = saveSession(full);
    saveSession(full); // another save in between
    expect(
      saveSessionChanges({
        session: meta(full),
        baseRevision: revision,
        order: ["a", "b"],
        upserts: [],
        removed: [],
      }),
    ).toEqual({ ok: false });
    expect(
      saveSessionChanges({
        session: meta(full),
        baseRevision: revision + 1,
        // "b" is still stored but missing from the order.
        order: ["a"],
        upserts: [],
        removed: [],
      }),
    ).toEqual({ ok: false });
    expect(loadSession("s1")?.dealerships.map((d) => d.id)).toEqual(["a", "b"]);
  });

  it("keeps locations without unique ids inline", () => {
    saveSession(
      session({ dealerships: [site("a"), site("a", { notes: "2" })] }),
    );
    expect(siteRows()).toEqual([]);
    expect(loadSession("s1")?.dealerships).toHaveLength(2);
    expect(
      saveSessionChanges({
        session: meta(session()),
        baseRevision: 1,
        order: ["a"],
        upserts: [],
        removed: [],
      }),
    ).toEqual({ ok: false });
  });
});

describe("migration of stored portfolios", () => {
  it("moves inline locations into rows and keeps the rest", async () => {
    const db = new Database(":memory:");
    migrateDatabase(db, 0, { toVersion: 5 });
    const insert = db.prepare(
      "INSERT INTO sessions (id, name, created_at, updated_at, data) VALUES (?, ?, ?, ?, ?)",
    );
    insert.run(
      "env",
      "Envelope",
      "2026-01-01",
      "2026-01-01",
      JSON.stringify({
        dealerships: [
          { id: "x", name: "X", lat: 1, lon: 2 },
          { id: "y", name: "Y", lat: 1, lon: 2 },
        ],
        snapshotOf: "other",
      }),
    );
    insert.run(
      "old",
      "Bare array",
      "2026-01-01",
      "2026-01-01",
      JSON.stringify([{ id: "z", name: "Z", lat: 1, lon: 2 }]),
    );
    insert.run("bad", "Broken", "2026-01-01", "2026-01-01", "{oops");
    migrateDatabase(db, 5);
    memoryDb = db;

    expect(loadSession("env")?.dealerships.map((d) => d.id)).toEqual([
      "x",
      "y",
    ]);
    expect(loadSession("env")?.snapshotOf).toBe("other");
    expect(loadSession("old")?.dealerships.map((d) => d.id)).toEqual(["z"]);
    expect(storedData("env")).toEqual({
      snapshotOf: "other",
      order: ["x", "y"],
    });
    expect(loadSession("bad")).toBeNull();
  });
});
