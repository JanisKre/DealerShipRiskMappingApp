import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyPendingDataReset,
  dataResetTargets,
  isDataResetPending,
  RESET_MARKER_FILE,
  scheduleDataReset,
} from "./data-reset.service";

const dirs: string[] = [];
function userData(): string {
  const dir = mkdtempSync(join(tmpdir(), "drm-reset-"));
  dirs.push(dir);
  for (const file of [
    "dealership-risk.db",
    "dealership-risk.db-wal",
    "dealership-risk.db-shm",
    "dealership-risk.db.backup-2026-11-01T10-00-00-000Z",
    "Preferences",
  ]) {
    writeFileSync(join(dir, file), "x");
  }
  for (const folder of ["hail-zones", "logs", "models", "Local Storage"]) {
    mkdirSync(join(dir, folder));
    writeFileSync(join(dir, folder, "file"), "x");
  }
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("data reset", () => {
  it("does nothing unless a reset was scheduled", () => {
    const dir = userData();
    expect(applyPendingDataReset(dir)).toEqual({ applied: false, failed: [] });
    expect(existsSync(join(dir, "dealership-risk.db"))).toBe(true);
  });

  it("removes the database, its backups, caches and logs but keeps the model", () => {
    const dir = userData();
    scheduleDataReset(dir);
    expect(isDataResetPending(dir)).toBe(true);

    expect(applyPendingDataReset(dir)).toEqual({ applied: true, failed: [] });

    for (const gone of [
      "dealership-risk.db",
      "dealership-risk.db-wal",
      "dealership-risk.db-shm",
      "dealership-risk.db.backup-2026-11-01T10-00-00-000Z",
      "hail-zones",
      "logs",
      RESET_MARKER_FILE,
    ]) {
      expect(existsSync(join(dir, gone)), gone).toBe(false);
    }
    expect(existsSync(join(dir, "models", "file"))).toBe(true);
    // Chromium's own files are cleared through the session API instead.
    expect(existsSync(join(dir, "Preferences"))).toBe(true);
  });

  it("only targets the app's own files", () => {
    const dir = userData();
    const names = dataResetTargets(dir).map((path) =>
      path.slice(dir.length + 1),
    );
    expect(names.sort()).toEqual([
      "dealership-risk.db",
      "dealership-risk.db-shm",
      "dealership-risk.db-wal",
      "dealership-risk.db.backup-2026-11-01T10-00-00-000Z",
      "hail-zones",
      "logs",
    ]);
  });
});
