import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dismissedHintKey,
  readDismissed,
  writeDismissed,
} from "./dismissedHints";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}

afterEach(() => vi.unstubAllGlobals());

describe("dismissed hints", () => {
  it("remembers a dismissal per portfolio and reason", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    const a = dismissedHintKey("p1", "detectionModel");
    writeDismissed(a, true);
    expect(readDismissed(a)).toBe(true);
    expect(readDismissed(dismissedHintKey("p2", "detectionModel"))).toBe(false);
    expect(readDismissed(dismissedHintKey("p1", "boundaryReview"))).toBe(false);
    writeDismissed(a, false);
    expect(readDismissed(a)).toBe(false);
  });

  it("survives a storage that throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(() => writeDismissed("k", true)).not.toThrow();
    expect(readDismissed("k")).toBe(false);
  });
});
