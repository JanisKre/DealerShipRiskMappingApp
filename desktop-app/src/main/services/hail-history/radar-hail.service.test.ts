import { describe, expect, it } from "vitest";
import {
  cellHailClass,
  distanceToCellKm,
  hailDaysAt,
  konradFileTime,
  parseKonradHailCells,
  parseKonradListing,
  type StoredHailCell,
} from "./radar-hail.service";

/** One KONRAD3D cell as DWD writes it (fields trimmed to what is read). */
function feature({
  time = "2026-07-04T15:05:00Z",
  hailFlag = 1,
  rainHail = 0,
  hail = 0,
  largeHail = 0,
  maxDbz = 61.5,
  lats = "50.010 50.010 50.030 50.030",
  lons = "8.000 8.030 8.030 8.000",
} = {}): string {
  return `<feature identifier="7" type="3D_reflectivity_feature">
    <metadata><reference_time format="ISO 8601">${time}</reference_time></metadata>
    <geometry><polygons_projected><geodetic_coordinates>
      <polygon no="0" unit="degrees"><latitudes>${lats}</latitudes><longitudes>${lons}</longitudes></polygon>
    </geodetic_coordinates></polygons_projected></geometry>
    <intensity><max_value unit="dBZ">${maxDbz}</max_value><hail_flag>${hailFlag}</hail_flag></intensity>
    <hymec>
      <echo_top_hail unit="m">-1000000000</echo_top_hail>
      <area_rain_hail unit="km^2">${rainHail}</area_rain_hail>
      <area_hail unit="km^2">${hail}</area_hail>
      <area_large_hail unit="km^2">${largeHail}</area_large_hail>
    </hymec>
  </feature>`;
}

function file(...features: string[]): string {
  return `<?xml version="1.0" ?><konrad3d><head></head><cells reference_time="2026-07-04T15:05:00Z">${features.join("")}</cells></konrad3d>`;
}

describe("KONRAD3D listing", () => {
  it("lists each file once, oldest first, with its UTC time", () => {
    const html = `<a href="KONRAD3D_20260704T151000.xml">KONRAD3D_20260704T151000.xml</a>
      <a href="KONRAD3D_20260704T150500.xml">KONRAD3D_20260704T150500.xml</a>`;
    expect(parseKonradListing(html)).toEqual([
      "KONRAD3D_20260704T150500.xml",
      "KONRAD3D_20260704T151000.xml",
    ]);
    expect(konradFileTime("KONRAD3D_20260704T150500.xml")).toEqual({
      day: "20260704",
      iso: "2026-07-04T15:05:00Z",
    });
    expect(konradFileTime("index.html")).toBeNull();
  });
});

describe("hail classes", () => {
  it("reads large hail, hail and a flagged rain–hail mixture; skips the rest", () => {
    expect(cellHailClass(feature({ largeHail: 1.5, hail: 3 }))).toBe("large");
    expect(cellHailClass(feature({ hail: 2 }))).toBe("hail");
    expect(cellHailClass(feature({ rainHail: 1 }))).toBe("mixed");
    // A mixture without the cell's hail flag, and a cell without hail.
    expect(cellHailClass(feature({ rainHail: 1, hailFlag: 0 }))).toBeNull();
    expect(cellHailClass(feature())).toBeNull();
  });

  it("keeps only hail cells, with time, class, reflectivity and outline", () => {
    const cells = parseKonradHailCells(
      file(feature({ hail: 2 }), feature({ hailFlag: 0 })),
    );
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({
      t: "2026-07-04T15:05:00.000Z",
      c: "hail",
      d: 61.5,
      b: [8, 50.01, 8.03, 50.03],
    });
    expect(cells[0].r[0].slice(0, 4)).toEqual([8, 50.01, 8.03, 50.01]);
  });

  it("reads nothing from a file without cells", () => {
    expect(parseKonradHailCells("<konrad3d><cells/></konrad3d>")).toEqual([]);
  });
});

describe("hail days at a location", () => {
  const cell = (t: string, c: StoredHailCell["c"], d = 60): StoredHailCell => ({
    t,
    c,
    d,
    b: [8, 50.01, 8.03, 50.03],
    r: [[8, 50.01, 8.03, 50.01, 8.03, 50.03, 8, 50.03]],
  });

  it("measures 0 inside a cell and the distance to its edge outside", () => {
    const c = cell("2026-07-04T15:05:00.000Z", "hail");
    expect(distanceToCellKm(50.02, 8.015, c)).toBe(0);
    // 0.005° of latitude south of the cell: about 0.56 km.
    expect(distanceToCellKm(50.005, 8.015, c)).toBeCloseTo(0.56, 1);
  });

  it("groups the steps of a day, keeps its worst class, and leaves far cells out", () => {
    const days = hailDaysAt(50.02, 8.015, [
      cell("2026-07-04T15:05:00.000Z", "mixed", 55),
      cell("2026-07-04T15:10:00.000Z", "large", 64),
      cell("2026-06-01T12:00:00.000Z", "hail"),
      {
        ...cell("2026-06-02T12:00:00.000Z", "large"),
        b: [9, 51, 9.03, 51.02],
        r: [[9, 51, 9.03, 51, 9.03, 51.02, 9, 51.02]],
      },
    ]);
    expect(days.map((d) => d.date)).toEqual(["2026-07-04", "2026-06-01"]);
    expect(days[0]).toMatchObject({
      hailClass: "large",
      firstAt: "2026-07-04T15:05:00.000Z",
      lastAt: "2026-07-04T15:10:00.000Z",
      distanceKm: 0,
      maxDbz: 64,
      steps: 2,
    });
  });
});
