import { utilityProcess } from "electron";
import { join } from "node:path";
import { getDb } from "../db/database";
import type {
  DealerRecord,
  ExtractProgress,
  ExtractResult,
} from "./dealer-directory/overture-dealers";
import { normalisePlaceQuery } from "./place-query";

/**
 * Local directory of German car dealers from Overture Maps places.
 *
 * Overture adds many businesses that OSM lacks (sourced from Meta, Microsoft,
 * Foursquare and others). It has no search API, so the German dealer subset
 * is downloaded once on request (worker: `overture-dealers.worker.ts`) and
 * searched locally with SQLite FTS5 next to the live OSM/Photon results.
 */

const META_KEY = "dealerDirectory";

export interface DealerDirectoryStatus {
  release: string;
  retrievedAt: string;
  count: number;
}

export interface DirectoryHit {
  id: string;
  label: string;
  name: string;
  lat: number;
  lon: number;
}

interface DirectoryRow extends DealerRecord {
  rank: number;
}

export function dealerDirectoryStatus(): DealerDirectoryStatus | null {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(META_KEY) as { value: string } | undefined;
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value) as Partial<DealerDirectoryStatus>;
    return typeof parsed.release === "string" &&
      typeof parsed.retrievedAt === "string" &&
      typeof parsed.count === "number"
      ? (parsed as DealerDirectoryStatus)
      : null;
  } catch {
    return null;
  }
}

/** Replaces the whole directory atomically, so a search never sees half a release. */
export function storeDealerDirectory(
  result: ExtractResult,
  retrievedAt = new Date().toISOString(),
): DealerDirectoryStatus {
  const db = getDb();
  const status: DealerDirectoryStatus = {
    release: result.release,
    retrievedAt,
    count: result.records.length,
  };
  const insert = db.prepare(
    `INSERT OR REPLACE INTO dealer_directory
       (id, name, category, brand, street, postcode, city, lat, lon, confidence)
     VALUES (@id, @name, @category, @brand, @street, @postcode, @city, @lat, @lon, @confidence)`,
  );
  db.transaction(() => {
    db.prepare("DELETE FROM dealer_directory").run();
    for (const record of result.records) insert.run(record);
    db.prepare(
      "INSERT INTO dealer_directory_fts(dealer_directory_fts) VALUES('rebuild')",
    ).run();
    db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    ).run(META_KEY, JSON.stringify(status));
  })();
  return status;
}

/**
 * FTS5 prefix query: every word must match the start of a token in name,
 * brand, street, postcode or city ("autohaus herz" finds "Autohaus Herzog").
 */
export function directoryMatchQuery(query: string): string | null {
  const tokens = normalisePlaceQuery(query)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 8);
  if (tokens.length === 0) return null;
  return tokens.map((token) => `"${token}"*`).join(" ");
}

function distanceKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const rad = Math.PI / 180;
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.sqrt(x * x + y * y) * 6_371;
}

export function directoryLabel(record: DealerRecord): string {
  const place = [record.postcode, record.city].filter(Boolean).join(" ");
  return [record.name, record.street, place].filter(Boolean).join(", ");
}

/**
 * Orders FTS candidates by text relevance (bm25, lower is better), nudged
 * towards the map view and towards confident records.
 */
export function rankDirectoryRows(
  rows: DirectoryRow[],
  near: { lat: number; lon: number } | undefined,
  limit: number,
): DirectoryHit[] {
  return rows
    .map((row) => {
      const relevance = -row.rank * (0.7 + 0.3 * row.confidence);
      const distancePenalty = near
        ? Math.log10(1 + distanceKm(near, row) / 10)
        : 0;
      return { row, score: relevance - distancePenalty };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ row }) => ({
      id: row.id,
      label: directoryLabel(row),
      name: row.name,
      lat: row.lat,
      lon: row.lon,
    }));
}

export function searchDealerDirectory(
  query: string,
  near?: { lat: number; lon: number },
  limit = 5,
): DirectoryHit[] {
  const match = directoryMatchQuery(query);
  if (!match) return [];
  try {
    const rows = getDb()
      .prepare(
        `SELECT d.id, d.name, d.category, d.brand, d.street, d.postcode, d.city,
                d.lat, d.lon, d.confidence,
                bm25(dealer_directory_fts, 10.0, 3.0, 1.0, 2.0, 2.0) AS rank
           FROM dealer_directory_fts
           JOIN dealer_directory d ON d.rowid = dealer_directory_fts.rowid
          WHERE dealer_directory_fts MATCH ?
          ORDER BY rank
          LIMIT 50`,
      )
      .all(match) as DirectoryRow[];
    return rankDirectoryRows(rows, near, limit);
  } catch (err) {
    // A malformed query must never break the live OSM search next to it.
    console.error("Dealer directory search failed:", err);
    return [];
  }
}

let activeRefresh: Promise<DealerDirectoryStatus> | null = null;

/**
 * Downloads the current Overture release's German dealers in a worker and
 * replaces the local directory. Only one refresh runs at a time.
 */
export function refreshDealerDirectory(
  onProgress: (progress: ExtractProgress) => void,
  signal?: AbortSignal,
): Promise<DealerDirectoryStatus> {
  if (activeRefresh) return activeRefresh;
  activeRefresh = new Promise<DealerDirectoryStatus>((resolve, reject) => {
    const proc = utilityProcess.fork(
      join(__dirname, "overture-dealers.worker.cjs"),
    );
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const onAbort = (): void => {
      proc.kill();
      finish(() => reject(new Error("Dealer directory download cancelled")));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });

    proc.on(
      "message",
      (
        msg:
          | { type: "progress"; progress: ExtractProgress }
          | { type: "result"; result: ExtractResult }
          | { type: "error"; error: string },
      ) => {
        if (msg.type === "progress") onProgress(msg.progress);
        else if (msg.type === "error") {
          proc.kill();
          finish(() => reject(new Error(msg.error)));
        } else if (msg.type === "result") {
          proc.kill();
          finish(() => {
            try {
              resolve(storeDealerDirectory(msg.result));
            } catch (err) {
              reject(err instanceof Error ? err : new Error(String(err)));
            }
          });
        }
      },
    );
    proc.on("exit", () =>
      finish(() => reject(new Error("Dealer directory worker exited"))),
    );
    proc.postMessage({ type: "start" });
  }).finally(() => {
    activeRefresh = null;
  });
  return activeRefresh;
}
