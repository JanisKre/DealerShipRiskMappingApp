import { coversPeril, sourceLabel } from "./natcat-catalog";
import {
  NAT_CAT_API_PROVIDERS,
  PERILS,
  type NatCatApiProvider,
  type NatCatAssessment,
  type NatCatConnector,
  type NatCatHazard,
  type NatCatPerilSource,
  type NatCatProvider,
  type NatCatSettings,
  type Peril,
} from "./types";

/**
 * Per-peril routing of natural-catastrophe sources (methodology in
 * `docs/risk-model.md`, "Source routing per peril").
 *
 * For each scored peril the first source in this chain that delivers a value
 * wins; if none does, the screening model scores the peril:
 *   1. the source chosen for this peril (if it is an API provider),
 *   2. the location's imported data (ZÜRS Geo),
 *   3. the primary source (if it is an API provider).
 * Choosing "screening" for a peril skips the chain entirely.
 */

export interface NatCatRouting {
  primary: "screening" | NatCatApiProvider;
  perilSources: Partial<Record<Peril, NatCatPerilSource>>;
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
    perilSources: { ...(settings?.perilSources ?? {}) },
    connectors,
  };
}

/** Settings that restore the default: screening for every peril. */
export const DEFAULT_NAT_CAT_ROUTING = {
  provider: "screening",
  primary: "screening",
  perilSources: {},
} as const satisfies Partial<NatCatSettings>;

/** True when every peril is scored by the screening model. */
export function isDefaultRouting(routing: NatCatRouting): boolean {
  return PERILS.every(
    (peril) => resolvedChoice(routing, peril) === "screening",
  );
}

/** The API source a peril resolves to before fallbacks, or "screening". */
export function resolvedChoice(
  routing: NatCatRouting,
  peril: Peril,
): "screening" | NatCatApiProvider {
  const choice = routing.perilSources[peril] ?? "primary";
  if (choice === "primary") return routing.primary;
  return choice;
}

/** API providers the routing needs, limited to connected ones. */
export function sourcesToQuery(routing: NatCatRouting): NatCatApiProvider[] {
  const wanted = new Set<NatCatApiProvider>();
  for (const peril of PERILS) {
    const choice = resolvedChoice(routing, peril);
    if (choice !== "screening") wanted.add(choice);
  }
  return NAT_CAT_API_PROVIDERS.filter(
    (p) => wanted.has(p) && routing.connectors[p]?.endpoint,
  );
}

type Candidate = { id: NatCatProvider; assessment: NatCatAssessment };

/**
 * Combines imported data and API results into the assessment used for
 * scoring. Each hazard keeps its `provider`; a peril that fell back to
 * another source (or to screening) is listed in the evidence limitations.
 * Returns undefined when every peril is left to the screening model.
 */
export function composeNatCat({
  routing,
  imported,
  results,
  now = new Date(),
}: {
  routing: NatCatRouting;
  imported?: NatCatAssessment;
  /** Lookup result per queried API provider; an Error marks a failed lookup. */
  results: Partial<Record<NatCatApiProvider, NatCatAssessment | Error>>;
  now?: Date;
}): NatCatAssessment | undefined {
  const ok = (p: NatCatApiProvider): NatCatAssessment | undefined => {
    const r = results[p];
    return r && !(r instanceof Error) ? r : undefined;
  };
  const hazards: NatCatHazard[] = [];
  const used = new Map<NatCatProvider, NatCatAssessment>();
  const notes: string[] = [];

  for (const peril of PERILS) {
    const choice = routing.perilSources[peril] ?? "primary";
    if (choice === "screening") continue;
    const chain: Array<{ id: NatCatProvider; assessment?: NatCatAssessment }> =
      [];
    if (choice !== "primary")
      chain.push({ id: choice, assessment: ok(choice) });
    if (imported) chain.push({ id: "zuers-geo", assessment: imported });
    if (routing.primary !== "screening" && routing.primary !== choice)
      chain.push({ id: routing.primary, assessment: ok(routing.primary) });

    let found: Candidate | undefined;
    for (const candidate of chain) {
      const hazard = candidate.assessment?.hazards.find(
        (h) => h.peril === peril,
      );
      if (hazard && candidate.assessment) {
        hazards.push({
          ...hazard,
          provider: hazard.provider ?? providerOf(candidate.assessment),
        });
        found = { id: candidate.id, assessment: candidate.assessment };
        used.set(candidate.id, candidate.assessment);
        break;
      }
    }

    // Record a fallback when the API source responsible for this peril did
    // not deliver: it failed or is not connected, or — when chosen for this
    // peril explicitly — answered without it. A primary source that simply
    // does not cover a peril is expected and not a fallback.
    const requested = choice !== "primary" ? choice : routing.primary;
    if (requested !== "screening") {
      const result = results[requested];
      const delivered =
        result &&
        !(result instanceof Error) &&
        result.hazards.some((h) => h.peril === peril);
      const reason =
        result instanceof Error
          ? "unavailable"
          : !result
            ? "not connected"
            : choice !== "primary"
              ? "returned no value"
              : null;
      if (!delivered && reason) {
        notes.push(
          `${peril}: ${sourceLabel(requested)} ${reason}; ${
            found ? sourceLabel(found.id) : "screening model"
          } used instead`,
        );
      }
    }
  }

  // Hazards outside the scored perils (e.g. ZÜRS heavy rain) and attributes:
  // import first, then sources chosen per peril, then the primary source.
  const extraSources: NatCatAssessment[] = [];
  if (imported) extraSources.push(imported);
  for (const peril of PERILS) {
    const choice = routing.perilSources[peril];
    const result =
      choice && choice !== "primary" && choice !== "screening"
        ? ok(choice)
        : undefined;
    if (result && !extraSources.includes(result)) extraSources.push(result);
  }
  const primary =
    routing.primary !== "screening" ? ok(routing.primary) : undefined;
  if (primary && !extraSources.includes(primary)) extraSources.push(primary);

  const scored = new Set<string>(PERILS);
  const attributes: NatCatAssessment["attributes"] = {};
  for (const source of extraSources) {
    for (const hazard of source.hazards) {
      if (scored.has(hazard.peril)) continue;
      if (hazards.some((h) => h.peril === hazard.peril)) continue;
      hazards.push({
        ...hazard,
        provider: hazard.provider ?? providerOf(source),
      });
      used.set(providerOf(source), source);
    }
    for (const [key, value] of Object.entries(source.attributes)) {
      if (!(key in attributes)) attributes[key] = value;
    }
  }

  if (hazards.length === 0) return undefined;
  const sources = [...used.values()];
  const retrievedAt = now.toISOString();

  if (sources.length === 1) {
    const [only] = sources;
    return {
      ...only,
      hazards,
      attributes,
      evidence: {
        ...only.evidence,
        fallbackUsed: only.evidence.fallbackUsed || notes.length > 0,
        limitations: [...only.evidence.limitations, ...notes],
      },
    };
  }

  return {
    provider: "composite",
    retrievedAt,
    hazards,
    attributes,
    evidence: {
      source: sources.map((s) => s.evidence.source).join(" + "),
      retrievedAt,
      method: "Per-peril source routing",
      confidence: Math.min(...sources.map((s) => s.evidence.confidence)),
      fallbackUsed:
        notes.length > 0 || sources.some((s) => s.evidence.fallbackUsed),
      limitations: [
        ...new Set(sources.flatMap((s) => s.evidence.limitations)),
        ...notes,
      ],
    },
  };
}

function providerOf(assessment: NatCatAssessment): NatCatProvider {
  // A composite never enters as a source: imports and API results are
  // single-provider assessments.
  return assessment.provider === "composite"
    ? "custom-api"
    : assessment.provider;
}

/**
 * The import-only part of a stored assessment. Older sessions kept API
 * results in `natCat`; only ZÜRS hazards count as user-supplied data.
 */
export function importedNatCat(dealership: {
  natCat?: NatCatAssessment;
  natCatImport?: NatCatAssessment;
}): NatCatAssessment | undefined {
  if (dealership.natCatImport) return dealership.natCatImport;
  return dealership.natCat?.provider === "zuers-geo"
    ? dealership.natCat
    : undefined;
}

/** Perils a connected API provider can be assigned to (per the catalog). */
export function assignablePerils(provider: NatCatApiProvider): Peril[] {
  return PERILS.filter((peril) => coversPeril(provider, peril));
}
