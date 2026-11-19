import type { DealershipInput, ImportIssue } from "@shared/types";
import { dedupeDealerships } from "@shared/dedupe";

/**
 * Pure part of the import preview: how each parsed row will be placed on
 * the map, which parser notes belong to it, and whether it duplicates a
 * location already in the portfolio or an earlier row of the file.
 */

/** coordinates: from the file · address: geocoded during analysis · missing: neither. */
export type Placement = "coordinates" | "address" | "missing";

export interface PreviewRow {
  row: DealershipInput;
  /** Row in the source file (header = 1), when the parser reported it. */
  sourceRow?: number;
  placement: Placement;
  issues: ImportIssue[];
  /** Name of the portfolio location this row repeats. */
  duplicateOfExisting?: string;
  /** Source row of the earlier file row this one repeats. */
  duplicateOfRow?: number;
  /**
   * Coordinates from the file that cannot be right for a German dealer:
   * outside Germany, or lat/lon swapped (swapping them lands in Germany).
   * Such rows start unticked (UW-06).
   */
  coordinateWarning?: "outsideGermany" | "swapped";
  include: boolean;
}

/** Generous bounding box of Germany (WGS84). */
const GERMANY = { minLat: 47.2, maxLat: 55.1, minLon: 5.8, maxLon: 15.1 };

function inGermany(lat: number, lon: number): boolean {
  return (
    lat >= GERMANY.minLat &&
    lat <= GERMANY.maxLat &&
    lon >= GERMANY.minLon &&
    lon <= GERMANY.maxLon
  );
}

export function coordinateWarning(
  row: DealershipInput,
): PreviewRow["coordinateWarning"] {
  if (row.lat == null || row.lon == null) return undefined;
  if (inGermany(row.lat, row.lon)) return undefined;
  return inGermany(row.lon, row.lat) ? "swapped" : "outsideGermany";
}

export function placement(row: DealershipInput): Placement {
  if (row.lat != null && row.lon != null) return "coordinates";
  if (row.address?.trim()) return "address";
  return "missing";
}

/**
 * Builds the preview rows. Rows that cannot be placed, repeat a portfolio
 * location or repeat an earlier row of the file start unticked: the
 * analysis could not place the first, and the import skips repeats anyway.
 */
export function buildPreviewRows(
  rows: DealershipInput[],
  rowNumbers: number[] | undefined,
  issues: ImportIssue[],
  existing: DealershipInput[],
): PreviewRow[] {
  const issuesByRow = new Map<number, ImportIssue[]>();
  for (const issue of issues) {
    issuesByRow.set(issue.row, [...(issuesByRow.get(issue.row) ?? []), issue]);
  }
  const existingById = new Map(existing.map((d) => [d.id, d]));
  const sourceRowById = new Map(
    rows.map((row, index) => [row.id, rowNumbers?.[index]]),
  );
  const duplicateOf = new Map(
    dedupeDealerships([...existing, ...rows]).duplicates.map((dup) => [
      dup.row.id,
      dup.duplicateOf,
    ]),
  );

  return rows.map((row, index) => {
    const sourceRow = rowNumbers?.[index];
    const original = duplicateOf.get(row.id);
    const existingMatch = original ? existingById.get(original) : undefined;
    const fileMatch =
      original && !existingMatch ? sourceRowById.get(original) : undefined;
    const where = placement(row);
    const warning = coordinateWarning(row);
    return {
      row,
      ...(sourceRow != null ? { sourceRow } : {}),
      placement: where,
      issues: sourceRow != null ? (issuesByRow.get(sourceRow) ?? []) : [],
      ...(existingMatch ? { duplicateOfExisting: existingMatch.name } : {}),
      ...(fileMatch != null ? { duplicateOfRow: fileMatch } : {}),
      ...(warning ? { coordinateWarning: warning } : {}),
      include:
        where !== "missing" &&
        !existingMatch &&
        fileMatch == null &&
        warning == null,
    };
  });
}

/** True when the row deserves a look before importing. */
export function needsAttention(row: PreviewRow): boolean {
  return (
    row.placement === "missing" ||
    row.coordinateWarning != null ||
    row.issues.length > 0 ||
    row.duplicateOfExisting != null ||
    row.duplicateOfRow != null
  );
}

/** Applies an inline edit of name or address and re-derives the placement. */
export function editPreviewRow(
  row: PreviewRow,
  patch: { name?: string; address?: string },
): PreviewRow {
  const name = patch.name?.trim();
  const address = patch.address?.trim();
  const next: DealershipInput = {
    ...row.row,
    ...(name ? { name } : {}),
    ...(patch.address !== undefined ? { address: address || undefined } : {}),
  };
  const where = placement(next);
  return {
    ...row,
    row: next,
    placement: where,
    include: where === "missing" ? false : row.include,
  };
}

/** Parser notes of rows that were dropped (no name, repeated rows, …). */
export function skippedIssues(
  issues: ImportIssue[],
  rowNumbers: number[] | undefined,
): ImportIssue[] {
  const kept = new Set(rowNumbers ?? []);
  return issues.filter((issue) => !kept.has(issue.row));
}

/**
 * How closely a geocoder hit matches the address it was asked for, from
 * the label alone: a hit in another postcode, or one on the street without
 * the house number, places the site only roughly. Such sites often end up
 * with an estimated circle instead of a parcel, so the preview says so
 * before the import.
 */
export type GeocodePrecision =
  | { kind: "exact" }
  | { kind: "streetOnly"; houseNumber: string }
  | { kind: "postcodeDiffers"; requested: string; found: string };

const POSTCODE = /\b\d{5}\b/g;

export function geocodePrecision(
  address: string,
  label: string,
): GeocodePrecision {
  const requested = address.match(POSTCODE)?.[0];
  const found = label.match(POSTCODE)?.at(-1);
  if (requested && found && requested !== found)
    return { kind: "postcodeDiffers", requested, found };
  // A house number is a short number token outside the postcode ("100",
  // "5a"); a road like "B19" has none.
  const houseNumber = address
    .replace(POSTCODE, " ")
    .match(/(?:^|[\s,])(\d{1,4}\s?[a-z]?)(?=$|[\s,])/i)?.[1]
    ?.trim();
  // Nominatim leads with the house number when it found the building.
  const labelHouse = /^\s*\d{1,4}\s?[a-z]?\s*(,|$)/i.test(label);
  if (houseNumber && !labelHouse) return { kind: "streetOnly", houseNumber };
  return { kind: "exact" };
}
