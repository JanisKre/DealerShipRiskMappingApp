import type { Page } from "@playwright/test";
import type { DrmApi } from "../src/preload";

/**
 * Deterministic analysed portfolios for end-to-end tests: the same call
 * always yields the same locations, so tables, charts and totals can be
 * asserted without a network, a detection model or an analysis run.
 */

const CITIES: readonly [string, string, number, number][] = [
  ["Dresden", "01067", 51.0504, 13.7373],
  ["Leipzig", "04109", 51.3397, 12.3731],
  ["Berlin", "10115", 52.532, 13.3849],
  ["Hamburg", "20095", 53.5511, 9.9937],
  ["Hannover", "30159", 52.3759, 9.732],
  ["Köln", "50667", 50.9375, 6.9603],
  ["Frankfurt am Main", "60311", 50.1109, 8.6821],
  ["Stuttgart", "70173", 48.7758, 9.1829],
  ["München", "80331", 48.1351, 11.582],
  ["Nürnberg", "90402", 49.4521, 11.0767],
];

const TIERS = ["Very Low", "Low", "Low", "Moderate", "High", "Very High"];
const PARTNERS = ["Agentur Nord", "Agentur Süd", "Makler West"];
const SEGMENTS = ["Premium", "Volumen", "Nutzfahrzeuge"];

/** Small linear congruential generator: stable pseudo-random numbers. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/** A square lot of roughly `sideM` metres around the point. */
function squareLot(lat: number, lon: number, sideM: number): unknown {
  const dLat = sideM / 2 / 111_320;
  const dLon = sideM / 2 / (111_320 * Math.cos((lat * Math.PI) / 180));
  return {
    type: "Polygon",
    coordinates: [
      [
        [lon - dLon, lat - dLat],
        [lon + dLon, lat - dLat],
        [lon + dLon, lat + dLat],
        [lon - dLon, lat + dLat],
        [lon - dLon, lat - dLat],
      ],
    ],
  };
}

/** `count` analysed locations spread around ten German cities. */
export function analysedPortfolio(count: number): unknown[] {
  const random = generator(20261115);
  return Array.from({ length: count }, (_, i) => {
    const [city, postcode, cityLat, cityLon] = CITIES[i % CITIES.length];
    const lat = cityLat + (random() - 0.5) * 0.3;
    const lon = cityLon + (random() - 0.5) * 0.4;
    const zone = (1 + Math.floor(random() * 6)) as 1 | 2 | 3 | 4 | 5 | 6;
    const vehicles = 20 + Math.floor(random() * 380);
    const side = 60 + Math.floor(random() * 120);
    const frequency = 0.02 * zone;
    const meanSeverityEur = 1_800;
    const exposed = Math.round(vehicles * 0.85);
    const eal = Math.round(exposed * frequency * meanSeverityEur);
    const score = Math.min(100, Math.round(zone * 14 + random() * 12));
    const number = String(i + 1).padStart(3, "0");
    return {
      id: `e2e-${number}`,
      name: `Autohaus ${city} ${number}`,
      address: `Teststraße ${i + 1}, ${postcode} ${city}`,
      lat,
      lon,
      insured: i % 3 !== 0,
      salesPartner: PARTNERS[i % PARTNERS.length],
      subPortfolio: SEGMENTS[i % SEGMENTS.length],
      group: i % 5 === 0 ? "Gruppe Beispiel" : undefined,
      productLimitEur: i % 4 === 0 ? 2_000_000 : undefined,
      hailZone: zone,
      hailRiskTier: TIERS[zone - 1],
      boundary: {
        source: "osm",
        role: "operationalLot",
        polygon: squareLot(lat, lon, side),
        areaSqm: side * side,
        confidence: 0.6 + random() * 0.35,
      },
      detection: {
        vehicleCount: vehicles,
        confidence: 0.55 + random() * 0.4,
        model: "yolo-e2e",
      },
      risk: {
        overallScore: score,
        perils: [{ peril: "hail", score, hazardValue: frequency, unit: "1/a" }],
        eal,
        ealBreakdown: {
          hail: eal,
          total: eal,
          hailDetail: {
            vehicles,
            exposedVehicles: exposed,
            vehicleSource: "detected",
            zone,
            zoneSource: "postcode",
            frequency,
            meanSeverityEur,
          },
        },
        exposureEur: vehicles * 28_000,
        confidence: 0.5 + random() * 0.45,
        modelVersion: "e2e",
        limitations: ["Screening-Schätzung aus Testdaten."],
        computedAt: "2026-11-14T00:00:00Z",
      },
    };
  });
}

/** Stores the portfolio as the active one and reloads the window onto it. */
export async function seedPortfolio(
  page: Page,
  dealerships: unknown[],
  name = "Testportfolio",
): Promise<void> {
  await page.evaluate(
    async ({ dealerships, name }) => {
      const api = (window as unknown as { api: DrmApi }).api;
      await api.saveSession({
        id: "e2e-portfolio",
        name,
        createdAt: "2026-11-14T00:00:00Z",
        updatedAt: "2026-11-14T00:00:00Z",
        dealerships,
      } as never);
    },
    { dealerships, name },
  );
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
}
