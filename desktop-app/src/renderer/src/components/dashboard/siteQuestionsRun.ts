import type { AnalyzedDealership } from "@shared/types";
import type { DecisionEngine } from "@shared/site-questions";

/** Locations one run looks at; more wait for the next run. */
export const SITE_RUN_MAX = 200;

/**
 * Locations to ask the engine about: analysed ones (they have the image the
 * count was made on) that this engine has not answered yet, highest hail
 * EAL first, so a stopped run has covered the locations that matter most.
 */
export function siteRunCandidates(
  dealerships: readonly AnalyzedDealership[],
  engine: DecisionEngine,
): string[] {
  return dealerships
    .filter(
      (d) =>
        d.risk != null &&
        !(d.siteAnswers ?? []).some(
          (a) => a.source === "model" && a.engine === engine,
        ),
    )
    .sort((a, b) => (b.risk?.eal ?? 0) - (a.risk?.eal ?? 0))
    .slice(0, SITE_RUN_MAX)
    .map((d) => d.id);
}
