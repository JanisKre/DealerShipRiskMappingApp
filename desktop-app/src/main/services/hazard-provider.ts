import type { RiskEvidence } from "@shared/types";
import type { WeatherMetrics } from "./weather.service";

/** Adapter contract for a location-level hazard data provider. */
export interface HazardProvider {
  readonly id: string;
  getWeather(lat: number, lon: number): Promise<WeatherMetrics>;
  evidence(): RiskEvidence;
}
