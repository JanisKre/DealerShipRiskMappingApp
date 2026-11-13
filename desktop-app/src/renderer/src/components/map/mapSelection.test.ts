import { describe, expect, it } from "vitest";
import type { AnalyzedDealership, BoundaryResult } from "@shared/types";
import {
  allRowsSelected,
  boundaryReviewQueue,
  geometryBounds,
  withSelected,
} from "./mapSelection";

function site(id: string, reviewRequired = false): AnalyzedDealership {
  return {
    id,
    name: `Autohaus ${id}`,
    lat: 51,
    lon: 7,
    ...(reviewRequired
      ? { boundary: { reviewRequired: true } as BoundaryResult }
      : {}),
  } as AnalyzedDealership;
}

describe("withSelected", () => {
  const all = [site("a"), site("b"), site("c")];

  it("adds the selected site when a filter hides it", () => {
    expect(withSelected([all[0]], all, "c").map((d) => d.id)).toEqual([
      "a",
      "c",
    ]);
  });

  it("keeps the visible list as it is otherwise", () => {
    const visible = [all[0], all[2]];
    expect(withSelected(visible, all, "c")).toBe(visible);
    expect(withSelected(visible, all, null)).toBe(visible);
    expect(withSelected(visible, all, "gone")).toBe(visible);
  });
});

describe("boundaryReviewQueue", () => {
  it("lists only the visible sites that need a check, in order", () => {
    const visible = [site("a", true), site("b"), site("c", true)];
    expect(boundaryReviewQueue(visible)).toEqual(["a", "c"]);
  });

  it("does not ask about sites the filter hides", () => {
    // "h" needs a check but is filtered out, so it is not in `visible`.
    expect(boundaryReviewQueue([site("a")])).toEqual([]);
  });
});

describe("geometryBounds", () => {
  it("spans every ring of a multipolygon as [[south, west], [north, east]]", () => {
    expect(
      geometryBounds({
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [7, 51],
              [7.2, 51],
              [7.2, 51.1],
              [7, 51],
            ],
          ],
          [
            [
              [6.9, 50.9],
              [7, 50.9],
              [7, 51],
              [6.9, 50.9],
            ],
          ],
        ],
      }),
    ).toEqual([
      [50.9, 6.9],
      [51.1, 7.2],
    ]);
  });

  it("returns null for an empty geometry", () => {
    expect(geometryBounds({ type: "Polygon", coordinates: [] })).toBeNull();
  });
});

describe("allRowsSelected", () => {
  it("compares with the rows the list shows, not the whole portfolio", () => {
    // Search shows two of ten sites, both ticked: "Deselect all" applies.
    expect(allRowsSelected(new Set(["a", "b"]), ["a", "b"])).toBe(true);
    expect(allRowsSelected(new Set(["a"]), ["a", "b"])).toBe(false);
  });

  it("is false for an empty list", () => {
    expect(allRowsSelected(new Set(), [])).toBe(false);
  });
});
