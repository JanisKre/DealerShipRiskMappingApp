import type { AnalyzedDealership } from "@shared/types";
import { computePML } from "@shared/risk-math";

/**
 * Compact portfolio context as a string for the LLM streams (summary/chat).
 * Contains aggregate metrics + a concise location list (max. 40), so the
 * prompt stays compact.
 */
export function buildSessionContext(dealerships: AnalyzedDealership[]): string {
  const count = dealerships.length;
  const totalExposure = dealerships.reduce(
    (a, d) => a + (d.risk?.exposureEur ?? 0),
    0,
  );
  const totalEal = dealerships.reduce((a, d) => a + (d.risk?.eal ?? 0), 0);
  const avgScore =
    count > 0
      ? dealerships.reduce((a, d) => a + (d.risk?.overallScore ?? 0), 0) / count
      : 0;
  const pml100 = computePML(dealerships, 100);

  const lines = dealerships
    .slice(0, 40)
    .map((d) => {
      const peril = (n: string): number =>
        d.risk?.perils.find((p) => p.peril === n)?.score ?? 0;
      return `- ${d.name}: Score ${Math.round(d.risk?.overallScore ?? 0)}, Vehicles ${
        d.detection?.vehicleCount ?? 0
      }, EAL ${Math.round(d.risk?.eal ?? 0)}€, Hail ${peril("hail")}, Wind ${peril("wind")}, Flood ${peril("flood")}`;
    })
    .join("\n");

  return [
    `Portfolio with ${count} locations.`,
    `Total exposure: ${Math.round(totalExposure)}€, Total EAL: ${Math.round(totalEal)}€/year, Avg score: ${avgScore.toFixed(1)}.`,
    `PML (100-year, worst cluster): ${pml100.estimatedLossEur}€ across ${pml100.dealershipsInScenario} locations.`,
    `Locations${count > 40 ? " (first 40)" : ""}:`,
    lines,
  ].join("\n");
}
