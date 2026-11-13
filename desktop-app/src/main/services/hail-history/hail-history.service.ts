import {
  HailHistorySchema,
  type HailHistory,
  type HailHistoryStation,
  type RiskEvidence,
} from "@shared/types";
import { haversineMeters } from "@shared/dedupe";
import { cached } from "../cache.service";
import { fetchWithResilience } from "../http.service";
import { readZipEntries } from "../zip";

/**
 * Hail history near a location from the DWD Climate Data Center: the daily
 * "weather phenomena" of the station network, column HAGEL (1 = hail was
 * observed at the station that day). The nearest stations within
 * {@link HAIL_HISTORY_RADIUS_KM} with at least {@link MIN_YEARS} years of
 * records are summarized as hail days per year and the latest hail dates.
 *
 * Context only — this never enters the hail EAL. Station observations are
 * point records: a storm that misses the station is not in them, and most
 * stations stopped reporting weather phenomena when observation was
 * automated (around 2011), so recent years are often missing. Both limits
 * travel with the result as evidence limitations.
 *
 * Data basis: Deutscher Wetterdienst (open data, attribution required).
 */

const BASE =
  "https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/daily/weather_phenomena";
const STATIONS_URL = `${BASE}/historical/wetter_tageswerte_Beschreibung_Stationen.txt`;
const HISTORICAL_URL = `${BASE}/historical/`;
const RECENT_URL = `${BASE}/recent/`;

export const HAIL_HISTORY_RADIUS_KM = 30;
const MAX_STATIONS = 3;
const MIN_YEARS = 10;
/** A year counts as observed with at least this many valid daily values. */
const MIN_VALID_DAYS_PER_YEAR = 180;
const RECENT_DATES = 5;
/** Station archives are a few kilobytes; anything far larger is not one. */
const MAX_ARCHIVE_BYTES = 8 * 1024 * 1024;

const DAY = 24 * 60 * 60 * 1000;
const TTL_STATIONS = 7 * DAY;
const TTL_LISTING = DAY;
const TTL_STATION_SUMMARY = 7 * DAY;

export interface DwdStation {
  id: string;
  from: string;
  to: string;
  lat: number;
  lon: number;
  name: string;
  state?: string;
}

// --- Parsers (pure, unit-tested) ---------------------------------------

/**
 * Parses the station description: six numeric columns, then name, state
 * and release flag separated by runs of spaces (the published column
 * widths do not match the data, so they are not relied on).
 */
export function parseStationList(text: string): DwdStation[] {
  const stations: DwdStation[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match =
      /^\s*(\d{5})\s+(\d{8})\s+(\d{8})\s+-?\d+\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(.+)$/.exec(
        line,
      );
    if (!match) continue;
    const [, id, from, to, lat, lon, rest] = match;
    const [name, state] = rest.trim().split(/\s{2,}/);
    if (!name) continue;
    stations.push({
      id,
      from,
      to,
      lat: Number(lat),
      lon: Number(lon),
      name: name.slice(0, 120),
      ...(state ? { state: state.slice(0, 60) } : {}),
    });
  }
  return stations;
}

/** Station id → archive file name, from an Apache directory listing. */
export function parseArchiveListing(
  html: string,
  kind: "historical" | "recent",
): Map<string, string> {
  const pattern =
    kind === "historical"
      ? /href="(wetter_tageswerte_(\d{5})_\d{8}_\d{8}_hist\.zip)"/g
      : /href="(wetter_tageswerte_(\d{5})_akt\.zip)"/g;
  const files = new Map<string, string>();
  for (const match of html.matchAll(pattern)) files.set(match[2], match[1]);
  return files;
}

/** Daily HAGEL values: date (YYYYMMDD) → 1/0; missing values are left out. */
export function parseHailObservations(text: string): Map<string, 0 | 1> {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  const values = new Map<string, 0 | 1>();
  if (lines.length === 0) return values;
  const header = lines[0].split(";").map((h) => h.trim().toUpperCase());
  const dateIndex = header.indexOf("MESS_DATUM");
  const hailIndex = header.indexOf("HAGEL");
  if (dateIndex < 0 || hailIndex < 0) return values;
  for (const line of lines.slice(1)) {
    const cells = line.split(";");
    const date = cells[dateIndex]?.trim() ?? "";
    const value = Number(cells[hailIndex]?.trim());
    if (!/^\d{8}$/.test(date)) continue;
    if (value === 0 || value === 1) values.set(date, value);
  }
  return values;
}

/** Hail days per observed year and the latest hail dates. */
export function summarizeHail(
  observations: Map<string, 0 | 1>,
): Omit<
  HailHistoryStation,
  "stationId" | "name" | "state" | "distanceKm"
> | null {
  const byYear = new Map<number, { valid: number; hail: number }>();
  const hailDates: string[] = [];
  for (const [date, value] of observations) {
    const year = Number(date.slice(0, 4));
    const entry = byYear.get(year) ?? { valid: 0, hail: 0 };
    entry.valid++;
    if (value === 1) {
      entry.hail++;
      hailDates.push(date);
    }
    byYear.set(year, entry);
  }
  const observed = [...byYear.entries()]
    .filter(([, v]) => v.valid >= MIN_VALID_DAYS_PER_YEAR)
    .sort(([a], [b]) => a - b);
  if (observed.length === 0) return null;
  const observedYears = new Set(observed.map(([year]) => year));
  const observedDates = hailDates
    .filter((date) => observedYears.has(Number(date.slice(0, 4))))
    .sort()
    .map((d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`);
  const hailDays = observed.reduce((sum, [, v]) => sum + v.hail, 0);
  return {
    firstYear: observed[0][0],
    lastYear: observed[observed.length - 1][0],
    yearsObserved: observed.length,
    hailDays,
    hailDaysPerYear: Math.round((hailDays / observed.length) * 100) / 100,
    recentHailDates: observedDates.slice(-RECENT_DATES).reverse(),
    hailDaysByYear: observed.map(([year, v]) => ({ year, days: v.hail })),
    hailDates: observedDates,
  };
}

/** Candidate stations: close enough and with a long enough record. */
export function nearestStations(
  stations: DwdStation[],
  lat: number,
  lon: number,
  radiusKm = HAIL_HISTORY_RADIUS_KM,
): Array<DwdStation & { distanceKm: number }> {
  return stations
    .filter(
      (s) =>
        Number(s.to.slice(0, 4)) - Number(s.from.slice(0, 4)) + 1 >= MIN_YEARS,
    )
    .map((s) => ({
      ...s,
      distanceKm: haversineMeters(lat, lon, s.lat, s.lon) / 1000,
    }))
    .filter((s) => s.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

export function hailHistoryEvidence(): RiskEvidence {
  return {
    source: "Deutscher Wetterdienst (DWD), Climate Data Center",
    retrievedAt: new Date().toISOString(),
    dataVersion: "daily weather_phenomena (historical + recent)",
    spatialResolution: "station points",
    method: `Days with observed hail (HAGEL) at the nearest stations within ${HAIL_HISTORY_RADIUS_KM} km`,
    confidence: 0.5,
    fallbackUsed: false,
    limitations: [
      "Station observations, not a hail-event catalogue: hail that misses the station is not recorded",
      "Most stations stopped observing weather phenomena around 2011, so recent years are often missing",
      "Context only: not used in the hail EAL",
    ],
  };
}

// --- Fetching -----------------------------------------------------------

async function fetchText(url: string, encoding = "utf-8"): Promise<string> {
  const res = await fetchWithResilience(url);
  if (!res.ok) throw new Error(`DWD ${res.status}`);
  return new TextDecoder(encoding).decode(await res.arrayBuffer());
}

async function fetchArchiveText(url: string): Promise<string> {
  const res = await fetchWithResilience(url);
  if (!res.ok) throw new Error(`DWD ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > MAX_ARCHIVE_BYTES)
    throw new Error("DWD archive too large");
  const product = readZipEntries(buffer).find((entry) =>
    /^produkt_wetter_tag_.*\.txt$/i.test(entry.name),
  );
  if (!product) throw new Error("DWD archive without product file");
  return new TextDecoder("latin1").decode(product.read());
}

function loadStations(): Promise<DwdStation[]> {
  return cached("dwd:hail:stations:v1", TTL_STATIONS, async () =>
    parseStationList(await fetchText(STATIONS_URL, "latin1")),
  );
}

async function loadListing(
  kind: "historical" | "recent",
): Promise<Record<string, string>> {
  return cached(`dwd:hail:listing:${kind}:v1`, TTL_LISTING, async () =>
    Object.fromEntries(
      parseArchiveListing(
        await fetchText(kind === "historical" ? HISTORICAL_URL : RECENT_URL),
        kind,
      ),
    ),
  );
}

async function stationSummary(
  station: DwdStation & { distanceKm: number },
  historicalFile: string | undefined,
  recentFile: string | undefined,
): Promise<HailHistoryStation | null> {
  if (!historicalFile && !recentFile) return null;
  const key = `dwd:hail:station:v2:${station.id}:${historicalFile ?? "-"}:${recentFile ?? "-"}`;
  const summary = await cached(key, TTL_STATION_SUMMARY, async () => {
    const observations = new Map<string, 0 | 1>();
    if (historicalFile) {
      for (const [date, value] of parseHailObservations(
        await fetchArchiveText(`${HISTORICAL_URL}${historicalFile}`),
      ))
        observations.set(date, value);
    }
    if (recentFile) {
      for (const [date, value] of parseHailObservations(
        await fetchArchiveText(`${RECENT_URL}${recentFile}`),
      ))
        observations.set(date, value);
    }
    return summarizeHail(observations);
  });
  if (!summary) return null;
  return {
    stationId: station.id,
    name: station.name,
    ...(station.state ? { state: station.state } : {}),
    distanceKm: Math.round(station.distanceKm * 10) / 10,
    ...summary,
  };
}

/** Hail history at the nearest DWD stations; no stations → empty list. */
export async function getHailHistory(
  lat: number,
  lon: number,
): Promise<HailHistory> {
  const [stations, historical, recent] = await Promise.all([
    loadStations(),
    loadListing("historical"),
    loadListing("recent").catch(() => ({}) as Record<string, string>),
  ]);
  const results: HailHistoryStation[] = [];
  for (const station of nearestStations(stations, lat, lon)) {
    if (results.length >= MAX_STATIONS) break;
    try {
      const summary = await stationSummary(
        station,
        historical[station.id],
        recent[station.id],
      );
      if (summary) results.push(summary);
    } catch (err) {
      console.warn(`DWD hail history for station ${station.id} failed:`, err);
    }
  }
  return HailHistorySchema.parse({
    searchRadiusKm: HAIL_HISTORY_RADIUS_KM,
    stations: results,
    evidence: hailHistoryEvidence(),
  });
}
