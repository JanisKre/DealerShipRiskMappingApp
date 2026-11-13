import type { Settings } from "@shared/types";
import { redactSecrets } from "./log.service";

/**
 * Contents of a diagnostics report for support. Deliberately without the
 * portfolios: only versions, the environment, the (secret-free) settings,
 * record counts and the recent log, which can name analysed locations.
 */
export interface DiagnosticsInput {
  generatedAt: Date;
  app: { name: string; version: string; packaged: boolean };
  runtime: Record<string, string | undefined>;
  os: { platform: string; arch: string; release: string; locale: string };
  settings: Settings;
  data: Record<string, number | null>;
  detectionModelInstalled: boolean;
  log: string;
}

export interface DiagnosticsReport {
  format: "dealership-risk-mapping/diagnostics@1";
  generatedAt: string;
  app: DiagnosticsInput["app"];
  runtime: DiagnosticsInput["runtime"];
  os: DiagnosticsInput["os"];
  settings: unknown;
  data: DiagnosticsInput["data"];
  detectionModelInstalled: boolean;
  log: string[];
}

/** Applies `redactSecrets` to every string inside a JSON-like value. */
function redactStrings(value: unknown): unknown {
  if (typeof value === "string") return redactSecrets(value);
  if (Array.isArray(value)) return value.map(redactStrings);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, redactStrings(entry)]),
    );
  }
  return value;
}

/** Number of log bytes included in a report. */
export const DIAGNOSTICS_LOG_BYTES = 256 * 1024;

export function buildDiagnosticsReport(
  input: DiagnosticsInput,
): DiagnosticsReport {
  return {
    format: "dealership-risk-mapping/diagnostics@1",
    generatedAt: input.generatedAt.toISOString(),
    app: input.app,
    runtime: input.runtime,
    os: input.os,
    // Settings hold only key *presence* flags, but custom endpoint URLs could
    // still carry credentials: run them through the same masking as the log.
    settings: redactStrings(input.settings),
    data: input.data,
    detectionModelInstalled: input.detectionModelInstalled,
    log: redactSecrets(input.log)
      .split("\n")
      .filter((line) => line.length > 0),
  };
}

/** `drm-diagnostics-20261113-1430.json` */
export function diagnosticsFileName(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `drm-diagnostics-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(
    date.getDate(),
  )}-${pad(date.getHours())}${pad(date.getMinutes())}.json`;
}
