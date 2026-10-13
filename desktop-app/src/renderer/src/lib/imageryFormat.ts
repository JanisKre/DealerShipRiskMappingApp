import type { TFunction } from "i18next";
import type { ImageryCandidate } from "@shared/imagery-sources";

/** "medium" is unambiguous in every UI language (no 02/04 vs 04/02). */
export function formatImageryDate(iso: string, language: string): string {
  return new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));
}

/** Ground resolution with a non-breaking space before the unit. */
export function formatMeters(value: number, language: string): string {
  return `${new Intl.NumberFormat(language, { maximumFractionDigits: 2 }).format(value)}\u00a0m`;
}

/** One-line summary of an imagery version: capture date · resolution · collection. */
export function imageryCandidateSummary(
  c: ImageryCandidate,
  t: TFunction,
  language: string,
): string {
  const parts = [
    c.capturedAt
      ? formatImageryDate(c.capturedAt, language)
      : t("map.legend.imageryUnknown"),
  ];
  if (c.resolutionM != null) parts.push(formatMeters(c.resolutionM, language));
  if (c.esri?.collection) parts.push(c.esri.collection);
  return parts.join(" · ");
}
