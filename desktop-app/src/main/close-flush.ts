import type { BrowserWindow } from "electron";
import { IPC } from "@shared/ipc-channels";

/**
 * Saving on close. Autosave waits a few seconds of quiet, so the last
 * changes before closing the window were lost. On `close` the main process
 * asks the renderer to save (`app:flushRequest`) and closes once it answers
 * (`app:flushDone`) or after `FLUSH_TIMEOUT_MS`, so a hung renderer never
 * keeps the window open.
 */
export const FLUSH_TIMEOUT_MS = 3_000;

let pending: (() => void) | null = null;

/** Called by the `app:flushDone` handler. */
export function rendererFlushed(): void {
  const done = pending;
  pending = null;
  done?.();
}

/** Asks the window's renderer to save and resolves when it has (or timed out). */
export function requestRendererFlush(
  window: BrowserWindow,
  timeoutMs = FLUSH_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending = null;
      resolve();
    }, timeoutMs);
    pending = () => {
      clearTimeout(timer);
      resolve();
    };
    try {
      window.webContents.send(IPC.appFlushRequest);
    } catch {
      rendererFlushed();
    }
  });
}

/**
 * Holds a window's first `close` until its renderer has saved, then closes
 * it for real. `onClosed` runs after the flush (the app quits from there
 * when a quit was under way).
 */
export function saveBeforeClose(
  window: BrowserWindow,
  onFlushed: () => void,
): void {
  let flushed = false;
  window.on("close", (event) => {
    if (flushed || window.webContents.isDestroyed()) return;
    event.preventDefault();
    void requestRendererFlush(window).then(() => {
      flushed = true;
      onFlushed();
      if (!window.isDestroyed()) window.close();
    });
  });
}
