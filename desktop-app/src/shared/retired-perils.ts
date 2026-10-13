import {
  PERILS,
  RETIRED_NAT_CAT_PROVIDERS,
  type AnalyzedDealership,
  type NatCatAssessment,
} from "./types";

/**
 * Sessions saved before the hail-only model (screening-0.5.0) carry storm,
 * lightning, snow, flood and heat scores and data from the ZÜRS import or
 * flood specialists. This strips them on load so the session validates
 * against the hail-only schemas when it is saved again; hail values are kept
 * unchanged.
 */
export function stripRetiredPerils(
  dealership: AnalyzedDealership,
): AnalyzedDealership {
  const out: AnalyzedDealership & { natCatImport?: unknown } = {
    ...dealership,
  };
  delete out.natCatImport;
  const natCat = hailOnly(out.natCat);
  if (natCat) out.natCat = natCat;
  else delete out.natCat;
  if (out.risk) {
    const risk = {
      ...out.risk,
      perils: out.risk.perils.filter((p) =>
        (PERILS as readonly string[]).includes(p.peril),
      ),
    };
    const riskNatCat = hailOnly(risk.natCat);
    if (riskNatCat) risk.natCat = riskNatCat;
    else delete risk.natCat;
    out.risk = risk;
  }
  return out;
}

function hailOnly(
  assessment: NatCatAssessment | undefined,
): NatCatAssessment | undefined {
  if (!assessment || isRetired(assessment.provider)) return undefined;
  const hazards = assessment.hazards.filter(
    (h) => h.peril === "hail" && !isRetired(h.provider),
  );
  return hazards.length > 0 ? { ...assessment, hazards } : undefined;
}

function isRetired(provider: string | undefined): boolean {
  return (
    RETIRED_NAT_CAT_PROVIDERS as readonly (string | undefined)[]
  ).includes(provider);
}
