import { describe, expect, it } from "vitest";
import { crossedIntoNarrow } from "./narrowWindow";

describe("crossedIntoNarrow", () => {
  it("fires only when the window becomes narrow", () => {
    expect(crossedIntoNarrow(1440, 1024, 1280)).toBe(true);
    expect(crossedIntoNarrow(1100, 1024, 1280)).toBe(false);
    expect(crossedIntoNarrow(1024, 1440, 1280)).toBe(false);
  });
});
