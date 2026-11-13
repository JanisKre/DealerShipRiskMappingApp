import { existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * "Delete all data" in two steps, so no file is removed while it is open:
 * the running app writes a marker, clears Chromium's storage and restarts;
 * the next start removes the app's files before the database is opened.
 *
 * Removed: the database (portfolios, chats, dashboards, settings, encrypted
 * API keys, API cache, dealer directory) with its WAL files and migration
 * backups, the cached hail-zone outlines and the log files. Kept: the
 * downloaded detection model (`models/`), which holds no user data.
 */

export const RESET_MARKER_FILE = ".reset-pending";

const DATABASE_FILE = "dealership-risk.db";
const REMOVED_DIRECTORIES = ["hail-zones", "logs"] as const;

export function scheduleDataReset(userDataDir: string): void {
  writeFileSync(
    join(userDataDir, RESET_MARKER_FILE),
    new Date().toISOString(),
    "utf-8",
  );
}

export function isDataResetPending(userDataDir: string): boolean {
  return existsSync(join(userDataDir, RESET_MARKER_FILE));
}

/** The files and folders a reset removes, as they exist right now. */
export function dataResetTargets(userDataDir: string): string[] {
  const entries = existsSync(userDataDir) ? readdirSync(userDataDir) : [];
  const databaseFiles = entries.filter(
    (name) =>
      name === DATABASE_FILE ||
      name === `${DATABASE_FILE}-wal` ||
      name === `${DATABASE_FILE}-shm` ||
      name === `${DATABASE_FILE}-journal` ||
      name.startsWith(`${DATABASE_FILE}.backup-`),
  );
  const directories = REMOVED_DIRECTORIES.filter((name) =>
    entries.includes(name),
  );
  return [...databaseFiles, ...directories].map((name) =>
    join(userDataDir, name),
  );
}

export interface DataResetOutcome {
  applied: boolean;
  /** Paths that could not be removed; the marker stays for the next start. */
  failed: string[];
}

/** Runs a reset scheduled by the previous session, if there is one. */
export function applyPendingDataReset(userDataDir: string): DataResetOutcome {
  if (!isDataResetPending(userDataDir)) return { applied: false, failed: [] };
  const failed: string[] = [];
  for (const target of dataResetTargets(userDataDir)) {
    try {
      rmSync(target, { recursive: true, force: true });
    } catch {
      failed.push(target);
    }
  }
  if (failed.length === 0) {
    rmSync(join(userDataDir, RESET_MARKER_FILE), { force: true });
  }
  return { applied: failed.length === 0, failed };
}
