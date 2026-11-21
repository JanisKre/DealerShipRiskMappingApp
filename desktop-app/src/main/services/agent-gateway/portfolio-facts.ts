import { resolveAll } from "@shared/site-questions";
import { postcodeAndTown } from "@shared/address-parts";
import type { AnalyzedDealership, Session } from "@shared/types";
import { lastAnalyzedOn } from "@shared/change-report";
import { ealCoverage, ealSortValue, hasEalBasis } from "@shared/estimates";
import {
  challengeAssumptions,
  type Challenge,
} from "@shared/assumption-challenge";
import {
  dealershipHailZone,
  displayedHailVehicleSource,
  effectiveVehicleCount,
} from "@shared/risk-math";

/**
 * What the agent gateway (MCP, A2A, AG-UI) tells other tools about a
 * portfolio. Pure functions over a stored session.
 *
 * Data minimisation, same as the chat lookups: no underwriting notes, no
 * change history, no street address, no coordinates, no geometry. Every
 * result carries the method and its limitations so a figure is never passed
 * on without its qualification.
 */

export const SCREENING_LIMITATIONS = [
  "Hail EAL = vehicles counted on the lot × damaging hail events per year in the hail zone × expected loss per vehicle and event.",
  "All amounts are screening estimates, not an insurance, engineering or legal decision.",
  "Hail frequency and loss per vehicle are uncalibrated placeholder values unless the user calibrated them.",
  "A location without a vehicle count has no hail EAL (not 0 EUR) and is left out of totals.",
] as const;

export interface LocationRow {
  id: string;
  name: string;
  /** "01237 Dresden": postcode and town only. */
  place: string | null;
  status: "insured" | "prospect" | "unknown";
  analyzed: boolean;
  hailZone: number | null;
  hailZoneSource: string | null;
  vehicles: number | null;
  vehicleSource: string | null;
  /** null: no vehicle count, so no EAL. */
  hailEalEur: number | null;
  exposureEur: number | null;
  boundarySource: string | null;
  boundaryConfidence: number | null;
  needsReview: boolean;
  imageCapturedAt: string | null;
  analyzedOn: string | null;
}

function placeOf(address: string | undefined): string | null {
  return postcodeAndTown(address) ?? null;
}

export function locationRow(d: AnalyzedDealership): LocationRow {
  const zone = dealershipHailZone(d);
  const detail = d.risk?.ealBreakdown?.hailDetail;
  const source = d.risk
    ? displayedHailVehicleSource(detail?.vehicleSource, d.detection)
    : null;
  return {
    id: d.id,
    name: d.name,
    place: placeOf(d.address),
    status:
      d.insured === true
        ? "insured"
        : d.insured === false
          ? "prospect"
          : "unknown",
    analyzed: d.risk != null,
    hailZone: zone?.zone ?? null,
    hailZoneSource: zone?.source ?? null,
    vehicles:
      d.detection || detail
        ? Math.round(detail?.vehicles ?? effectiveVehicleCount(d.detection))
        : null,
    vehicleSource: source,
    hailEalEur: hasEalBasis(d) ? Math.round(d.risk!.eal) : null,
    exposureEur:
      d.risk?.exposureEur != null ? Math.round(d.risk.exposureEur) : null,
    boundarySource: d.boundary?.source ?? null,
    boundaryConfidence: d.boundary?.confidence ?? null,
    needsReview: Boolean(d.boundary?.reviewRequired && !d.boundary.confirmedAt),
    imageCapturedAt: d.detection?.imagery?.chosen.capturedAt ?? null,
    analyzedOn: lastAnalyzedOn(d),
  };
}

export const LOCATION_SORTS = ["eal", "hailZone", "vehicles", "name"] as const;
export type LocationSort = (typeof LOCATION_SORTS)[number];
export const LOCATIONS_MAX_LIMIT = 200;

export interface LocationQuery {
  sortBy?: LocationSort;
  minHailZone?: number;
  reviewOnly?: boolean;
  limit?: number;
  offset?: number;
}

export function listLocations(
  session: Session,
  query: LocationQuery = {},
): { total: number; offset: number; locations: LocationRow[] } {
  const sortBy = query.sortBy ?? "eal";
  const sorted = [...session.dealerships].sort((a, b) => {
    if (sortBy === "name") return a.name.localeCompare(b.name);
    if (sortBy === "hailZone") {
      return (
        (dealershipHailZone(b)?.zone ?? 0) -
          (dealershipHailZone(a)?.zone ?? 0) || a.name.localeCompare(b.name)
      );
    }
    if (sortBy === "vehicles") {
      return (
        effectiveVehicleCount(b.detection) -
          effectiveVehicleCount(a.detection) || a.name.localeCompare(b.name)
      );
    }
    return ealSortValue(b) - ealSortValue(a) || a.name.localeCompare(b.name);
  });
  const rows = sorted.map(locationRow).filter((row) => {
    if (query.minHailZone != null && (row.hailZone ?? 0) < query.minHailZone)
      return false;
    if (query.reviewOnly && !row.needsReview) return false;
    return true;
  });
  const offset = Math.max(0, Math.floor(query.offset ?? 0));
  const limit = Math.min(
    LOCATIONS_MAX_LIMIT,
    Math.max(1, Math.floor(query.limit ?? 50)),
  );
  return {
    total: rows.length,
    offset,
    locations: rows.slice(offset, offset + limit),
  };
}

export interface PortfolioSummary {
  portfolioId: string;
  name: string;
  updatedAt: string;
  locations: number;
  analyzed: number;
  /** Locations whose EAL rests on a vehicle count. */
  withHailEal: number;
  totalHailEalEur: number;
  totalExposureEur: number;
  totalVehicles: number;
  needsReview: number;
  /** Locations per hail zone 1–6; "unknown" for locations without a zone. */
  hailZones: Record<string, number>;
  topByHailEal: LocationRow[];
  limitations: string[];
}

export const SUMMARY_TOP_LOCATIONS = 10;

export function portfolioSummary(session: Session): PortfolioSummary {
  const rows = session.dealerships.map(locationRow);
  const coverage = ealCoverage(session.dealerships);
  const hailZones: Record<string, number> = {};
  for (const row of rows) {
    const key = row.hailZone == null ? "unknown" : String(row.hailZone);
    hailZones[key] = (hailZones[key] ?? 0) + 1;
  }
  const sum = (pick: (row: LocationRow) => number | null): number =>
    rows.reduce((total, row) => total + (pick(row) ?? 0), 0);
  return {
    portfolioId: session.id,
    name: session.name,
    updatedAt: session.updatedAt,
    locations: rows.length,
    analyzed: coverage.analyzed,
    withHailEal: coverage.withBasis,
    totalHailEalEur: sum((row) => row.hailEalEur),
    totalExposureEur: sum((row) => row.exposureEur),
    totalVehicles: sum((row) => row.vehicles),
    needsReview: rows.filter((row) => row.needsReview).length,
    hailZones,
    topByHailEal: listLocations(session, {
      limit: SUMMARY_TOP_LOCATIONS,
    }).locations.filter((row) => row.hailEalEur != null),
    limitations: [...SCREENING_LIMITATIONS],
  };
}

export interface LocationEvidence {
  location: LocationRow;
  hailEalInputs: {
    vehicles: number;
    exposedVehicles: number;
    vehicleSource: string;
    hailZone: number;
    hailZoneSource: string;
    eventsPerYear: number;
    lossPerVehicleAndEventEur: number;
    stockRange: {
      images: number;
      vehiclesLow: number;
      vehiclesMedian: number;
      vehiclesHigh: number;
      snapshot: string;
    } | null;
  } | null;
  modelVersion: string | null;
  resultConfidence: number | null;
  /** Provenance of each input, as stored with the result. */
  evidence: Array<{
    source: string;
    method: string;
    retrievedAt: string;
    confidence: number;
    fallbackUsed: boolean;
    limitations: string[];
  }>;
  boundary: {
    source: string;
    confidence: number;
    areaSqm: number;
    reviewRequired: boolean;
    confirmed: boolean;
    reviewFlags: string[];
    reasons: string[];
  } | null;
  weakestAssumptions: Challenge[];
  /** Answered site questions, as the app shows them (site-questions.ts). */
  siteQuestions: Array<{
    question: string;
    answer: string;
    source: string;
    engine?: string;
    model?: string;
    imageDate?: string | null;
  }>;
  limitations: string[];
}

export function locationEvidence(
  session: Session,
  locationId: string,
): LocationEvidence | null {
  const d = session.dealerships.find((x) => x.id === locationId);
  if (!d) return null;
  const detail = d.risk?.ealBreakdown?.hailDetail;
  return {
    location: locationRow(d),
    hailEalInputs: detail
      ? {
          vehicles: detail.vehicles,
          exposedVehicles: detail.exposedVehicles,
          vehicleSource: displayedHailVehicleSource(
            detail.vehicleSource,
            d.detection,
          ),
          hailZone: detail.zone,
          hailZoneSource: detail.zoneSource,
          eventsPerYear: detail.frequency,
          lossPerVehicleAndEventEur: detail.meanSeverityEur,
          stockRange: detail.stockRange
            ? {
                images: detail.stockRange.images,
                vehiclesLow: detail.stockRange.vehiclesLow,
                vehiclesMedian: detail.stockRange.vehiclesMedian,
                vehiclesHigh: detail.stockRange.vehiclesHigh,
                snapshot: detail.stockRange.snapshot,
              }
            : null,
        }
      : null,
    modelVersion: d.risk?.modelVersion ?? null,
    resultConfidence: d.risk?.confidence ?? null,
    evidence: (d.risk?.evidence ?? []).map((e) => ({
      source: e.source,
      method: e.method,
      retrievedAt: e.retrievedAt,
      confidence: e.confidence,
      fallbackUsed: e.fallbackUsed,
      limitations: e.limitations,
    })),
    boundary: d.boundary
      ? {
          source: d.boundary.source,
          confidence: d.boundary.confidence,
          areaSqm: Math.round(d.boundary.areaSqm),
          reviewRequired: Boolean(d.boundary.reviewRequired),
          confirmed: d.boundary.confirmedAt != null,
          reviewFlags: d.boundary.quality?.reviewFlags ?? [],
          reasons: d.boundary.quality?.reasons ?? [],
        }
      : null,
    weakestAssumptions: challengeAssumptions(d, session.parameters),
    // Observations next to the result; they change neither count nor EAL.
    siteQuestions: resolveAll(d.siteAnswers).flatMap((r) =>
      r.answer
        ? [
            {
              question: r.question,
              answer: r.value,
              source: r.answer.source,
              ...(r.answer.source === "model"
                ? {
                    engine: r.answer.engine,
                    model: r.answer.model,
                    imageDate: r.answer.imageCapturedAt ?? null,
                  }
                : {}),
            },
          ]
        : [],
    ),
    limitations: [...(d.risk?.limitations ?? []), ...SCREENING_LIMITATIONS],
  };
}

/** Compact text of a portfolio for the AG-UI chat (system prompt data block). */
export function portfolioContextText(
  session: Session,
  maxLocations = 100,
): string {
  const summary = portfolioSummary(session);
  const { locations } = listLocations(session, { limit: maxLocations });
  const line = (row: LocationRow): string =>
    [
      row.name,
      row.place,
      row.status,
      row.hailZone != null
        ? `hail zone ${row.hailZone} (${row.hailZoneSource})`
        : "hail zone n/a",
      row.vehicles != null
        ? `vehicles ${row.vehicles} (${row.vehicleSource ?? "n/a"})`
        : "not analysed",
      row.hailEalEur != null
        ? `hail EAL ${row.hailEalEur} EUR`
        : "hail EAL n/a",
      row.needsReview ? "needs review" : null,
    ]
      .filter(Boolean)
      .join(" | ");
  return [
    `Portfolio "${summary.name}": ${summary.locations} locations, ${summary.analyzed} analysed, ${summary.withHailEal} with a hail EAL.`,
    `Total hail EAL ${summary.totalHailEalEur} EUR (screening estimate), total exposure ${summary.totalExposureEur} EUR, ${summary.totalVehicles} vehicles, ${summary.needsReview} locations need review.`,
    `Locations (highest hail EAL first${session.dealerships.length > locations.length ? `, first ${locations.length} of ${session.dealerships.length}` : ""}):`,
    ...locations.map(line),
  ].join("\n");
}

/** Short readable text of a summary (A2A artifact, MCP text content). */
export function summaryText(summary: PortfolioSummary): string {
  const top = summary.topByHailEal
    .slice(0, 5)
    .map(
      (row) => `${row.name} (${row.hailEalEur} EUR, hail zone ${row.hailZone})`,
    )
    .join("; ");
  return [
    `Portfolio "${summary.name}": ${summary.locations} locations, ${summary.analyzed} analysed, ${summary.withHailEal} with a hail EAL.`,
    `Total hail EAL: ${summary.totalHailEalEur} EUR per year (screening estimate). Total exposure: ${summary.totalExposureEur} EUR. ${summary.needsReview} locations need review.`,
    top ? `Highest hail EAL: ${top}.` : "No location has a hail EAL yet.",
  ].join("\n");
}
