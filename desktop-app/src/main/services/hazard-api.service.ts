import { z } from "zod";
import { sourceLabel } from "@shared/natcat-catalog";
import {
  NatCatAssessmentSchema,
  type NatCatApiProvider,
  type NatCatAssessment,
  type NatCatHazard,
} from "@shared/types";
import type { NatCatProviderAdapter } from "./hazard-provider";
import { fetchWithResilience, HttpRequestError } from "./http.service";

/**
 * Adapter for the app's hazard API contract (documented in
 * `docs/risk-model.md`). Every licensed provider — Swiss Re CatNet, Munich
 * Re, Moody's, Verisk, JBA, Fathom or any other — is reached through a
 * customer-configured HTTPS endpoint that answers in this contract, because
 * the vendors expose their production schemas only to contracted clients.
 *
 * Request:  POST { latitude, longitude, perils? }  (Bearer token)
 * Response: { hazards: [{ peril, score 0–100, ... }], dataVersion?, ... }
 */

const DEFAULT_TIMEOUT_MS = 15_000;

export interface HazardApiConfig {
  provider: NatCatApiProvider;
  endpoint: string;
  apiKey: string;
  timeoutMs?: number;
}

const HazardPayloadSchema = z.object({
  peril: z.string().min(1),
  score: z.number().min(0).max(100),
  hazardValue: z.number().optional(),
  unit: z.string().optional(),
  rawValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
  returnPeriodYears: z.number().positive().optional(),
  annualExceedanceProbability: z.number().positive().max(1).optional(),
});

/** Looks up one location at a connected hazard API. */
export async function fetchHazardApiAssessment(
  lat: number,
  lon: number,
  config: HazardApiConfig,
  perils?: string[],
): Promise<NatCatAssessment> {
  validateCoordinates(lat, lon);
  const label = sourceLabel(config.provider);
  const endpoint = validateEndpoint(config.endpoint, label);
  if (!config.apiKey.trim())
    throw new Error(`${label} API key is not configured`);

  try {
    const response = await fetchWithResilience(
      endpoint,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({ latitude: lat, longitude: lon, perils }),
      },
      {
        timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        retries: 0,
      },
    );
    if (!response.ok) {
      throw new Error(`${label} request failed (${response.status})`);
    }
    return normalizeHazardApiResponse(await response.json(), config.provider);
  } catch (error) {
    if (error instanceof HttpRequestError && error.timedOut) {
      throw new Error(`${label} request timed out`);
    }
    throw error;
  }
}

/** Normalizes the contract shape without persisting raw vendor payloads. */
export function normalizeHazardApiResponse(
  payload: unknown,
  provider: NatCatApiProvider,
): NatCatAssessment {
  const object = z
    .object({
      hazards: z.array(HazardPayloadSchema).min(1),
      dataVersion: z.string().optional(),
      spatialResolution: z.string().optional(),
      attributes: z
        .record(z.union([z.string(), z.number(), z.boolean()]))
        .optional(),
    })
    .passthrough()
    .parse(payload);
  const retrievedAt = new Date().toISOString();
  const label = sourceLabel(provider);
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
    provider,
  }));
  return NatCatAssessmentSchema.parse({
    provider,
    retrievedAt,
    dataVersion: object.dataVersion,
    spatialResolution: object.spatialResolution,
    hazards,
    attributes: object.attributes ?? {},
    evidence: {
      source: label,
      retrievedAt,
      dataVersion: object.dataVersion,
      spatialResolution: object.spatialResolution,
      method: `${label} API location lookup`,
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

function validateEndpoint(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} endpoint must be a valid URL`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`${label} endpoint must use HTTPS`);
  }
  if (url.username || url.password) {
    throw new Error(`${label} endpoint must not contain embedded credentials`);
  }
  return url.toString();
}

export function createHazardApiProvider(
  config: HazardApiConfig,
): NatCatProviderAdapter {
  return {
    id: config.provider,
    lookup: (lat, lon, perils) =>
      fetchHazardApiAssessment(lat, lon, config, perils),
  };
}
