import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type BetterSqlite3 from "better-sqlite3";
import {
  classDamageFromParameters,
  computeHailEventImpact,
  summarizeEvent,
} from "@shared/hail-events";
import { generateOutbreak } from "@shared/hail-sim";
import { fixtureFiles, fixtureXml } from "./konrad3d.fixture";
import type { ArchivedHailCell } from "./radar-hail.service";

/**
 * Archive and event tests against a real in-memory SQLite, migrated like
 * the app's database. After `npm run rebuild` better-sqlite3 is built for
 * Electron and cannot load in Node; the database tests are skipped then
 * (the pure parts below always run).
 */
let Sqlite: typeof BetterSqlite3 | null = null;
try {
  Sqlite = (await import("better-sqlite3")).default;
  new Sqlite(":memory:").close();
} catch {
  Sqlite = null;
}

let memoryDb: BetterSqlite3.Database | null = null;
vi.mock("../../db/database", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../db/database")>();
  return { ...original, getDb: () => memoryDb };
});
// No network: every sync fails fast and the archive is read as it is.
vi.mock("../http.service", () => ({
  fetchWithResilience: vi.fn(async () => {
    throw new Error("offline in tests");
  }),
}));

const { migrateDatabase, migrateRadarHailCache } =
  await import("../../db/database");
const radar = await import("./radar-hail.service");
const events = await import("./hail-events.service");

function freshDb(): BetterSqlite3.Database {
  const db = new Sqlite!(":memory:");
  migrateDatabase(db, 0);
  return db;
}

function loadFixture(): void {
  for (const [name, cells] of fixtureFiles()) {
    radar.storeKonradFile(name, radar.parseKonradHailCells(fixtureXml(cells)));
  }
}

const MIN = 60_000;
const DAY_A = Date.parse("2026-07-04T15:00:00Z");

describe("track linking and events (pure)", () => {
  const cell = (t: number, lat: number, lon: number): ArchivedHailCell => ({
    id: 0,
    t,
    c: "hail" as const,
    d: 60,
    lat,
    lon,
    flat: null,
    flon: null,
    b: [lon - 0.01, lat - 0.01, lon + 0.01, lat + 0.01] as [
      number,
      number,
      number,
      number,
    ],
  });

  it("links a moving cell and keeps a distant one apart", () => {
    const tracks = events.linkTracks([
      cell(0, 48, 9),
      cell(0, 49, 10),
      cell(5 * MIN, 48.03, 9.05),
      cell(5 * MIN, 49.01, 10.02),
      // One radar step missing, then the first storm again.
      cell(15 * MIN, 48.09, 9.15),
    ]);
    expect(tracks).toEqual([0, 1, 0, 1, 0]);
  });

  it("starts a new track after a gap longer than one missing step", () => {
    expect(events.linkTracks([cell(0, 48, 9), cell(20 * MIN, 48, 9)])).toEqual([
      0, 1,
    ]);
  });

  it("splits events after three hail-free hours", () => {
    expect(
      events.splitEvents([{ t: 0 }, { t: 2 * 60 * MIN }, { t: 5 * 60 * MIN }]),
    ).toEqual([
      [0, 2],
      [2, 3],
    ]);
    expect(events.splitEvents([])).toEqual([]);
  });
});

describe("footprint import (pure)", () => {
  const polygon = (
    lon: number,
    lat: number,
  ): { type: string; coordinates: number[][][] } => ({
    type: "Polygon",
    coordinates: [
      [
        [lon, lat],
        [lon + 0.1, lat],
        [lon + 0.1, lat + 0.1],
        [lon, lat + 0.1],
        [lon, lat],
      ],
    ],
  });

  it("reads timed polygons with class or hail size", () => {
    const geojson = JSON.stringify({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            time: "2013-07-28T14:00:00Z",
            track: "a",
            hail_size_cm: 5,
          },
          geometry: polygon(9, 48.5),
        },
        {
          type: "Feature",
          properties: {
            time: "2013-07-28T13:30:00Z",
            track: "a",
            class: "Hagel",
          },
          geometry: polygon(8.9, 48.4),
        },
        {
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: [9, 48] },
        },
      ],
    });
    const event = events.parseFootprintGeoJson(geojson, "Test swath");
    expect(event.summary).toMatchObject({
      source: "import",
      name: "Test swath",
      timed: true,
      cells: 2,
      tracks: 1,
      maxClass: "large",
    });
    // Sorted by time; the earlier feature is the hail one.
    expect(event.cells.map((c) => c.c)).toEqual(["hail", "large"]);
    expect(event.summary.id).toMatch(/^import-[0-9a-f]{12}$/);
  });

  it("treats a file without times as a static footprint", () => {
    const geojson = JSON.stringify({
      type: "Feature",
      properties: { class: "large" },
      geometry: polygon(9, 48),
    });
    const event = events.parseFootprintGeoJson(
      geojson,
      "Static",
      Date.UTC(2026, 0, 1),
    );
    expect(event.summary.timed).toBe(false);
    expect(event.cells[0].t).toBe(Date.UTC(2026, 0, 1));
  });

  it("rejects what it cannot use", () => {
    expect(() => events.parseFootprintGeoJson("{", "x")).toThrow(/valid JSON/);
    expect(() =>
      events.parseFootprintGeoJson('{"type":"Topology"}', "x"),
    ).toThrow(/FeatureCollection/);
    expect(() =>
      events.parseFootprintGeoJson(
        JSON.stringify({ type: "FeatureCollection", features: [] }),
        "x",
      ),
    ).toThrow(/no polygon/);
  });

  it("maps sizes and names to classes", () => {
    expect(events.importedClass({ hail_size_cm: 0.5 })).toBe("mixed");
    expect(events.importedClass({ max_hail_size_cm: "2" })).toBe("hail");
    expect(events.importedClass({ class: "Großhagel" })).toBe("large");
    expect(events.importedClass({})).toBe("hail");
  });
});

describe.skipIf(!Sqlite)("radar archive and replay (SQLite)", () => {
  beforeEach(() => {
    memoryDb?.close();
    memoryDb = freshDb();
    radar.resetRadarHailSyncForTests();
    events.resetHailEventsForTests();
  });
  afterAll(() => memoryDb?.close());

  it("stores each file once and keeps only hail cells", () => {
    loadFixture();
    const [first] = fixtureFiles();
    expect(radar.storeKonradFile(first[0], [])).toBe(false);
    const span = radar.archiveSpan();
    expect(span.from).toBe("2026-07-04T15:00:00.000Z");
    expect(span.to).toBe("2026-07-11T13:05:00.000Z");
    expect(span.steps).toBe(fixtureFiles().size);
    // 8 + 4 + 2 hail cells; the cell without hail is dropped.
    expect(radar.archivedCells()).toHaveLength(14);
  });

  it("answers a location query from the R-tree", () => {
    loadFixture();
    const near = radar.cellsNear(48.4, 9.0, 1);
    expect(near.map((c) => c.t)).toEqual(["2026-07-04T15:00:00.000Z"]);
    expect(radar.hailDaysAt(48.4, 9.0, near)[0]).toMatchObject({
      date: "2026-07-04",
      hailClass: "mixed",
    });
    expect(radar.cellsNear(52.5, 13.4, 5)).toEqual([]);
  });

  it("groups the fixture into two events with their tracks", async () => {
    loadFixture();
    const list = await events.listHailEvents();
    expect(list.synced).toBe(false);
    expect(list.events.map((e) => e.id)).toEqual([
      "radar-20260711T1300",
      "radar-20260704T1500",
    ]);
    expect(list.events[1]).toMatchObject({
      tracks: 2,
      cells: 12,
      maxClass: "large",
      start: DAY_A,
      end: DAY_A + 35 * MIN,
    });

    const detail = events.hailEventDetail("radar-20260704T1500")!;
    expect(detail.cells).toHaveLength(12);
    const tracksByLon = new Map(
      detail.cells.map((c) => [c.p[0] < 9.6, c.track]),
    );
    expect(
      new Set(detail.cells.filter((c) => c.p[0] < 9.6).map((c) => c.track))
        .size,
    ).toBe(1);
    expect(tracksByLon.get(true)).not.toBe(tracksByLon.get(false));
    expect(detail.evidence.limitations.length).toBeGreaterThan(0);
    expect(events.hailEventDetail("radar-19990101T0000")).toBeNull();
  });

  it("computes the same impact for the same event every time", () => {
    loadFixture();
    const detail = events.hailEventDetail("radar-20260704T1500")!;
    const sites = [
      { id: "on-track", lat: 48.52, lon: 9.18, exposureEur: 1_000_000 },
      { id: "ulm", lat: 48.42, lon: 9.98, exposureEur: 500_000 },
      { id: "berlin", lat: 52.5, lon: 13.4, exposureEur: 9_000_000 },
    ];
    const damage = classDamageFromParameters({
      scenarioDamageLow: 0.05,
      scenarioDamageMedium: 0.15,
      scenarioDamageHigh: 0.3,
    });
    const impact = computeHailEventImpact(detail.cells, sites, damage, 1);
    expect(impact.hits.map((h) => [h.id, h.hailClass])).toEqual([
      ["ulm", "hail"],
      ["on-track", "large"],
    ]);
    expect(impact.totalLossEur).toBe(75_000 + 300_000);
    expect(computeHailEventImpact(detail.cells, sites, damage, 1)).toEqual(
      impact,
    );
  });

  it("imports, lists and deletes a footprint", async () => {
    const geojson = JSON.stringify({
      type: "Feature",
      properties: { time: "2013-07-28T14:00:00Z" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [9, 48],
            [9.1, 48],
            [9.1, 48.1],
            [9, 48],
          ],
        ],
      },
    });
    const summary = events.importFootprint(geojson, "Swath");
    expect((await events.listHailEvents()).events.map((e) => e.id)).toEqual([
      summary.id,
    ]);
    expect(events.hailEventDetail(summary.id)?.cells).toHaveLength(1);
    expect(events.deleteImportedEvent(summary.id)).toBe(true);
    expect(events.hailEventDetail(summary.id)).toBeNull();
  });

  it("saves a generated storm once and replays it with its evidence", async () => {
    const cells = generateOutbreak({
      seed: 9,
      storms: 2,
      strength: "severe",
      heading: "sw-ne",
      t0: DAY_A,
    });
    const first = events.saveScenario("Test", "simulation", cells);
    const again = events.saveScenario("Test", "simulation", cells);
    expect(again.id).toBe(first.id);
    expect(first).toMatchObject({
      source: "simulation",
      tracks: 2,
      name: "Test",
    });
    expect((await events.listHailEvents()).events.map((e) => e.id)).toEqual([
      first.id,
    ]);
    const detail = events.hailEventDetail(first.id)!;
    expect(detail.cells).toEqual(cells);
    expect(detail.evidence.source).toMatch(/generator/);
    expect(() => events.saveScenario("Empty", "drawn", [])).toThrow();
  });

  it("reuses a historic day that was loaded before, without DWD", async () => {
    const stored = events.storeEvent({
      summary: summarizeEvent(
        "radklim-20130728",
        "radklim",
        "2013-07-28",
        true,
        [],
      ),
      cells: [],
    });
    expect(await events.loadHistoricDay("2013-07-28")).toEqual(stored);
    expect(events.hailEventDetail("radklim-20130728")?.evidence.source).toMatch(
      /RADKLIM/,
    );
    // Not stored and DWD offline: a readable error.
    await expect(events.loadHistoricDay("2013-07-27")).rejects.toThrow(
      /no data|not reachable/,
    );
  });

  it("migrates the schema-2 cache archive into the tables", () => {
    const db = new Sqlite!(":memory:");
    migrateDatabase(db, 0);
    db.prepare(
      "INSERT INTO api_cache (key, value, expires_at) VALUES (?, ?, ?)",
    ).run(
      "radarhail:v1:day:20260704",
      JSON.stringify({
        files: ["KONRAD3D_20260704T150000.xml", "KONRAD3D_20260704T150500.xml"],
        cells: [
          {
            t: "2026-07-04T15:00:00.000Z",
            c: "hail",
            d: 60,
            b: [9, 48, 9.02, 48.02],
            r: [[9, 48, 9.02, 48, 9.02, 48.02]],
          },
          { t: "not a time", c: "hail", d: 60, b: [9, 48, 9.02, 48.02], r: [] },
        ],
      }),
      Number.MAX_SAFE_INTEGER,
    );
    db.prepare(
      "INSERT INTO api_cache (key, value, expires_at) VALUES (?, ?, ?)",
    ).run("radarhail:v1:day:20260705", "{broken", 1);
    migrateRadarHailCache(db);
    memoryDb = db;
    expect(radar.archivedCells()).toHaveLength(1);
    expect(radar.archiveSpan()).toMatchObject({
      from: "2026-07-04T15:00:00.000Z",
      to: "2026-07-04T15:05:00.000Z",
      steps: 2,
    });
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM api_cache WHERE key LIKE 'radarhail:%'",
        )
        .get(),
    ).toEqual({ n: 0 });
  });

  it("prunes file names DWD no longer lists, keeping coverage", () => {
    loadFixture();
    radar.pruneFileNames(Date.parse("2026-07-20T00:00:00Z"));
    expect(
      memoryDb!.prepare("SELECT COUNT(*) AS n FROM radar_hail_files").get(),
    ).toEqual({ n: 0 });
    expect(radar.archiveSpan().steps).toBe(fixtureFiles().size);
  });
});
