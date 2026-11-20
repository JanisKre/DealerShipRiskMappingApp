import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type BetterSqlite3 from "better-sqlite3";
import { summarizeEvent, type HailEventCell } from "@shared/hail-events";
import type { RadarHailClass } from "@shared/radar-hail";
import { fixtureFiles, fixtureXml } from "./konrad3d.fixture";

/**
 * As-if history against a real in-memory SQLite, migrated like the app's
 * database. After `npm run rebuild` better-sqlite3 is built for Electron and
 * cannot load in Node; the database tests are skipped then (the pure parts
 * are covered in `shared/as-if-history.test.ts`).
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
vi.mock("../http.service", () => ({
  fetchWithResilience: vi.fn(async () => {
    throw new Error("offline in tests");
  }),
}));
// The station records are read over the network; the ranking gets fixed ones.
const hailDatesNearPortfolio = vi.fn();
vi.mock("./hail-history.service", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("./hail-history.service")>();
  return { ...original, hailDatesNearPortfolio };
});

const { migrateDatabase } = await import("../../db/database");
const radar = await import("./radar-hail.service");
const events = await import("./hail-events.service");
const asIf = await import("./as-if-history.service");

const DAMAGE = { large: 0.3, hail: 0.15, mixed: 0.05 };
/** Stuttgart-south, where the radar fixture's storm A starts. */
const SITE_A = { id: "a", lat: 48.4, lon: 9.0, exposureEur: 10_000_000 };
const SITE_B = { id: "b", lat: 50.0, lon: 8.0, exposureEur: 4_000_000 };
const SITES = [SITE_A, SITE_B];

/** A stored historic day with one square cell over each given point. */
function historicDay(
  day: string,
  over: Array<{ lat: number; lon: number; c: RadarHailClass }>,
): void {
  const t = Date.parse(`${day}T15:00:00Z`);
  const cells: HailEventCell[] = over.map(({ lat, lon, c }, track) => ({
    t,
    track,
    c,
    d: 55,
    p: [lon, lat],
    b: [lon - 0.02, lat - 0.02, lon + 0.02, lat + 0.02],
    r: [
      [
        lon - 0.02,
        lat - 0.02,
        lon + 0.02,
        lat - 0.02,
        lon + 0.02,
        lat + 0.02,
        lon - 0.02,
        lat + 0.02,
      ],
    ],
  }));
  events.storeEvent({
    summary: summarizeEvent(
      `radklim-${day.replaceAll("-", "")}`,
      "radklim",
      null,
      true,
      cells,
    ),
    cells,
  });
}

describe("historic day ids", () => {
  it("reads the day from a stored id", () => {
    expect(asIf.radklimDayOfId("radklim-20130728")).toBe("2013-07-28");
    expect(asIf.radklimDayOfId("import-abc")).toBeNull();
    expect(asIf.radklimDayOfId("radklim-2013")).toBeNull();
  });

  it("states what the history is not", () => {
    const text = asIf.asIfEvidence().limitations.join(" ");
    expect(text).toContain("not checked");
    expect(text).toContain("no mean annual loss");
    expect(text).toContain("not the hail EAL");
  });
});

describe.skipIf(!Sqlite)("as-if history (SQLite)", () => {
  beforeEach(() => {
    memoryDb?.close();
    memoryDb = new Sqlite!(":memory:");
    migrateDatabase(memoryDb, 0);
    radar.resetRadarHailSyncForTests();
    events.resetHailEventsForTests();
    asIf.resetAsIfHistoryForTests();
    hailDatesNearPortfolio.mockReset();
  });
  afterAll(() => memoryDb?.close());

  const request = { sites: SITES, damage: DAMAGE, radiusKm: 1 };

  it("is empty without stored days", async () => {
    const history = await asIf.asIfHistory(request);
    expect(history.days).toEqual([]);
    expect(history.years).toEqual([]);
    expect(history.totals).toEqual({
      days: 0,
      hitDays: 0,
      lossEur: 0,
      sites: 2,
      exposureEur: 14_000_000,
    });
  });

  it("applies stored historic days to the locations, per day and year", async () => {
    historicDay("2013-07-28", [{ ...SITE_A, c: "large" }]);
    historicDay("2013-06-20", [
      { ...SITE_A, c: "hail" },
      { ...SITE_B, c: "mixed" },
    ]);
    historicDay("2008-05-30", [{ lat: 53.5, lon: 10, c: "large" }]);
    historicDay("2005-08-01", []);

    const history = await asIf.asIfHistory(request);
    expect(history.days.map((d) => [d.day, d.hitCount, d.lossEur])).toEqual([
      ["2013-07-28", 1, 3_000_000],
      ["2013-06-20", 2, 1_500_000 + 200_000],
      ["2008-05-30", 0, 0],
      ["2005-08-01", 0, 0],
    ]);
    expect(history.days[0]).toMatchObject({
      eventIds: ["radklim-20130728"],
      sources: ["radklim"],
      maxClass: "large",
    });
    expect(history.years).toEqual([
      {
        year: 2005,
        days: 1,
        hitDays: 0,
        lossEur: 0,
        worstDay: null,
        worstDayLossEur: 0,
      },
      {
        year: 2008,
        days: 1,
        hitDays: 0,
        lossEur: 0,
        worstDay: null,
        worstDayLossEur: 0,
      },
      {
        year: 2013,
        days: 2,
        hitDays: 2,
        lossEur: 4_700_000,
        worstDay: "2013-07-28",
        worstDayLossEur: 3_000_000,
      },
    ]);
    expect(history.totals).toMatchObject({
      days: 4,
      hitDays: 2,
      lossEur: 4_700_000,
    });
    expect(history.evidence.limitations.length).toBeGreaterThan(0);
    expect(asIf.loadedHistoricDays()).toEqual(
      new Set(["2013-07-28", "2013-06-20", "2008-05-30", "2005-08-01"]),
    );
  });

  it("includes the radar archive and counts a location once per day", async () => {
    for (const [name, cells] of fixtureFiles())
      radar.storeKonradFile(
        name,
        radar.parseKonradHailCells(fixtureXml(cells)),
      );
    // The same day also as a historic day, with a worse class over site A.
    historicDay("2026-07-04", [{ ...SITE_A, c: "hail" }]);

    const history = await asIf.asIfHistory(request);
    expect(history.days.map((d) => d.day)).toEqual([
      "2026-07-11",
      "2026-07-04",
    ]);
    const day = history.days[1];
    expect(day.eventIds).toEqual(["radar-20260704T1500", "radklim-20260704"]);
    expect(day.sources).toEqual(["radar", "radklim"]);
    // Radar: mixture over A. Historic day: hail. One loss, the worse class.
    expect(day.hits).toEqual([
      {
        id: "a",
        hailClass: "hail",
        exposureEur: 10_000_000,
        lossEur: 1_500_000,
      },
    ]);
    // Storm C near Munich reaches neither location.
    expect(history.days[0]).toMatchObject({ hitCount: 0, sources: ["radar"] });
  });

  it("leaves out saved scenarios and footprints without a time", async () => {
    const t = Date.parse("2020-06-01T12:00:00Z");
    const cell: HailEventCell = {
      t,
      track: 0,
      c: "large",
      d: 60,
      p: [SITE_A.lon, SITE_A.lat],
      b: [8.9, 48.3, 9.1, 48.5],
      r: [[8.9, 48.3, 9.1, 48.3, 9.1, 48.5, 8.9, 48.5]],
    };
    events.saveScenario("Stress", "simulation", [cell]);
    const footprint = (time?: string): string =>
      JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { class: "large", ...(time ? { time } : {}) },
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [8.9, 48.3],
                  [9.1, 48.3],
                  [9.1, 48.5],
                  [8.9, 48.5],
                  [8.9, 48.3],
                ],
              ],
            },
          },
        ],
      });
    events.importFootprint(footprint(), "static");
    expect((await asIf.asIfHistory(request)).days).toEqual([]);

    events.importFootprint(footprint("2019-06-10T16:00:00Z"), "timed");
    const history = await asIf.asIfHistory(request);
    expect(history.days.map((d) => [d.day, d.sources, d.lossEur])).toEqual([
      ["2019-06-10", ["import"], 3_000_000],
    ]);
  });

  it("follows the parameters, the locations and deleted days", async () => {
    historicDay("2013-07-28", [{ ...SITE_A, c: "large" }]);
    const first = await asIf.asIfHistory(request);
    expect(first.totals.lossEur).toBe(3_000_000);
    // Same locations, other damage rate: the cached hits are priced anew.
    const harsher = await asIf.asIfHistory({
      ...request,
      damage: { ...DAMAGE, large: 0.5 },
    });
    expect(harsher.totals.lossEur).toBe(5_000_000);
    // Another set of locations.
    const moved = await asIf.asIfHistory({
      ...request,
      sites: [{ ...SITE_A, lat: 49.5 }],
    });
    expect(moved.totals).toMatchObject({ days: 1, hitDays: 0, lossEur: 0 });
    // A location just outside the cell is reached with a wider reach only.
    const beside = [{ ...SITE_A, lon: SITE_A.lon + 0.05 }];
    expect(
      (await asIf.asIfHistory({ ...request, sites: beside })).totals.hitDays,
    ).toBe(0);
    expect(
      (await asIf.asIfHistory({ ...request, sites: beside, radiusKm: 5 }))
        .totals.hitDays,
    ).toBe(1);

    events.deleteImportedEvent("radklim-20130728");
    expect((await asIf.asIfHistory(request)).days).toEqual([]);
  });

  it("proposes days from the station records and marks loaded ones", async () => {
    historicDay("2008-05-30", []);
    hailDatesNearPortfolio.mockResolvedValue({
      assignments: [{ stationId: "01048", exposureEur: 10_000_000 }],
      datesByStation: new Map([
        ["01048", ["1999-07-01", "2008-05-30", "2010-07-12", "2026-11-20"]],
      ]),
      stationsUsed: 1,
      sitesCovered: 1,
      firstYear: 2001,
      lastYear: 2011,
    });
    const result = await asIf.suggestHistoricDays(
      SITES,
      Date.parse("2026-11-20T08:00:00Z"),
    );
    expect(hailDatesNearPortfolio).toHaveBeenCalledWith(SITES, 2001);
    // Before 2001 there is no RADKLIM day; today is not over yet.
    expect(result.days.map((d) => [d.day, d.loaded])).toEqual([
      ["2010-07-12", false],
      ["2008-05-30", true],
    ]);
    expect(result).toMatchObject({
      stationsUsed: 1,
      sitesCovered: 1,
      sitesTotal: 2,
      firstYear: 2001,
      lastYear: 2011,
    });
    expect(result.evidence.limitations.join(" ")).toContain("2011");
  });
});
