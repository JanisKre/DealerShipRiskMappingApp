import { describe, expect, it } from "vitest";
import type { BoundaryResult } from "@shared/types";
import { isUndoShortcut, undoShortcutTarget } from "./boundaryUndo";

const step = { source: "manual", areaSqm: 1, confidence: 1 } as BoundaryResult;

describe("undoShortcutTarget", () => {
  it("steps back the selected location when it has an undo step", () => {
    expect(undoShortcutTarget("a", ["a", "b"], { a: [step], b: [step] })).toBe(
      "a",
    );
  });

  it("falls back to the most recently edited location with a step", () => {
    expect(
      undoShortcutTarget("x", ["a", "b", "c"], { a: [step], b: [step] }),
    ).toBe("b");
    expect(undoShortcutTarget(null, ["a"], { a: [step] })).toBe("a");
  });

  it("does nothing without an undo step", () => {
    expect(undoShortcutTarget("a", ["a"], { a: [] })).toBeNull();
    expect(undoShortcutTarget(null, [], {})).toBeNull();
  });
});

describe("isUndoShortcut", () => {
  const key = (
    patch: Partial<KeyboardEvent>,
  ): Parameters<typeof isUndoShortcut>[0] => ({
    key: "z",
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...patch,
  });

  it("accepts Ctrl+Z and ⌘Z", () => {
    expect(isUndoShortcut(key({ ctrlKey: true }))).toBe(true);
    expect(isUndoShortcut(key({ metaKey: true, key: "Z" }))).toBe(true);
  });

  it("leaves redo, plain z and other keys alone", () => {
    expect(isUndoShortcut(key({ ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isUndoShortcut(key({}))).toBe(false);
    expect(isUndoShortcut(key({ ctrlKey: true, key: "y" }))).toBe(false);
  });
});
