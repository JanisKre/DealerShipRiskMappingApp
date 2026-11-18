import { describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
import { rendererFlushed, requestRendererFlush } from "./close-flush";

function fakeWindow(onSend: () => void): BrowserWindow {
  return {
    webContents: { send: vi.fn(onSend) },
  } as unknown as BrowserWindow;
}

describe("requestRendererFlush", () => {
  it("resolves once the renderer reports it has saved", async () => {
    const window = fakeWindow(() => setTimeout(() => rendererFlushed(), 5));
    await expect(requestRendererFlush(window, 1_000)).resolves.toBeUndefined();
    expect(window.webContents.send).toHaveBeenCalledWith("app:flushRequest");
  });

  it("does not wait for a renderer that never answers", async () => {
    vi.useFakeTimers();
    const done = requestRendererFlush(
      fakeWindow(() => undefined),
      3_000,
    );
    vi.advanceTimersByTime(3_000);
    await expect(done).resolves.toBeUndefined();
    vi.useRealTimers();
  });
});
