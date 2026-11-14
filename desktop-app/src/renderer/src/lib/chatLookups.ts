import type {
  AnalyzedDealership,
  HailHistory,
  RiskEvidence,
} from "@shared/types";
import type { ImagerySelection } from "@shared/imagery-sources";
import type { RadarHailResult } from "@shared/radar-hail";
import {
  CHAT_TOOL_MAX_LOCATIONS,
  CHAT_TOOL_RESULTS_MAX_CHARS,
  type ChatTool,
  type ChatToolCall,
} from "@shared/chat-tools";
import { newerImageryThan } from "@shared/change-report";
import { dealershipHailZone } from "@shared/risk-math";

/**
 * Renderer side of the optional chat lookups: decides whether a question
 * can refer to a location at all (otherwise no planning call is made), runs
 * the lookups the planner picked with the same IPC calls the detail dialog
 * uses, and writes their results as plain text for the chat model. Notes
 * and full addresses are never included.
 */

/** Only questions about a named or the selected location get lookups. */
export function mayNeedLookups(
  question: string,
  locations: Array<{ name: string }>,
  selectedId: string | null,
): boolean {
  if (selectedId) return true;
  const text = question.toLowerCase();
  return locations.some((l) => {
    const name = l.name.trim().toLowerCase();
    return name.length >= 4 && text.includes(name);
  });
}

/** Locations the planner may choose from: the selected one first, then by hail EAL. */
export function plannerLocations(
  dealerships: AnalyzedDealership[],
  selectedId: string | null,
): Array<{ id: string; name: string }> {
  return [...dealerships]
    .sort(
      (a, b) =>
        Number(b.id === selectedId) - Number(a.id === selectedId) ||
        (b.risk?.eal ?? 0) - (a.risk?.eal ?? 0),
    )
    .slice(0, CHAT_TOOL_MAX_LOCATIONS)
    .map((d) => ({ id: d.id, name: d.name.slice(0, 200) }));
}

const round = (n: number): number => Math.round(n);
const pct = (n: number): string => `${Math.round(n * 100)} %`;

function evidenceLine(e: RiskEvidence): string {
  const parts = [
    e.source,
    e.method,
    e.dataVersion ? `version ${e.dataVersion}` : null,
    e.spatialResolution ? `resolution ${e.spatialResolution}` : null,
    `confidence ${pct(e.confidence)}`,
    e.fallbackUsed ? "fallback used" : null,
  ].filter(Boolean);
  const limits = e.limitations.length
    ? ` Limitations: ${e.limitations.join("; ")}`
    : "";
  return `  - ${parts.join(", ")}.${limits}`;
}

export function formatEvidence(d: AnalyzedDealership): string {
  const lines = [`[evidence] ${d.name}`];
  const detail = d.risk?.ealBreakdown?.hailDetail;
  const zone = dealershipHailZone(d);
  if (!d.risk) {
    lines.push("  Not analysed yet.");
    return lines.join("\n");
  }
  lines.push(
    `  Hail EAL ${round(d.risk.eal)} EUR (screening estimate; frequency and severity are uncalibrated placeholder values).`,
  );
  if (detail) {
    lines.push(
      `  Inputs: ${round(detail.vehicles)} vehicles (${detail.vehicleSource}), ${round(detail.exposedVehicles)} parked in the open, hail zone ${detail.zone} (${detail.zoneSource}), ${detail.frequency} damaging hail events per year, ${round(detail.meanSeverityEur)} EUR expected loss per exposed vehicle and event.`,
    );
    if (detail.stockRange)
      lines.push(
        `  EAL over ${detail.stockRange.images} archived stock counts: ${round(detail.stockRange.ealLow)} to ${round(detail.stockRange.ealHigh)} EUR, median ${round(detail.stockRange.ealMedian)} (current count is ${detail.stockRange.snapshot}).`,
      );
  } else if (zone) {
    lines.push(`  Hail zone ${zone.zone} (${zone.source}).`);
  }
  if (d.boundary) {
    lines.push(
      `  Lot boundary: source ${d.boundary.source}${d.boundary.provider ? ` (${d.boundary.provider})` : ""}, role ${d.boundary.role ?? "unknown"}, ${round(d.boundary.areaSqm)} m², confidence ${pct(d.boundary.confidence)}${d.boundary.reviewRequired ? ", needs review" : ""}.`,
    );
  }
  const image = d.detection?.imagery?.chosen;
  if (image)
    lines.push(
      `  Vehicles counted on ${image.label}, captured ${image.capturedAt ?? "date unknown"}, ${image.resolutionM ?? "?"} m per pixel.`,
    );
  const evidence = [
    ...(d.risk.evidence ?? []),
    ...(d.boundary?.evidence ? [d.boundary.evidence] : []),
    ...(d.detection?.evidence ? [d.detection.evidence] : []),
  ];
  if (evidence.length) {
    lines.push("  Sources:");
    for (const e of evidence) lines.push(evidenceLine(e));
  }
  if (d.risk.limitations?.length)
    lines.push(`  Limitations: ${d.risk.limitations.join("; ")}`);
  return lines.join("\n");
}

export function formatHailHistory(name: string, h: HailHistory): string {
  const lines = [
    `[hailHistory] ${name} — DWD weather stations within ${h.searchRadiusKm} km (station observations; a storm that misses a station is not recorded)`,
  ];
  if (h.stations.length === 0) lines.push("  No station with enough records.");
  for (const s of h.stations) {
    lines.push(
      `  - ${s.name}, ${s.distanceKm.toFixed(1)} km: ${s.hailDays} hail days in ${s.yearsObserved} observed years (${s.firstYear}–${s.lastYear}), ${s.hailDaysPerYear.toFixed(2)} per year; latest ${s.recentHailDates.slice(0, 5).join(", ") || "none"}`,
    );
  }
  if (h.evidence.limitations.length)
    lines.push(`  Limitations: ${h.evidence.limitations.join("; ")}`);
  return lines.join("\n");
}

export function formatRadarHail(name: string, r: RadarHailResult): string {
  const lines = [
    `[radarHail] ${name} — DWD KONRAD3D radar hail cells within ${r.radiusKm} km, local archive ${r.archiveFrom ?? "empty"} to ${r.archiveTo ?? "empty"} (context only, not in the EAL)`,
  ];
  if (r.days.length === 0) lines.push("  No hail cell in the archive.");
  for (const day of r.days.slice(0, 15)) {
    lines.push(
      `  - ${day.date}: ${day.hailClass}, ${day.distanceKm === 0 ? "over the site" : `${day.distanceKm.toFixed(1)} km away`}, max ${round(day.maxDbz)} dBZ`,
    );
  }
  if (r.evidence.limitations.length)
    lines.push(`  Limitations: ${r.evidence.limitations.join("; ")}`);
  return lines.join("\n");
}

export function formatImagery(
  d: AnalyzedDealership,
  selection: ImagerySelection,
): string {
  const counted = d.detection?.imagery?.chosen;
  const newer = newerImageryThan(counted, selection);
  const lines = [`[imagery] ${d.name}`];
  lines.push(
    counted
      ? `  Vehicles counted on ${counted.label}, captured ${counted.capturedAt ?? "date unknown"}.`
      : "  No record of the image the vehicles were counted on.",
  );
  lines.push(
    `  Image the app would pick now: ${selection.chosen.label}, captured ${selection.chosen.capturedAt ?? "date unknown"}, ${selection.chosen.resolutionM ?? "?"} m per pixel.`,
  );
  lines.push(
    newer
      ? `  A newer image sharp enough for vehicle counting exists: ${newer.label} from ${newer.capturedAt}. Re-analysing would count on it.`
      : "  No newer image sharp enough for vehicle counting.",
  );
  return lines.join("\n");
}

export interface LookupApi {
  hailHistory: (lat: number, lon: number) => Promise<HailHistory>;
  radarHail: (lat: number, lon: number) => Promise<RadarHailResult>;
  selectImagery: (
    lat: number,
    lon: number,
    zoom: number,
  ) => Promise<ImagerySelection>;
}

export interface LookupRun {
  /** Text for the chat model, capped at {@link CHAT_TOOL_RESULTS_MAX_CHARS}. */
  results: string;
  /** What was looked up, for the line above the answer. */
  done: Array<{ tool: ChatTool; name: string; ok: boolean }>;
}

/** Runs the planned lookups; a failed one is reported as failed, not retried. */
export async function runChatLookups(
  calls: ChatToolCall[],
  dealerships: AnalyzedDealership[],
  api: LookupApi,
): Promise<LookupRun> {
  const byId = new Map(dealerships.map((d) => [d.id, d]));
  const parts = await Promise.all(
    calls.map(async (call) => {
      const d = byId.get(call.locationId);
      if (!d) return null;
      try {
        switch (call.tool) {
          case "evidence":
            return { call, d, text: formatEvidence(d) };
          case "hailHistory":
            return {
              call,
              d,
              text: formatHailHistory(
                d.name,
                await api.hailHistory(d.lat, d.lon),
              ),
            };
          case "radarHail":
            return {
              call,
              d,
              text: formatRadarHail(d.name, await api.radarHail(d.lat, d.lon)),
            };
          case "imagery":
            return {
              call,
              d,
              text: formatImagery(d, await api.selectImagery(d.lat, d.lon, 19)),
            };
        }
      } catch {
        return {
          call,
          d,
          text: `[${call.tool}] ${d.name}: lookup failed.`,
          failed: true,
        };
      }
    }),
  );
  const done: LookupRun["done"] = [];
  let results = "";
  for (const part of parts) {
    if (!part) continue;
    done.push({
      tool: part.call.tool,
      name: part.d.name,
      ok: !("failed" in part),
    });
    const next = results ? `${results}\n\n${part.text}` : part.text;
    results =
      next.length > CHAT_TOOL_RESULTS_MAX_CHARS
        ? next.slice(0, CHAT_TOOL_RESULTS_MAX_CHARS)
        : next;
  }
  return { results, done };
}
