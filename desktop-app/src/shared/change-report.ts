import type { AnalyzedDealership } from "./types";
import {
  DETECTION_MAX_RESOLUTION_M,
  type ImagerySelection,
} from "./imagery-sources";
import {
  radarHailRank,
  type RadarHailClass,
  type RadarHailResult,
} from "./radar-hail";

/**
 * What changed at a location since it was last analysed, from lookups the
 * app already has: a sharper-or-equal aerial image captured after the one
 * the vehicles were counted on (imagery selection candidates), radar hail
 * cells within 1 km after the analysis (local KONRAD3D archive), and open
 * review points. Pure: the lookups are passed in, so the rule is tested
 * without network access. Runs only when the user asks for it.
 */

export type ChangeKind = "newerImagery" | "radarHail" | "openReview";

export interface LocationChange {
  id: string;
  name: string;
  kinds: ChangeKind[];
  /** Date the location was last analysed (YYYY-MM-DD), if known. */
  analyzedOn: string | null;
  newerImagery: {
    label: string;
    capturedAt: string;
    previousCapturedAt: string;
  } | null;
  /** Radar hail days after the analysis, newest first. */
  hailDays: Array<{ date: string; hailClass: RadarHailClass }>;
  /** Number of open review points (from the review queue rule). */
  openReviewPoints: number;
}

export interface ChangeLookup {
  dealership: AnalyzedDealership;
  /** Imagery selection at the location, null when the lookup failed. */
  imagery: ImagerySelection | null;
  /** Radar hail at the location, null when the lookup failed. */
  radar: RadarHailResult | null;
  /** Open review points of the location (0 when reviewed or none). */
  openReviewPoints: number;
}

/** Date of the last analysis: newest "analyzed" history entry, else the risk timestamp. */
export function lastAnalyzedOn(d: AnalyzedDealership): string | null {
  const history = d.history ?? [];
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].kind === "analyzed") return history[i].at.slice(0, 10);
  }
  return d.risk?.computedAt ? d.risk.computedAt.slice(0, 10) : null;
}

/**
 * The newest candidate that could replace the counted image: dated, sharp
 * enough for vehicle detection, captured after the counted image.
 */
export function newerImageryThan(
  counted: { capturedAt: string | null } | undefined,
  selection: ImagerySelection | null,
): { label: string; capturedAt: string } | null {
  const previous = counted?.capturedAt;
  if (!previous || !selection) return null;
  let best: { label: string; capturedAt: string } | null = null;
  for (const c of selection.candidates) {
    if (!c.capturedAt || c.kind === "esri-wayback") continue;
    if (c.resolutionM == null || c.resolutionM > DETECTION_MAX_RESOLUTION_M)
      continue;
    if (c.capturedAt <= previous) continue;
    if (!best || c.capturedAt > best.capturedAt)
      best = { label: c.label, capturedAt: c.capturedAt };
  }
  return best;
}

export function buildChangeReport(lookups: ChangeLookup[]): LocationChange[] {
  const rows: Array<LocationChange & { eal: number; topHail: number }> = [];
  for (const { dealership: d, imagery, radar, openReviewPoints } of lookups) {
    const analyzedOn = lastAnalyzedOn(d);
    const counted = d.detection?.imagery?.chosen;
    const newer = newerImageryThan(counted, imagery);
    const hailDays = (radar?.days ?? [])
      .filter((day) => analyzedOn == null || day.date > analyzedOn)
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((day) => ({ date: day.date, hailClass: day.hailClass }));
    const kinds: ChangeKind[] = [];
    if (hailDays.length > 0) kinds.push("radarHail");
    if (newer) kinds.push("newerImagery");
    if (openReviewPoints > 0) kinds.push("openReview");
    if (kinds.length === 0) continue;
    rows.push({
      id: d.id,
      name: d.name,
      kinds,
      analyzedOn,
      newerImagery:
        newer && counted?.capturedAt
          ? { ...newer, previousCapturedAt: counted.capturedAt }
          : null,
      hailDays,
      openReviewPoints,
      eal: d.risk?.eal ?? 0,
      topHail: Math.max(0, ...hailDays.map((h) => radarHailRank(h.hailClass))),
    });
  }
  // Hail first (most severe class), then new imagery, then the rest; by EAL within.
  const weight = (r: (typeof rows)[number]): number =>
    r.topHail * 10 + (r.newerImagery ? 5 : 0);
  rows.sort((a, b) => weight(b) - weight(a) || b.eal - a.eal);
  return rows.map(({ eal: _eal, topHail: _topHail, ...row }) => row);
}

export interface ChangeReportCounts {
  locations: number;
  radarHail: number;
  newerImagery: number;
  openReview: number;
}

export function changeReportCounts(rows: LocationChange[]): ChangeReportCounts {
  const count = (kind: ChangeKind): number =>
    rows.filter((r) => r.kinds.includes(kind)).length;
  return {
    locations: rows.length,
    radarHail: count("radarHail"),
    newerImagery: count("newerImagery"),
    openReview: count("openReview"),
  };
}

/** Rows listed in the facts for the optional AI summary. */
export const CHANGE_FACT_ROWS = 20;

/** Plain-text facts for the optional AI summary; every value comes from the report. */
export function changeReportFacts(
  rows: LocationChange[],
  checked: number,
): string {
  const c = changeReportCounts(rows);
  const lines = [
    `Locations checked: ${checked}`,
    `Locations with changes: ${c.locations} (radar hail after analysis: ${c.radarHail}, newer aerial image: ${c.newerImagery}, open review points: ${c.openReview})`,
  ];
  for (const r of rows.slice(0, CHANGE_FACT_ROWS)) {
    const parts: string[] = [];
    if (r.hailDays.length > 0)
      parts.push(
        `radar hail on ${r.hailDays.map((h) => `${h.date} (${h.hailClass})`).join(", ")}`,
      );
    if (r.newerImagery)
      parts.push(
        `newer image ${r.newerImagery.label} from ${r.newerImagery.capturedAt} (vehicles counted on ${r.newerImagery.previousCapturedAt})`,
      );
    if (r.openReviewPoints > 0)
      parts.push(`${r.openReviewPoints} open review points`);
    lines.push(
      `- ${r.name}, last analysed ${r.analyzedOn ?? "unknown"}: ${parts.join("; ")}`,
    );
  }
  return lines.join("\n");
}
