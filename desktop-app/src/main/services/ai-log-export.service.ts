import { app, dialog, type BrowserWindow } from "electron";
import { writeFile } from "node:fs/promises";
import { allAiLogEntries } from "../db/ai-log.repo";

/** File name of an exported record book, e.g. `ai-record-book-2026-11-15.json`. */
export function aiLogFileName(now: Date): string {
  return `ai-record-book-${now.toISOString().slice(0, 10)}.json`;
}

/**
 * Asks for a target file and writes the AI record book there. The file
 * holds the stored requests and answers, so it can contain portfolio data:
 * it is written only where the user chooses and never sent anywhere.
 */
export async function exportAiLog(
  win: BrowserWindow | null,
): Promise<string | null> {
  const now = new Date();
  const options = {
    title: "Export AI record book",
    defaultPath: aiLogFileName(now),
    filters: [{ name: "JSON", extensions: ["json"] }],
  };
  const { canceled, filePath } = win
    ? await dialog.showSaveDialog(win, options)
    : await dialog.showSaveDialog(options);
  if (canceled || !filePath) return null;
  const entries = allAiLogEntries();
  await writeFile(
    filePath,
    JSON.stringify(
      {
        kind: "dealership-risk-mapping/ai-record-book",
        exportedAt: now.toISOString(),
        appVersion: app.getVersion(),
        note: "Requests this installation sent to AI providers. Texts longer than the stored limit are cut and marked; images are counted, not stored.",
        entries,
      },
      null,
      2,
    ),
    "utf8",
  );
  return filePath;
}
