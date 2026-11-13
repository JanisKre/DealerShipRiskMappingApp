import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  hailHistoryEvidence,
  nearestStations,
  parseArchiveListing,
  parseHailObservations,
  parseStationList,
  summarizeHail,
} from "./hail-history.service";
import { readZipEntries, ZIP_MAX_ENTRY_BYTES } from "../zip";

const STATIONS = [
  "Stations_id von_datum bis_datum Stationshoehe geoBreite geoLaenge Stationsname Bundesland Abgabe",
  "----------- --------- --------- ------------- --------- --------- ----------------------------------------- ---------- ------",
  "00001 19490101 19860630            478     47.8413    8.8493 Aach                                     Baden-Württemberg                        Frei",
  "01048 19340101 20111231            227     51.1278   13.7543 Dresden-Klotzsche                        Sachsen                                  Frei",
  "01050 20050101 20101231            246     51.0000   13.8000 Dresden-Kurz                             Sachsen                                  Frei",
  "",
].join("\n");

/** Builds a ZIP archive with one deflated entry per file. */
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, "latin1");
    const compressed = deflateRawSync(data);
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, compressed);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + compressed.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, eocd]);
}

function product(rows: Array<[string, number]>): string {
  return [
    "STATIONS_ID;MESS_DATUM;QN_4;NEBEL;GEWITTER;STURM_6;STURM_8; TAU;GLATTEIS;REIF;GRAUPEL;HAGEL;eor",
    ...rows.map(
      ([date, hail]) =>
        `       1048;${date};   10;   0;   0;   0;   0;-999;-999;-999;   0;${String(hail).padStart(4)};eor`,
    ),
  ].join("\n");
}

/** Every day of `year` with hail on the given dates. */
function year(y: number, hailDates: string[] = []): Array<[string, number]> {
  const rows: Array<[string, number]> = [];
  for (
    let d = new Date(Date.UTC(y, 0, 1));
    d.getUTCFullYear() === y;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    const date = d.toISOString().slice(0, 10).replace(/-/g, "");
    rows.push([date, hailDates.includes(date) ? 1 : 0]);
  }
  return rows;
}

describe("DWD station list", () => {
  it("parses ids, periods, coordinates, names and states", () => {
    const stations = parseStationList(STATIONS);
    expect(stations).toHaveLength(3);
    expect(stations[1]).toEqual({
      id: "01048",
      from: "19340101",
      to: "20111231",
      lat: 51.1278,
      lon: 13.7543,
      name: "Dresden-Klotzsche",
      state: "Sachsen",
    });
  });

  it("returns nothing for an unexpected file", () => {
    expect(parseStationList("<html>not found</html>")).toEqual([]);
  });

  it("keeps stations within the radius with a long enough record, nearest first", () => {
    const near = nearestStations(parseStationList(STATIONS), 51.05, 13.74);
    // Dresden-Kurz is closer but has only six years of records.
    expect(near.map((s) => s.id)).toEqual(["01048"]);
    expect(near[0].distanceKm).toBeGreaterThan(8);
    expect(near[0].distanceKm).toBeLessThan(10);
  });
});

describe("DWD archive listing", () => {
  const html = `<a href="wetter_tageswerte_01048_19340101_20111231_hist.zip">x</a>
<a href="wetter_tageswerte_00001_19490101_19860630_hist.zip">y</a>
<a href="wetter_tageswerte_00403_akt.zip">z</a>`;
  it("maps station ids to historical and recent files", () => {
    expect(parseArchiveListing(html, "historical").get("01048")).toBe(
      "wetter_tageswerte_01048_19340101_20111231_hist.zip",
    );
    expect(parseArchiveListing(html, "historical").size).toBe(2);
    expect([...parseArchiveListing(html, "recent").keys()]).toEqual(["00403"]);
  });
});

describe("hail observations", () => {
  it("reads the HAGEL column and drops missing values", () => {
    const text = product([
      ["20100701", 1],
      ["20100702", 0],
      ["20100703", -999],
    ]);
    const values = parseHailObservations(text);
    expect([...values.entries()]).toEqual([
      ["20100701", 1],
      ["20100702", 0],
    ]);
  });

  it("summarizes observed years only, with the latest hail dates first", () => {
    const observations = parseHailObservations(
      product([
        ...year(2008, ["20080612"]),
        ...year(2009, ["20090703", "20090704"]),
        // Only ten valid days in 2010: not an observed year.
        ...year(2010, ["20100101"]).slice(0, 10),
      ]),
    );
    const summary = summarizeHail(observations);
    expect(summary).toMatchObject({
      firstYear: 2008,
      lastYear: 2009,
      yearsObserved: 2,
      hailDays: 3,
      hailDaysPerYear: 1.5,
      recentHailDates: ["2009-07-04", "2009-07-03", "2008-06-12"],
      hailDaysByYear: [
        { year: 2008, days: 1 },
        { year: 2009, days: 2 },
      ],
      hailDates: ["2008-06-12", "2009-07-03", "2009-07-04"],
    });
  });

  it("returns null without an observed year", () => {
    expect(summarizeHail(new Map([["20100101", 1]]))).toBeNull();
  });

  it("states that the history stays out of the EAL", () => {
    const evidence = hailHistoryEvidence();
    expect(evidence.source).toContain("DWD");
    expect(evidence.limitations.join(" ")).toMatch(/not used in the hail EAL/);
  });
});

describe("ZIP reader", () => {
  it("extracts deflated entries", () => {
    const archive = zip({
      "Metadaten_Geographie_01048.txt": "meta",
      "produkt_wetter_tag_19340101_20111231_01048.txt": product([
        ["20100701", 1],
      ]),
    });
    const entries = readZipEntries(archive);
    expect(entries.map((e) => e.name)).toEqual([
      "Metadaten_Geographie_01048.txt",
      "produkt_wetter_tag_19340101_20111231_01048.txt",
    ]);
    expect(entries[0].read().toString()).toBe("meta");
    expect(
      parseHailObservations(entries[1].read().toString("latin1")).get(
        "20100701",
      ),
    ).toBe(1);
  });

  it("rejects data that is not a ZIP archive", () => {
    expect(() =>
      readZipEntries(Buffer.from("not a zip file at all, sorry")),
    ).toThrow(/Not a ZIP/);
  });

  it("refuses entries above the size cap", () => {
    const archive = zip({ "a.txt": "x" });
    // Patch the declared size in the central directory.
    const central = archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    archive.writeUInt32LE(ZIP_MAX_ENTRY_BYTES + 1, central + 24);
    expect(() => readZipEntries(archive)[0].read()).toThrow(/too large/);
  });
});
