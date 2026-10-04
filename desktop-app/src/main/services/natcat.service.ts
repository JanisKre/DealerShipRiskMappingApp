import {
  composeNatCat,
  effectiveNatCatRouting,
  sourcesToQuery,
} from "@shared/natcat-routing";
import type { NatCatConnectorTest } from "@shared/ipc-schema";
import type { NatCatApiProvider, NatCatAssessment } from "@shared/types";
import { fetchHazardApiAssessment } from "./hazard-api.service";
import { getNatCatApiKey, getSettings } from "./settings.service";

/**
 * Resolves the natural-catastrophe assessment of one location from the
 * routing in the settings: queries every connected API source the routing
 * needs (in parallel), then combines them with the location's imported data
 * per peril. A failed source falls back along the chain and is recorded in
 * the evidence; it never aborts the analysis.
 */
export async function resolveNatCat(
  lat: number,
  lon: number,
  imported?: NatCatAssessment,
): Promise<NatCatAssessment | undefined> {
  const routing = effectiveNatCatRouting(getSettings().natCat);
  const providers = sourcesToQuery(routing);
  const settled = await Promise.allSettled(
    providers.map((provider) => lookup(provider, lat, lon, routing)),
  );
  const results: Partial<Record<NatCatApiProvider, NatCatAssessment | Error>> =
    {};
  settled.forEach((outcome, i) => {
    const provider = providers[i];
    if (outcome.status === "fulfilled") {
      results[provider] = outcome.value;
    } else {
      const error =
        outcome.reason instanceof Error
          ? outcome.reason
          : new Error(String(outcome.reason));
      console.warn(`NatCat lookup failed (${provider}); falling back`, error);
      results[provider] = error;
    }
  });
  return composeNatCat({ routing, imported, results });
}

async function lookup(
  provider: NatCatApiProvider,
  lat: number,
  lon: number,
  routing = effectiveNatCatRouting(getSettings().natCat),
): Promise<NatCatAssessment> {
  const endpoint = routing.connectors[provider]?.endpoint;
  if (!endpoint) throw new Error(`${provider} is not connected`);
  const apiKey = getNatCatApiKey(provider);
  if (!apiKey) throw new Error(`${provider} API key is not configured`);
  return fetchHazardApiAssessment(lat, lon, { provider, endpoint, apiKey });
}

/** Reference location for connection tests: Frankfurt am Main. */
const TEST_LOCATION = { lat: 50.1109, lon: 8.6821 };

/**
 * Checks a connector with one lookup at a fixed reference location and
 * reports which perils the endpoint answered — so a contract mismatch shows
 * up in the settings, not during a portfolio analysis.
 */
export async function testNatCatConnector(
  provider: NatCatApiProvider,
): Promise<NatCatConnectorTest> {
  const started = Date.now();
  try {
    const assessment = await lookup(
      provider,
      TEST_LOCATION.lat,
      TEST_LOCATION.lon,
    );
    return {
      ok: true,
      perils: assessment.hazards.map((h) => h.peril),
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      perils: [],
      message: (error instanceof Error ? error.message : String(error)).slice(
        0,
        300,
      ),
      latencyMs: Date.now() - started,
    };
  }
}
