import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoundaryResult, Session } from "@shared/types";

/** In-memory stand-in for the sessions table (one row per id). */
const rows = new Map<string, Record<string, string>>();

vi.mock("../db/database", () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      run: (row: Record<string, string>) => {
        if (sql.startsWith("INSERT")) rows.set(row.id, row);
      },
      get: (id: string) => {
        const row = rows.get(id);
        return row
          ? {
              id: row.id,
              name: row.name,
              created_at: row.createdAt,
              updated_at: row.updatedAt,
              data: row.data,
            }
          : undefined;
      },
    }),
  }),
}));

const { loadSession, saveSession, validBoundaryEdits } =
  await import("./sessions.repo");

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

beforeEach(() => rows.clear());

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
    expect(JSON.parse(rows.get("s1")!.data)).not.toHaveProperty(
      "boundaryEdits",
    );
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
