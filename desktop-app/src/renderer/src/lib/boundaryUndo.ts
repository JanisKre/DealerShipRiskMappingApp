import type { BoundaryResult } from "@shared/types";

/**
 * The location Ctrl+Z / ⌘Z steps back: the selected one when it has an undo
 * step, otherwise the most recently edited one that has.
 */
export function undoShortcutTarget(
  selectedId: string | null,
  boundaryEditIds: readonly string[],
  boundaryHistory: Readonly<Record<string, readonly BoundaryResult[]>>,
): string | null {
  const canUndo = (id: string): boolean =>
    (boundaryHistory[id]?.length ?? 0) > 0;
  if (selectedId && canUndo(selectedId)) return selectedId;
  return [...boundaryEditIds].reverse().find(canUndo) ?? null;
}

/** Ctrl+Z (Windows/Linux) or ⌘Z (macOS), without Shift (that is redo). */
export function isUndoShortcut(
  e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">,
): boolean {
  return (
    (e.ctrlKey || e.metaKey) &&
    !e.shiftKey &&
    !e.altKey &&
    e.key.toLowerCase() === "z"
  );
}

/** Text fields keep their own undo. */
export function isTextEntry(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement))
    return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
}
