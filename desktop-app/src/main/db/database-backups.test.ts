import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => tmpdir() } }));

import { MIGRATION_BACKUPS_KEPT, pruneOldBackups } from "./database";

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("pruneOldBackups", () => {
  it("keeps the newest backups and nothing else of theirs", () => {
    dir = mkdtempSync(join(tmpdir(), "drm-backups-"));
    const db = join(dir, "dealership-risk.db");
    writeFileSync(db, "");
    const stamps = [
      "2026-01-01T00-00-00-000Z",
      "2026-03-01T00-00-00-000Z",
      "2026-06-01T00-00-00-000Z",
      "2026-09-01T00-00-00-000Z",
      "2026-11-01T00-00-00-000Z",
    ];
    for (const s of stamps) writeFileSync(`${db}.backup-${s}`, "");
    writeFileSync(join(dir, "other.backup-2020"), "");

    const removed = pruneOldBackups(db);

    expect(removed).toHaveLength(stamps.length - MIGRATION_BACKUPS_KEPT);
    const left = readdirSync(dir).filter((n) => n.includes(".db.backup-"));
    expect(left.sort()).toEqual(
      stamps
        .slice(-MIGRATION_BACKUPS_KEPT)
        .map((s) => `dealership-risk.db.backup-${s}`),
    );
    expect(readdirSync(dir)).toContain("other.backup-2020");
  });
});
