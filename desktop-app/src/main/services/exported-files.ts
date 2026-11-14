import { shell } from "electron";

/**
 * Files this app wrote through a save dialog in the current run. Only these
 * can be revealed in the file manager from the renderer ("Im Ordner
 * zeigen"): the renderer passes a path back, and an arbitrary path from an
 * untrusted renderer must never be opened or revealed.
 */
const exported = new Set<string>();
const MAX_REMEMBERED = 200;

export function rememberExport<T extends string | null>(path: T): T {
  if (path) {
    exported.add(path);
    if (exported.size > MAX_REMEMBERED) {
      const oldest = exported.values().next().value;
      if (oldest !== undefined) exported.delete(oldest);
    }
  }
  return path;
}

export function isRememberedExport(path: string): boolean {
  return exported.has(path);
}

/** Reveals a remembered export; anything else is refused. */
export function showExportInFolder(path: string): boolean {
  if (!isRememberedExport(path)) return false;
  shell.showItemInFolder(path);
  return true;
}
