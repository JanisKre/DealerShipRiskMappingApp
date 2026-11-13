import { app, dialog, type BrowserWindow } from "electron";
import { statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { release } from "node:os";
import { getDb } from "../db/database";
import { isModelAvailable } from "./detection.service";
import {
  buildDiagnosticsReport,
  diagnosticsFileName,
  DIAGNOSTICS_LOG_BYTES,
} from "./diagnostics-report";
import { readRecentLog } from "./log.service";
import { getSettings } from "./settings.service";

/** Record counts per table; null where a table cannot be read. */
function dataCounts(): Record<string, number | null> {
  const tables = [
    "sessions",
    "conversations",
    "dashboards",
    "api_cache",
    "dealer_directory",
  ] as const;
  const counts: Record<string, number | null> = {};
  for (const table of tables) {
    try {
      const row = getDb()
        .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
        .get() as { n: number };
      counts[table] = row.n;
    } catch {
      counts[table] = null;
    }
  }
  try {
    counts["databaseBytes"] = statSync(
      join(app.getPath("userData"), "dealership-risk.db"),
    ).size;
  } catch {
    counts["databaseBytes"] = null;
  }
  return counts;
}

/** Asks for a target file and writes the diagnostics report there. */
export async function exportDiagnostics(
  win: BrowserWindow | null,
): Promise<string | null> {
  const now = new Date();
  const options = {
    title: "Export Diagnostics",
    defaultPath: diagnosticsFileName(now),
    filters: [{ name: "JSON", extensions: ["json"] }],
  };
  const { canceled, filePath } = win
    ? await dialog.showSaveDialog(win, options)
    : await dialog.showSaveDialog(options);
  if (canceled || !filePath) return null;

  const report = buildDiagnosticsReport({
    generatedAt: now,
    app: {
      name: app.getName(),
      version: app.getVersion(),
      packaged: app.isPackaged,
    },
    runtime: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      v8: process.versions.v8,
    },
    os: {
      platform: process.platform,
      arch: process.arch,
      release: release(),
      locale: app.getLocale(),
    },
    settings: getSettings(),
    data: dataCounts(),
    detectionModelInstalled: isModelAvailable(),
    log: readRecentLog(DIAGNOSTICS_LOG_BYTES),
  });
  await writeFile(filePath, JSON.stringify(report, null, 2), "utf-8");
  return filePath;
}
