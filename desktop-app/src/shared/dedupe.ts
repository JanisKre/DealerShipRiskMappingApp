import type { DealershipInput } from "./types";

/**
 * Duplicate detection for imported locations (pure function, used in the
 * renderer). Two entries are considered duplicates if the normalized name
 * matches AND either the normalized address matches or the coordinates are
 * very close to each other (< 150 m, haversine).
 *
 * The first match stays the "original"; later, matching entries are flagged
 * as duplicates (`duplicateOf` references the original's ID).
 */

const NEAR_METERS = 150;

export interface DedupeResult {
  unique: DealershipInput[];
  duplicates: Array<{ row: DealershipInput; duplicateOf: string }>;
}

export function dedupeDealerships(rows: DealershipInput[]): DedupeResult {
  const unique: DealershipInput[] = [];
  const duplicates: DedupeResult["duplicates"] = [];

  for (const row of rows) {
    const match = unique.find((u) => isDuplicate(u, row));
    if (match) duplicates.push({ row, duplicateOf: match.id });
    else unique.push(row);
  }
  return { unique, duplicates };
}

function isDuplicate(a: DealershipInput, b: DealershipInput): boolean {
  if (normalize(a.name) !== normalize(b.name)) return false;
  if (a.address && b.address && normalize(a.address) === normalize(b.address))
    return true;
  if (a.lat != null && a.lon != null && b.lat != null && b.lon != null) {
    return haversineMeters(a.lat, a.lon, b.lat, b.lon) < NEAR_METERS;
  }
  // Same name, but no comparable coordinates/addresses => treat as a duplicate.
  return !a.address && !b.address && a.lat == null && b.lat == null;
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.,]/g, "");
}

/** Haversine distance in meters (dependency-free, sufficient for a proximity check). */
function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6_371_000;
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
