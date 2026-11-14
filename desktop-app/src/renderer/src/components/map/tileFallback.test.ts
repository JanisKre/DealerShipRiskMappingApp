import { describe, expect, it } from "vitest";
import { ancestorTile } from "./tileFallback";

describe("ancestorTile", () => {
  it("returns the parent and the quadrant that covers the tile", () => {
    // z19 558003/363903 is the lower-right child of z18 279001/181951.
    expect(ancestorTile({ x: 558003, y: 363903, z: 19 }, 1)).toEqual({
      coords: { x: 279001, y: 181951, z: 18 },
      viewBox: "xywh(128px 128px 128px 128px)",
    });
  });

  it("narrows the view box with every level", () => {
    expect(ancestorTile({ x: 5, y: 6, z: 10 }, 2)).toEqual({
      coords: { x: 1, y: 1, z: 8 },
      viewBox: "xywh(64px 128px 64px 64px)",
    });
  });

  it("has no ancestor above the root or for an invalid level", () => {
    expect(ancestorTile({ x: 0, y: 0, z: 1 }, 2)).toBeNull();
    expect(ancestorTile({ x: 3, y: 3, z: 5 }, 0)).toBeNull();
  });
});
