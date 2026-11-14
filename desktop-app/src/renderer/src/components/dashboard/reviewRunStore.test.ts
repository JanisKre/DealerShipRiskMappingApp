import { beforeEach, describe, expect, it } from "vitest";
import { usePausedReview } from "./reviewRunStore";

describe("paused review run", () => {
  beforeEach(() => usePausedReview.getState().clear());

  it("hands the paused run back once", () => {
    usePausedReview.getState().pause(["a", "b", "c"], "b");
    expect(usePausedReview.getState().resumeId).toBe("b");
    expect(usePausedReview.getState().take()).toEqual({
      ids: ["a", "b", "c"],
      id: "b",
    });
    expect(usePausedReview.getState().take()).toBeNull();
  });

  it("forgets the run when it is ended on the map", () => {
    usePausedReview.getState().pause(["a"], "a");
    usePausedReview.getState().clear();
    expect(usePausedReview.getState().take()).toBeNull();
  });
});
