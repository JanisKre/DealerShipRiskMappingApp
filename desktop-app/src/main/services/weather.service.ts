import { cached, TTL } from "./cache.service";
import { fetchWithResilience } from "./http.service";
import type { HazardProvider } from "./hazard-provider";
import type { RiskEvidence } from "@shared/types";

/**
 * Weather/climate data via Open-Meteo (no API key needed), fetched directly
 * in the main process and cached persistently.
 *
 * Provides the raw metrics from which risk.service derives the peril scores.
 * Lightning and hail are no longer estimated from latitude, but derived
 * from real convective instability (CAPE, J/kg) at the location — the
 * CAPE proxy intended by the architecture. Heat comes from `temperature_2m_max`.
 */
export interface WeatherMetrics {
  maxWindKmh: number;
  annualPrecipMm: number;
  maxSnowDepthCm: number;
  lightningDensity: number; // strikes/km²/year (derived from CAPE)
  hailProbability: number; // 0..1 (derived from CAPE frequency)
  maxTempC: number; // highest daily max temperature in the window (°C)
  hotDays: number; // days with Tmax ≥ 30 °C in the window
  [key: string]: number;
}

/** CAPE thresholds (J/kg): from ~1000 thunderstorm-prone, from ~1500 hail-prone. */
const CAPE_THUNDER = 1000;
const CAPE_HAIL = 1500;
const HOT_DAY_C = 30;

async function fetchOpenMeteoWeather(
  lat: number,
  lon: number,
): Promise<WeatherMetrics> {
  const key = `weather:${lat.toFixed(3)},${lon.toFixed(3)}`;
  return cached(key, TTL.weather, async () => {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&daily=wind_speed_10m_max,precipitation_sum,snowfall_sum,temperature_2m_max` +
      `&hourly=cape&past_days=92&forecast_days=1&timezone=auto`;
    const res = await fetchWithResilience(url);
    if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
    const data = (await res.json()) as {
      daily?: {
        time?: string[];
        wind_speed_10m_max?: number[];
        precipitation_sum?: number[];
        snowfall_sum?: number[];
        temperature_2m_max?: number[];
      };
      hourly?: { time?: string[]; cape?: number[] };
    };
    const d = data.daily ?? {};
    const maxWindKmh = maxOf(d.wind_speed_10m_max);
    const precip = sumOf(d.precipitation_sum);
    const snow = maxOf(d.snowfall_sum);
    const tmax = d.temperature_2m_max ?? [];
    const windowDays = Math.max(1, tmax.length);

    const cape = dailyMaxCape(data.hourly?.time, data.hourly?.cape);
    const maxCape = maxOf(cape);
    const thunderDayFrac = fracAtLeast(cape, CAPE_THUNDER);
    const hailDayFrac = fracAtLeast(cape, CAPE_HAIL);

    return {
      maxWindKmh,
      annualPrecipMm: precip * 4, // ~92 days → roughly scaled up to a year
      maxSnowDepthCm: snow,
      // CAPE proxy: peak instability determines the lightning density (strikes/km²/yr),
      // clamped to a range plausible for Germany.
      lightningDensity: clamp(maxCape / 600, 0.3, 6),
      // Hail: share of hail-prone days (CAPE ≥ 1500) in the window, scaled.
      hailProbability: clamp(hailDayFrac * 3 + thunderDayFrac * 0.3, 0.05, 0.9),
      maxTempC: maxOf(tmax),
      hotDays: countAtLeast(tmax, HOT_DAY_C) * (365 / windowDays),
    };
  });
}

/** Default hazard adapter. Other providers can implement the same contract. */
export const openMeteoProvider: HazardProvider = {
  id: "open-meteo",
  getWeather: fetchOpenMeteoWeather,
  evidence: (): RiskEvidence => ({
    source: "Open-Meteo",
    retrievedAt: new Date().toISOString(),
    dataVersion: "forecast-api",
    spatialResolution: "model grid",
    method: "92-day weather window with screening proxies",
    confidence: 0.55,
    fallbackUsed: false,
    limitations: ["Not a catastrophe-model or engineering assessment"],
  }),
};

export function fetchWeather(lat: number, lon: number): Promise<WeatherMetrics> {
  return openMeteoProvider.getWeather(lat, lon);
}

/** Reduces hourly CAPE values to a daily maximum per calendar day. */
function dailyMaxCape(times?: string[], cape?: number[]): number[] {
  if (!times || !cape) return [];
  const perDay = new Map<string, number>();
  for (let i = 0; i < times.length; i++) {
    const day = times[i].slice(0, 10);
    const v = cape[i] ?? 0;
    perDay.set(day, Math.max(perDay.get(day) ?? 0, v));
  }
  return [...perDay.values()];
}

function fracAtLeast(arr: number[], threshold: number): number {
  if (arr.length === 0) return 0;
  return arr.filter((v) => v >= threshold).length / arr.length;
}
function countAtLeast(arr: number[], threshold: number): number {
  return arr.filter((v) => v != null && v >= threshold).length;
}
function maxOf(arr?: number[]): number {
  return arr && arr.length ? Math.max(...arr.filter((n) => n != null)) : 0;
}
function sumOf(arr?: number[]): number {
  return arr ? arr.reduce((a, b) => a + (b ?? 0), 0) : 0;
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
