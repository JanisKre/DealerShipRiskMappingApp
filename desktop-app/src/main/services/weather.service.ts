import { cached, TTL } from "./cache.service";
import { fetchWithResilience } from "./http.service";
import type { HazardProvider } from "./hazard-provider";
import type { RiskEvidence } from "@shared/types";

/**
 * Weather data via Open-Meteo (no API key needed), fetched directly in the
 * main process and cached persistently.
 *
 * Provides the screening hail proxy used when neither a postcode hail zone
 * nor a licensed provider is available: the frequency of convectively
 * unstable days (CAPE, J/kg) at the location over fixed summer half-years.
 *
 * Until screening-0.5.2 the proxy used a rolling 92-day window, so the same
 * site landed in zone 1 when analysed in winter and up to zone 6 in August.
 * Fixed, complete April–September seasons make the result independent of the
 * analysis date; it only moves once a year, when a new season completes.
 */
export interface WeatherMetrics {
  hailProbability: number; // 0..1 (derived from CAPE frequency)
  [key: string]: number;
}

/** CAPE thresholds (J/kg): from ~1000 thunderstorm-prone, from ~1500 hail-prone. */
const CAPE_THUNDER = 1000;
const CAPE_HAIL = 1500;

/** Number of complete summer half-years the proxy averages over. */
export const CAPE_SEASONS = 3;
/** First year Open-Meteo's historical forecast archive carries CAPE. */
const FIRST_CAPE_YEAR = 2022;
/** Hail season used for the proxy: April to September (months 4–9). */
const SEASON_FIRST_MONTH = 4;
const SEASON_LAST_MONTH = 9;

/** The method text, also the key of its translation in the detail dialog. */
export const CAPE_PROXY_METHOD =
  "summer half-year CAPE frequency with screening proxies";

/**
 * The last `CAPE_SEASONS` complete April–September seasons before `now`.
 * A season counts as complete from 1 October of its year.
 */
export function capeSeasons(now: Date = new Date()): number[] {
  const year = now.getUTCFullYear();
  const lastComplete =
    now.getUTCMonth() + 1 > SEASON_LAST_MONTH ? year : year - 1;
  const first = Math.max(FIRST_CAPE_YEAR, lastComplete - CAPE_SEASONS + 1);
  const years: number[] = [];
  for (let y = first; y <= lastComplete; y++) years.push(y);
  return years;
}

/** The screening hail proxy from daily maximum CAPE values (pure). */
export function hailProxyFromDailyCape(dailyMaxCape: number[]): number {
  const thunderDayFrac = fracAtLeast(dailyMaxCape, CAPE_THUNDER);
  const hailDayFrac = fracAtLeast(dailyMaxCape, CAPE_HAIL);
  // Share of hail-prone days (CAPE ≥ 1500) in the seasons, scaled.
  return clamp(hailDayFrac * 3 + thunderDayFrac * 0.3, 0.05, 0.9);
}

async function fetchOpenMeteoWeather(
  lat: number,
  lon: number,
): Promise<WeatherMetrics> {
  const seasons = capeSeasons();
  const first = seasons[0];
  const last = seasons[seasons.length - 1];
  const key = `weather:hail-seasons:${first}-${last}:${lat.toFixed(3)},${lon.toFixed(3)}`;
  return cached(key, TTL.weather, async () => {
    const url =
      `https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&start_date=${first}-04-01&end_date=${last}-09-30&hourly=cape&timezone=auto`;
    const res = await fetchWithResilience(url);
    if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
    const data = (await res.json()) as {
      hourly?: { time?: string[]; cape?: Array<number | null> };
    };
    const cape = dailyMaxCape(data.hourly?.time, data.hourly?.cape);
    if (cape.length === 0) throw new Error("Open-Meteo returned no CAPE data");
    return { hailProbability: hailProxyFromDailyCape(cape) };
  });
}

/** Default hazard adapter. Other providers can implement the same contract. */
export const openMeteoProvider: HazardProvider = {
  id: "open-meteo",
  getWeather: fetchOpenMeteoWeather,
  evidence: (): RiskEvidence => {
    const seasons = capeSeasons();
    return {
      source: "Open-Meteo",
      retrievedAt: new Date().toISOString(),
      dataVersion: `historical-forecast-api ${seasons[0]}–${seasons[seasons.length - 1]} (Apr–Sep)`,
      spatialResolution: "model grid",
      method: CAPE_PROXY_METHOD,
      confidence: 0.55,
      fallbackUsed: false,
      limitations: [
        "Not a catastrophe-model or engineering assessment",
        "Open-Meteo free API: non-commercial use only; data CC BY 4.0",
      ],
    };
  },
};

export function fetchWeather(
  lat: number,
  lon: number,
): Promise<WeatherMetrics> {
  return openMeteoProvider.getWeather(lat, lon);
}

/**
 * Conservative stand-in for a failed weather lookup (Open-Meteo outage, rate
 * limit, timeout). Every value sits at or near the low end of its clamped
 * range, so a transient provider failure degrades the weather-driven score
 * rather than silently inventing elevated risk — `scoreRisk` pairs this with
 * `fallbackUsed: true` evidence rather than treating it as a real reading.
 */
export const NEUTRAL_WEATHER_METRICS: WeatherMetrics = {
  hailProbability: 0.05,
};

/**
 * Reduces hourly CAPE values to a daily maximum per calendar day of the hail
 * season. Hours without a value (`null`, before the archive starts) are
 * skipped, and a day without any value is left out instead of counting as a
 * calm day.
 */
export function dailyMaxCape(
  times?: string[],
  cape?: Array<number | null>,
): number[] {
  if (!times || !cape) return [];
  const perDay = new Map<string, number>();
  for (let i = 0; i < times.length; i++) {
    const v = cape[i];
    if (v == null || !Number.isFinite(v)) continue;
    const day = times[i].slice(0, 10);
    const month = Number(day.slice(5, 7));
    if (month < SEASON_FIRST_MONTH || month > SEASON_LAST_MONTH) continue;
    perDay.set(day, Math.max(perDay.get(day) ?? 0, v));
  }
  return [...perDay.values()];
}

function fracAtLeast(arr: number[], threshold: number): number {
  if (arr.length === 0) return 0;
  return arr.filter((v) => v >= threshold).length / arr.length;
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
