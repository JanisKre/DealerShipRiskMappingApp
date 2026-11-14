/**
 * Deterministic KONRAD3D test data: a synthetic hail day in the format DWD
 * publishes (fields trimmed to what the parser reads). It is made up, not a
 * recording: KONRAD3D files are kept for 48 hours only, and the fixture must
 * not change between runs.
 *
 * Day 2026-07-04 (UTC):
 * - Storm A starts 15:00 at 48.40° N 9.00° E (south of Stuttgart) and moves
 *   north-east by 0.04° lat / 0.06° lon per 5-minute step for 8 steps,
 *   growing from a rain–hail mixture to large hail and back.
 * - Storm B, 15:10–15:25, about 60 km east near Ulm, hail.
 * - A cell without hail at 15:05, which the parser drops.
 * Day 2026-07-11: storm C, two steps of hail near Munich (a second event).
 */

export interface FixtureCell {
  time: string;
  lat: number;
  lon: number;
  /** Half the cell's width in degrees. */
  half: number;
  kind: "large" | "hail" | "mixed" | "none";
  dbz: number;
  /** Centroid forecast for +5 min. */
  next?: [number, number];
}

const STORM_A_CLASSES: FixtureCell["kind"][] = [
  "mixed",
  "hail",
  "hail",
  "large",
  "large",
  "hail",
  "hail",
  "mixed",
];

function stepTime(day: string, hour: number, minute: number): string {
  return `${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`;
}

/** All fixture cells, grouped by radar file name. */
export function fixtureFiles(): Map<string, FixtureCell[]> {
  const files = new Map<string, FixtureCell[]>();
  const add = (time: string, cell: FixtureCell): void => {
    const name = `KONRAD3D_${time.replace(/[-:]/g, "").replace("Z", "")}.xml`;
    files.set(name, [...(files.get(name) ?? []), cell]);
  };
  STORM_A_CLASSES.forEach((kind, i) => {
    const lat = 48.4 + 0.04 * i;
    const lon = 9.0 + 0.06 * i;
    const minute = 5 * i;
    const time = stepTime(
      "2026-07-04",
      15 + Math.floor(minute / 60),
      minute % 60,
    );
    add(time, {
      time,
      lat,
      lon,
      half: 0.03,
      kind,
      dbz: 55 + i,
      next: [lon + 0.06, lat + 0.04],
    });
  });
  for (let i = 0; i < 4; i++) {
    const time = stepTime("2026-07-04", 15, 10 + 5 * i);
    add(time, {
      time,
      lat: 48.4 + 0.02 * i,
      lon: 9.95 + 0.03 * i,
      half: 0.02,
      kind: "hail",
      dbz: 58,
    });
  }
  const quiet = stepTime("2026-07-04", 15, 5);
  add(quiet, {
    time: quiet,
    lat: 52.5,
    lon: 13.4,
    half: 0.02,
    kind: "none",
    dbz: 40,
  });
  for (let i = 0; i < 2; i++) {
    const time = stepTime("2026-07-11", 13, 5 * i);
    add(time, {
      time,
      lat: 48.14 + 0.03 * i,
      lon: 11.58 + 0.03 * i,
      half: 0.025,
      kind: "hail",
      dbz: 60,
    });
  }
  return new Map([...files].sort(([a], [b]) => a.localeCompare(b)));
}

function feature(cell: FixtureCell, index: number): string {
  const { lat, lon, half } = cell;
  const lats = [lat - half, lat - half, lat + half, lat + half]
    .map((v) => v.toFixed(5))
    .join(" ");
  const lons = [lon - half, lon + half, lon + half, lon - half]
    .map((v) => v.toFixed(5))
    .join(" ");
  const area = (k: FixtureCell["kind"]): string =>
    cell.kind === k ? "4.5" : "0.0";
  const forecast = cell.next
    ? `<forecast><centroid_forecasts><centroid_forecast forecast_time="+5"><geodetic_coordinate>
        <latitude unit="degrees">${cell.next[1].toFixed(5)}</latitude>
        <longitude unit="degrees">${cell.next[0].toFixed(5)}</longitude>
      </geodetic_coordinate></centroid_forecast></centroid_forecasts></forecast>`
    : "";
  return `<feature identifier="${index}" type="3D_reflectivity_feature">
    <metadata><reference_time format="ISO 8601">${cell.time}</reference_time></metadata>
    <geometry>
      <centroid_3d><geodetic_coordinate>
        <latitude unit="degrees">${lat.toFixed(5)}</latitude>
        <longitude unit="degrees">${lon.toFixed(5)}</longitude>
      </geodetic_coordinate></centroid_3d>
      <polygons_projected><geodetic_coordinates>
        <polygon no="0" unit="degrees"><latitudes>${lats}</latitudes><longitudes>${lons}</longitudes></polygon>
      </geodetic_coordinates></polygons_projected>
    </geometry>
    <intensity><max_value unit="dBZ">${cell.dbz}</max_value><hail_flag>${cell.kind === "none" ? 0 : 1}</hail_flag></intensity>
    <hymec>
      <area_rain_hail unit="km^2">${area("mixed")}</area_rain_hail>
      <area_hail unit="km^2">${area("hail")}</area_hail>
      <area_large_hail unit="km^2">${area("large")}</area_large_hail>
    </hymec>
    ${forecast}
  </feature>`;
}

/** One KONRAD3D file as XML. */
export function fixtureXml(cells: readonly FixtureCell[]): string {
  return `<?xml version="1.0" ?><konrad3d data_model_version="1.7"><head></head><cells reference_time="${cells[0]?.time ?? ""}">${cells
    .map(feature)
    .join("")}</cells></konrad3d>`;
}
