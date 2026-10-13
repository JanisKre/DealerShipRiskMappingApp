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
 * unstable days (CAPE, J/kg) at the location.
 */
export interface WeatherMetrics {
  hailProbability: number; // 0..1 (derived from CAPE frequency)
  [key: string]: number;
}

/** CAPE thresholds (J/kg): from ~1000 thunderstorm-prone, from ~1500 hail-prone. */
const CAPE_THUNDER = 1000;
const CAPE_HAIL = 1500;

async function fetchOpenMeteoWeather(
  lat: number,
  lon: number,
): Promise<WeatherMetrics> {
  const key = `weather:hail:${lat.toFixed(3)},${lon.toFixed(3)}`;
  return cached(key, TTL.weather, async () => {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&hourly=cape&past_days=92&forecast_days=1&timezone=auto`;
    const res = await fetchWithResilience(url);
    if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
    const data = (await res.json()) as {
      hourly?: { time?: string[]; cape?: number[] };
    };
    const cape = dailyMaxCape(data.hourly?.time, data.hourly?.cape);
    const thunderDayFrac = fracAtLeast(cape, CAPE_THUNDER);
    const hailDayFrac = fracAtLeast(cape, CAPE_HAIL);

    return {
      // Share of hail-prone days (CAPE ≥ 1500) in the window, scaled.
      hailProbability: clamp(hailDayFrac * 3 + thunderDayFrac * 0.3, 0.05, 0.9),
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
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
