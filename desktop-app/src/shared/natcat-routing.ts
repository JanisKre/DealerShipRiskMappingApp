import {
  NAT_CAT_API_PROVIDERS,
  type NatCatApiProvider,
  type NatCatAssessment,
  type NatCatConnector,
  type NatCatSettings,
} from "./types";

/**
 * Source of the hail score (methodology in `docs/risk-model.md`, "NatCat
 * source"). The screening model scores hail unless an API provider is chosen
 * and connected; a provider that fails or answers without a hail value falls
 * back to screening.
 */

export interface NatCatRouting {
  primary: "screening" | NatCatApiProvider;
  connectors: Partial<Record<NatCatApiProvider, NatCatConnector>>;
}

/** Routing from the settings, including the legacy single-provider fields. */
export function effectiveNatCatRouting(
  settings: NatCatSettings | undefined,
): NatCatRouting {
  const connectors: NatCatRouting["connectors"] = {
    ...(settings?.connectors ?? {}),
  };
  if (!connectors["swissre-catnet"] && settings?.catnetEndpoint) {
    connectors["swissre-catnet"] = {
      endpoint: settings.catnetEndpoint,
      hasApiKey: settings.catnetHasApiKey,
    };
  }
  const legacyPrimary =
    settings?.provider === "swissre-catnet" ? "swissre-catnet" : "screening";
  return {
    primary: settings?.primary ?? legacyPrimary,
    connectors,
  };
}

/** Settings that restore the default: screening scores hail. */
export const DEFAULT_NAT_CAT_ROUTING = {
  provider: "screening",
  primary: "screening",
} as const satisfies Partial<NatCatSettings>;

/** True when hail is scored by the screening model. */
export function isDefaultRouting(routing: NatCatRouting): boolean {
  return routing.primary === "screening";
}

/** API providers the routing needs, limited to connected ones. */
export function sourcesToQuery(routing: NatCatRouting): NatCatApiProvider[] {
  return NAT_CAT_API_PROVIDERS.filter(
    (p) => p === routing.primary && routing.connectors[p]?.endpoint,
  );
}

/**
 * The provider's hail assessment used for scoring. The hazard keeps its
 * `provider`; any other hazard the endpoint returns is not used. Returns
 * undefined when hail is left to the screening model or the provider did not
 * deliver a hail value.
 */
export function composeNatCat({
  routing,
  results,
}: {
  routing: NatCatRouting;
  /** Lookup result per queried API provider; an Error marks a failed lookup. */
  results: Partial<Record<NatCatApiProvider, NatCatAssessment | Error>>;
}): NatCatAssessment | undefined {
  if (routing.primary === "screening") return undefined;
  const result = results[routing.primary];
  if (!result || result instanceof Error) return undefined;
  const hail = result.hazards.find((h) => h.peril === "hail");
  if (!hail) return undefined;
  return {
    ...result,
    hazards: [{ ...hail, provider: hail.provider ?? providerOf(result) }],
  };
}

function providerOf(assessment: NatCatAssessment): NatCatApiProvider {
  // API results are single-provider assessments; "composite" only occurs in
  // sessions saved by older builds.
  return assessment.provider === "composite"
    ? "custom-api"
    : assessment.provider;
}
