import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  coresOfDayArchive,
  coresOfGrid,
  dayEvent,
  dbzOf,
  gridToLonLat,
  lonLatToGrid,
  monthTarUrl,
  parseYw,
  TarStreamReader,
  validRadklimDay,
  ywFileTime,
} from "./radklim.service";
import { linkTracks } from "./hail-events.service";

const NROWS = 1100;
const NCOLS = 900;

/** A YW file: header, ETX, 1100 × 900 little-endian values (0.01 mm). */
function ywFile(set: (row: number, col: number) => number | null): Buffer {
  const header = Buffer.from(
    "YW281530100000713BY1980164VS 3SW   2.18.3PR E-02INT   5U0GP1100x 900MF 00000000VR2017.002MS 10<boo>",
    "latin1",
  );
  const body = Buffer.alloc(NROWS * NCOLS * 2);
  for (let r = 0; r < NROWS; r++)
    for (let c = 0; c < NCOLS; c++) {
      const mm = set(r, c);
      body.writeUInt16LE(
        mm == null ? 0x2000 | 2500 : Math.round(mm * 100),
        (r * NCOLS + c) * 2,
      );
    }
  return Buffer.concat([header, Buffer.from([3]), body]);
}

/** A ustar archive of the given files (512-byte headers, padded data). */
function tar(files: Array<[string, Buffer]>): Buffer {
  const parts: Buffer[] = [];
  for (const [name, data] of files) {
    const h = Buffer.alloc(512);
    h.write(name, 0, "ascii");
    h.write(data.length.toString(8).padStart(11, "0") + "\0", 124, "ascii");
    h.write("0", 156, "ascii");
    h.write("ustar", 257, "ascii");
    parts.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

describe("RADKLIM grid", () => {
  it("puts 9° E 51° N at column 370, row 550 and round-trips", () => {
    const [col, row] = lonLatToGrid(9, 51);
    expect(col).toBeCloseTo(370, 6);
    expect(row).toBeCloseTo(550, 6);
    const [lon, lat] = gridToLonLat(381.5, 254.5);
    // Reutlingen lies in that pixel.
    expect(lon).toBeCloseTo(9.21, 1);
    expect(lat).toBeCloseTo(48.49, 1);
    const back = lonLatToGrid(lon, lat);
    expect(back[0]).toBeCloseTo(381.5, 6);
    expect(back[1]).toBeCloseTo(254.5, 6);
  });

  it("reads file times, days and URLs", () => {
    expect(ywFileTime("raa01-yw2017.002_10000-1307281530-dwd---bin")).toBe(
      Date.UTC(2013, 6, 28, 15, 30),
    );
    expect(ywFileTime("readme.txt")).toBeNull();
    expect(monthTarUrl("2013-07-28")).toMatch(
      /\/2013\/YW2017\.002_201307\.tar$/,
    );
    const now = Date.UTC(2026, 10, 14);
    expect(validRadklimDay("2013-07-28", now)).toBe(true);
    expect(validRadklimDay("2000-12-31", now)).toBe(false);
    expect(validRadklimDay("2013-02-30", now)).toBe(false);
    expect(validRadklimDay("2026-11-14", now)).toBe(false);
    expect(dbzOf(6)).toBeCloseTo(52.7, 1);
  });
});

describe("RADKLIM cores", () => {
  // A 3 × 3 core of 10 mm with a 15 mm centre near Reutlingen, a single
  // noisy pixel, and a no-data corner.
  const file = ywFile((r, c) => {
    if (r < 5 && c < 5) return null;
    if (r >= 253 && r <= 255 && c >= 380 && c <= 382)
      return r === 254 && c === 381 ? 15 : 10;
    if (r === 600 && c === 600) return 30;
    return 0.5;
  });

  it("parses values and no-data", () => {
    const grid = parseYw(file)!;
    expect(grid[254 * NCOLS + 381]).toBeCloseTo(15, 5);
    expect(Number.isNaN(grid[0])).toBe(true);
    expect(parseYw(Buffer.from("not a radolan file"))).toBeNull();
  });

  it("finds a core with its class and outline, and drops single pixels", () => {
    const cores = coresOfGrid(parseYw(file)!, 0);
    expect(cores).toHaveLength(1);
    expect(cores[0].c).toBe("large");
    expect(cores[0].lon).toBeCloseTo(9.21, 1);
    expect(cores[0].lat).toBeCloseTo(48.49, 1);
    // The outline is the 3 × 3 km square of the pixels.
    expect(cores[0].r[0].length).toBe(8);
  });

  it("streams a day archive and links steps into a track", async () => {
    const moved = (shift: number): Buffer =>
      ywFile((r, c) =>
        r >= 253 && r <= 255 && c >= 380 + shift && c <= 382 + shift ? 10 : 0,
      );
    const dayTar = tar([
      ["raa01-yw2017.002_10000-1307281500-dwd---bin", moved(0)],
      ["raa01-yw2017.002_10000-1307281505-dwd---bin", moved(3)],
    ]);
    const cores = await coresOfDayArchive(gzipSync(dayTar));
    expect(cores.map((c) => c.t)).toEqual([
      Date.UTC(2013, 6, 28, 15, 0),
      Date.UTC(2013, 6, 28, 15, 5),
    ]);
    const event = dayEvent("2013-07-28", cores, linkTracks);
    expect(event.summary).toMatchObject({
      id: "radklim-20130728",
      source: "radklim",
      tracks: 1,
      cells: 2,
      maxClass: "hail",
    });
    expect(event.cells.map((c) => c.track)).toEqual([0, 0]);
  });

  it("reads tar entries split across chunks and skips pax headers", () => {
    const seen: string[] = [];
    const reader = new TarStreamReader((name, data) =>
      seen.push(`${name}:${data.length}`),
    );
    const archive = tar([["a.bin", Buffer.alloc(700, 1)]]);
    const pax = Buffer.from(archive);
    pax.write("x", 156, "ascii");
    const both = Buffer.concat([pax.subarray(0, 1536), archive]);
    for (let i = 0; i < both.length; i += 100)
      reader.push(both.subarray(i, i + 100));
    expect(seen).toEqual(["a.bin:700"]);
  });
});
