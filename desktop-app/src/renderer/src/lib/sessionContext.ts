import type { AnalyzedDealership } from "@shared/types";
import {
  computePML,
  dealershipHailZone,
  effectiveVehicleCount,
} from "@shared/risk-math";

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
  const pml100 = computePML(dealerships, 100);

  const lines = dealerships
    .slice(0, 40)
    .map(
      (d) =>
        `- ${d.name}: Hail zone ${dealershipHailZone(d)?.zone ?? "n/a"}, Vehicles ${effectiveVehicleCount(
          d.detection,
        )}, Hail EAL ${Math.round(d.risk?.eal ?? 0)}€`,
    )
    .join("\n");

  return [
    `Portfolio with ${count} locations.`,
    `Total exposure: ${Math.round(totalExposure)}€, Total EAL: ${Math.round(totalEal)}€/year.`,
    `PML (100-year, worst cluster): ${pml100.estimatedLossEur}€ across ${pml100.dealershipsInScenario} locations.`,
    `Locations${count > 40 ? " (first 40)" : ""}:`,
    lines,
  ].join("\n");
}
