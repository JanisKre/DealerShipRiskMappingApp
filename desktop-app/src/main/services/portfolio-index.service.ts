import { getDb } from "../db/database";
import { distanceKm, similarBusinessNames } from "./place-query";

/**
 * Which saved portfolio locations a search hit already is, so the search can
 * say "already in portfolio X" (with the start of the underwriter's note) and
 * rank it higher. Reads every saved session; the parsed list is cached until
 * a session is added, changed or deleted.
 */

/** Same spot: an imported address and a search hit for the same lot. */
const SAME_SPOT_M = 40;
/** Same business: entrance vs. roof centroid, as in the OSM/Overture merge. */
const SAME_BUSINESS_M = 150;
const NOTE_EXCERPT_LENGTH = 90;
const MAX_MATCHES = 3;

export interface PortfolioEntry {
  sessionId: string;
  sessionName: string;
  dealershipId: string;
  name: string;
  lat: number;
  lon: number;
  notes?: string;
}

export interface PortfolioMatch {
  sessionId: string;
  sessionName: string;
  dealershipId: string;
  name: string;
  /** First words of the location's note; notes stay local to this machine. */
  notesExcerpt?: string;
}

interface StoredDealership {
  id?: unknown;
  name?: unknown;
  lat?: unknown;
  lon?: unknown;
  notes?: unknown;
}

let cache: { fingerprint: string; entries: PortfolioEntry[] } | null = null;

/** Parses one session's `data` column (bare array or `{ dealerships }`). */
export function portfolioEntriesOf(
  session: { id: string; name: string },
  data: string,
): PortfolioEntry[] {
  let stored: unknown;
  try {
    stored = JSON.parse(data);
  } catch {
    return [];
  }
  const list = Array.isArray(stored)
    ? stored
    : (stored as { dealerships?: unknown } | null)?.dealerships;
  if (!Array.isArray(list)) return [];
  const out: PortfolioEntry[] = [];
  for (const item of list as StoredDealership[]) {
    if (
      typeof item?.id !== "string" ||
      typeof item.name !== "string" ||
      typeof item.lat !== "number" ||
      typeof item.lon !== "number"
    ) {
      continue;
    }
    out.push({
      sessionId: session.id,
      sessionName: session.name,
      dealershipId: item.id,
      name: item.name,
      lat: item.lat,
      lon: item.lon,
      ...(typeof item.notes === "string" && item.notes.trim()
        ? { notes: item.notes }
        : {}),
    });
  }
  return out;
}

/** All saved locations, most recently changed portfolio first. */
export function portfolioEntries(): PortfolioEntry[] {
  const db = getDb();
  const { n, t } = db
    .prepare("SELECT count(*) AS n, max(updated_at) AS t FROM sessions")
    .get() as { n: number; t: string | null };
  const fingerprint = `${n}|${t ?? ""}`;
  if (cache?.fingerprint === fingerprint) return cache.entries;
  const rows = db
    .prepare("SELECT id, name, data FROM sessions ORDER BY updated_at DESC")
    .all() as Array<{ id: string; name: string; data: string }>;
  const entries = rows.flatMap((row) => portfolioEntriesOf(row, row.data));
  cache = { fingerprint, entries };
  return entries;
}

export function noteExcerpt(notes: string): string {
  const flat = notes.replace(/\s+/gu, " ").trim();
  return flat.length > NOTE_EXCERPT_LENGTH
    ? `${flat.slice(0, NOTE_EXCERPT_LENGTH - 1).trimEnd()}…`
    : flat;
}

/**
 * Portfolio locations a hit stands for: at the same spot, or nearby with a
 * similar business name.
 */
export function matchPortfolio(
  hit: { lat: number; lon: number; name: string | null },
  entries: readonly PortfolioEntry[],
): PortfolioMatch[] {
  const out: PortfolioMatch[] = [];
  for (const entry of entries) {
    const meters = distanceKm(hit, entry) * 1000;
    const same =
      meters < SAME_SPOT_M ||
      (meters < SAME_BUSINESS_M &&
        hit.name != null &&
        similarBusinessNames(hit.name, entry.name));
    if (!same) continue;
    out.push({
      sessionId: entry.sessionId,
      sessionName: entry.sessionName,
      dealershipId: entry.dealershipId,
      name: entry.name,
      ...(entry.notes ? { notesExcerpt: noteExcerpt(entry.notes) } : {}),
    });
    if (out.length >= MAX_MATCHES) break;
  }
  return out;
}
