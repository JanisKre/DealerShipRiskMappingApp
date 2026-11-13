import type { AnalyzedDealership, RiskParameters } from "@shared/types";
import { LLM_CONTEXT_MAX_CHARS } from "@shared/ipc-schema";
import { DEFAULT_RISK_PARAMETERS } from "@shared/parameters";
import {
  computeAccumulationClusters,
  computePML,
  dealershipHailZone,
  displayedHailVehicleSource,
  effectiveVehicleCount,
} from "@shared/risk-math";

/** Locations listed one per line; the rest is summarised. */
export const CONTEXT_MAX_LOCATIONS = 100;

/** Accumulation clusters listed, largest modelled loss first. */
const CONTEXT_MAX_CLUSTERS = 5;

export interface SessionContextOptions {
  parameters?: RiskParameters;
  /** Location selected on the map, so "this site" can be resolved. */
  selectedId?: string | null;
}

const round = (value: number): number => Math.round(value);

/** "01237 Dresden" from a German address line; never the street. */
function postcodeAndTown(address: string | undefined): string | undefined {
  const match = address?.match(/\b(\d{5})\s+([^,]+)/);
  return match ? `${match[1]} ${match[2].trim()}` : undefined;
}

function status(d: AnalyzedDealership): string {
  if (d.insured === true) return "insured";
  if (d.insured === false) return "prospect";
  return "status unknown";
}

function vehiclesField(d: AnalyzedDealership): string {
  const detail = d.risk?.ealBreakdown?.hailDetail;
  const total = detail?.vehicles ?? effectiveVehicleCount(d.detection);
  const parts = [`vehicles ${round(total)}`];
  if (detail) parts.push(`exposed ${round(detail.exposedVehicles)}`);
  // "estimated": lot area ÷ space per vehicle, no detection model ran.
  const source = displayedHailVehicleSource(detail?.vehicleSource, d.detection);
  parts.push(source);
  const imageDate = d.detection?.imagery?.chosen.capturedAt?.slice(0, 7);
  if (imageDate) parts.push(`image ${imageDate}`);
  return `${parts[0]} (${parts.slice(1).join(", ")})`;
}

/** One compact line per location; fields are explained in the system prompt. */
export function locationLine(d: AnalyzedDealership, selected: boolean): string {
  const zone = dealershipHailZone(d);
  const fields = [
    d.name,
    postcodeAndTown(d.address),
    status(d),
    zone ? `hail zone ${zone.zone} (${zone.source})` : "hail zone n/a",
    vehiclesField(d),
    d.risk?.exposureEur != null
      ? `exposure ${round(d.risk.exposureEur)} €`
      : undefined,
    d.risk ? `hail EAL ${round(d.risk.eal)} €` : "not analysed",
    d.productLimitEur != null
      ? `limit ${round(d.productLimitEur)} €`
      : undefined,
    d.boundary?.reviewRequired ? "needs review" : undefined,
    d.group ? `group ${d.group}` : undefined,
    d.salesPartner ? `partner ${d.salesPartner}` : undefined,
    selected ? "SELECTED" : undefined,
  ].filter(Boolean);
  return `- ${fields.join(" | ")}`;
}

/**
 * Portfolio context for the LLM streams (chat, NL query): aggregates, the
 * hail-zone distribution, the largest accumulation clusters and one line
 * per location, highest hail EAL first. Underwriting notes are never
 * included, and only postcode and town of an address.
 */
export function buildSessionContext(
  dealerships: AnalyzedDealership[],
  options: SessionContextOptions = {},
): string {
  const parameters = options.parameters ?? DEFAULT_RISK_PARAMETERS;
  const count = dealerships.length;
  if (count === 0) return "The portfolio is empty: no locations loaded.";

  const sum = (pick: (d: AnalyzedDealership) => number): number =>
    dealerships.reduce((acc, d) => acc + pick(d), 0);
  const totalExposure = sum((d) => d.risk?.exposureEur ?? 0);
  const totalEal = sum((d) => d.risk?.eal ?? 0);
  const totalVehicles = sum((d) => effectiveVehicleCount(d.detection));
  const insured = dealerships.filter((d) => d.insured === true).length;
  const prospects = dealerships.filter((d) => d.insured === false).length;
  const review = dealerships.filter((d) => d.boundary?.reviewRequired).length;
  const notAnalysed = dealerships.filter((d) => !d.risk).length;
  const pml100 = computePML(dealerships, 100, parameters);

  const zones = new Map<string, { n: number; eal: number }>();
  for (const d of dealerships) {
    const key = String(dealershipHailZone(d)?.zone ?? "n/a");
    const entry = zones.get(key) ?? { n: 0, eal: 0 };
    entry.n += 1;
    entry.eal += d.risk?.eal ?? 0;
    zones.set(key, entry);
  }
  const zoneLine = [...zones.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([z, e]) => `zone ${z}: ${e.n} (EAL ${round(e.eal)} €)`)
    .join("; ");

  const byId = new Map(dealerships.map((d) => [d.id, d]));
  const clusters = computeAccumulationClusters(
    dealerships,
    parameters.accumulationRadiusKm,
    parameters,
  )
    .filter((c) => c.count >= 2)
    .sort((a, b) => b.natCatKpiEur - a.natCatKpiEur)
    .slice(0, CONTEXT_MAX_CLUSTERS)
    .map(
      (c, i) =>
        `- Cluster ${i + 1}: ${c.count} locations (${c.memberIds
          .map((id) => byId.get(id)?.name ?? id)
          .join(", ")}), ${c.totalVehicles} vehicles, exposure ${round(
          c.totalExposureEur,
        )} €, hail EAL ${round(c.totalEalEur)} €, modelled cluster loss ${round(
          c.natCatKpiEur,
        )} €`,
    );

  const sorted = [...dealerships].sort(
    (a, b) => (b.risk?.eal ?? 0) - (a.risk?.eal ?? 0),
  );
  const listed = sorted.slice(0, CONTEXT_MAX_LOCATIONS);
  const selected = options.selectedId ? byId.get(options.selectedId) : null;
  // A selected location outside the top list is still listed.
  if (selected && !listed.includes(selected)) listed.push(selected);
  const rest = sorted
    .slice(CONTEXT_MAX_LOCATIONS)
    .filter((d) => d !== selected);

  const text = [
    `Portfolio: ${count} locations (${insured} insured, ${prospects} prospects, ${count - insured - prospects} status unknown).`,
    `Totals: ${round(totalVehicles)} vehicles, exposure ${round(totalExposure)} €, hail EAL ${round(totalEal)} € per year.`,
    `PML 100-year (worst cluster within ${pml100.clusterRadiusKm} km): ${round(pml100.estimatedLossEur)} € across ${pml100.dealershipsInScenario} locations.`,
    `Hail zones: ${zoneLine}.`,
    `Needing review: ${review}. Not yet analysed: ${notAnalysed}.`,
    selected
      ? `Selected on the map: ${selected.name}.`
      : "No location is selected on the map.",
    "",
    `Accumulation clusters (locations within ${parameters.accumulationRadiusKm} km of each other)${
      clusters.length ? ":" : ": none."
    }`,
    ...clusters,
    "",
    `Locations, highest hail EAL first${
      rest.length ? ` (top ${CONTEXT_MAX_LOCATIONS} of ${count})` : ""
    }:`,
    ...listed.map((d) => locationLine(d, d === selected)),
    ...(rest.length
      ? [
          `- … ${rest.length} more locations with together hail EAL ${round(
            rest.reduce((acc, d) => acc + (d.risk?.eal ?? 0), 0),
          )} € (not listed).`,
        ]
      : []),
  ].join("\n");
  return fitContext(text);
}

/** Cuts whole lines off the end so the request passes the IPC bound. */
export function fitContext(
  text: string,
  maxChars: number = LLM_CONTEXT_MAX_CHARS,
): string {
  if (text.length <= maxChars) return text;
  const note = "\n- … list truncated (context limit).";
  const cut = text.lastIndexOf("\n", maxChars - note.length);
  return `${text.slice(0, Math.max(cut, 0))}${note}`;
}
