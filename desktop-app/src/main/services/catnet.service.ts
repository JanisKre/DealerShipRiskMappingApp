import { z } from "zod";
import {
  NatCatAssessmentSchema,
  type NatCatAssessment,
  type NatCatHazard,
} from "@shared/types";
import type { NatCatProviderAdapter } from "./hazard-provider";
import { fetchWithResilience, HttpRequestError } from "./http.service";

const DEFAULT_TIMEOUT_MS = 15_000;

export interface CatNetConfig {
  endpoint: string;
  apiKey: string;
  timeoutMs?: number;
}

const CatNetHazardPayloadSchema = z.object({
  peril: z.string().min(1),
  score: z.number().min(0).max(100),
  hazardValue: z.number().optional(),
  unit: z.string().optional(),
  rawValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
  returnPeriodYears: z.number().positive().optional(),
  annualExceedanceProbability: z.number().positive().max(1).optional(),
});

/**
 * Calls a customer-configured CatNet API endpoint. The exact endpoint and
 * payload contract are deliberately configurable because Swiss Re exposes
 * the production schema only to contracted API clients.
 */
export async function fetchCatNetAssessment(
  lat: number,
  lon: number,
  config: CatNetConfig,
  perils?: string[],
): Promise<NatCatAssessment> {
  validateCoordinates(lat, lon);
  const endpoint = validateEndpoint(config.endpoint);
  if (!config.apiKey.trim()) throw new Error("CatNet API key is not configured");

  try {
    const response = await fetchWithResilience(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ latitude: lat, longitude: lon, perils }),
    }, {
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      retries: 0,
    });
    if (!response.ok) {
      throw new Error(`CatNet request failed (${response.status})`);
    }
    return normalizeCatNetResponse(await response.json());
  } catch (error) {
    if (error instanceof HttpRequestError && error.timedOut) {
      throw new Error("CatNet request timed out");
    }
    throw error;
  }
}

/** Normalizes the documented integration shape without persisting raw vendor payloads. */
export function normalizeCatNetResponse(payload: unknown): NatCatAssessment {
  const object = z
    .object({
      hazards: z.array(CatNetHazardPayloadSchema).min(1),
      dataVersion: z.string().optional(),
      spatialResolution: z.string().optional(),
      attributes: z
        .record(z.union([z.string(), z.number(), z.boolean()]))
        .optional(),
    })
    .passthrough()
    .parse(payload);
  const retrievedAt = new Date().toISOString();
  const hazards: NatCatHazard[] = object.hazards.map((hazard) => ({
    peril: hazard.peril,
    score: hazard.score,
    ...(hazard.hazardValue !== undefined
      ? { hazardValue: hazard.hazardValue }
      : {}),
    unit: hazard.unit ?? "provider score",
    ...(hazard.rawValue !== undefined ? { rawValue: hazard.rawValue } : {}),
    ...(hazard.returnPeriodYears !== undefined
      ? { returnPeriodYears: hazard.returnPeriodYears }
      : {}),
    ...(hazard.annualExceedanceProbability !== undefined
      ? { annualExceedanceProbability: hazard.annualExceedanceProbability }
      : {}),
  }));
  return NatCatAssessmentSchema.parse({
    provider: "swissre-catnet",
    retrievedAt,
    dataVersion: object.dataVersion,
    spatialResolution: object.spatialResolution,
    hazards,
    attributes: object.attributes ?? {},
    evidence: {
      source: "Swiss Re CatNet",
      retrievedAt,
      dataVersion: object.dataVersion,
      spatialResolution: object.spatialResolution,
      method: "CatNet API location lookup",
      confidence: 0.9,
      fallbackUsed: false,
      limitations: [
        "Provider response is normalized; policy terms, deductibles and vulnerability curves remain outside this adapter",
      ],
    },
  });
}

function validateCoordinates(lat: number, lon: number): void {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error("Invalid latitude");
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new Error("Invalid longitude");
  }
}

function validateEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("CatNet endpoint must be a valid URL");
  }
  if (url.protocol !== "https:") {
    throw new Error("CatNet endpoint must use HTTPS");
  }
  return url.toString();
}

export function createCatNetProvider(
  config: CatNetConfig,
): NatCatProviderAdapter {
  return {
    id: "swissre-catnet",
    lookup: (lat, lon, perils) =>
      fetchCatNetAssessment(lat, lon, config, perils),
  };
}
