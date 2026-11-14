import { describe, expect, it } from "vitest";
import {
  REVIEW_NOTE_MAX_CHARS,
  cleanReviewNotes,
  mergeReviewOrder,
} from "./review-plan";

describe("review plan", () => {
  it("keeps the proposed order, drops unknown and repeated ids, appends the rest", () => {
    expect(
      mergeReviewOrder(["a", "b", "c", "d"], ["c", "x", "a", "c"]),
    ).toEqual(["c", "a", "b", "d"]);
    expect(mergeReviewOrder(["a", "b"], [])).toEqual(["a", "b"]);
  });

  it("keeps clean notes for known ids only", () => {
    const notes = cleanReviewNotes(
      ["a", "b", "c"],
      [
        { id: "a", text: "  Grenze  unsicher bei hoher Zone " },
        { id: "a", text: "second note" },
        { id: "b", text: "EAL von 12.000 € prüfen" },
        { id: "c", text: "Anteil 40 % der Kumulation" },
        { id: "x", text: "unknown" },
      ],
    );
    expect(notes).toEqual({ a: "Grenze unsicher bei hoher Zone" });
  });

  it("shortens long notes", () => {
    const notes = cleanReviewNotes(["a"], [{ id: "a", text: "x".repeat(500) }]);
    expect(notes.a).toHaveLength(REVIEW_NOTE_MAX_CHARS);
    expect(notes.a.endsWith("…")).toBe(true);
  });
});
