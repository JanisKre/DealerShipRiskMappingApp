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
  include: boolean;
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
    return {
      row,
      ...(sourceRow != null ? { sourceRow } : {}),
      placement: where,
      issues: sourceRow != null ? (issuesByRow.get(sourceRow) ?? []) : [],
      ...(existingMatch ? { duplicateOfExisting: existingMatch.name } : {}),
      ...(fileMatch != null ? { duplicateOfRow: fileMatch } : {}),
      include: where !== "missing" && !existingMatch && fileMatch == null,
    };
  });
}

/** True when the row deserves a look before importing. */
export function needsAttention(row: PreviewRow): boolean {
  return (
    row.placement === "missing" ||
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
