import { describe, expect, it } from "vitest";
import {
  isVegetationPixel,
  vegetationAt,
  vegetationMask,
  type GeoImage,
} from "./vegetation";

describe("isVegetationPixel", () => {
  it("accepts lit grass and trees", () => {
    expect(isVegetationPixel(100, 140, 100)).toBe(true);
    expect(isVegetationPixel(120, 140, 120)).toBe(true);
    expect(isVegetationPixel(40, 62, 36)).toBe(true);
  });

  it("accepts grass in blue shade", () => {
    expect(isVegetationPixel(40, 60, 80)).toBe(true);
  });

  it("rejects asphalt, shaded asphalt, roofs, soil and near-black", () => {
    expect(isVegetationPixel(120, 120, 120)).toBe(false);
    expect(isVegetationPixel(110, 112, 118)).toBe(false);
    expect(isVegetationPixel(50, 55, 75)).toBe(false);
    expect(isVegetationPixel(170, 90, 70)).toBe(false);
    expect(isVegetationPixel(150, 130, 95)).toBe(false);
    expect(isVegetationPixel(8, 12, 8)).toBe(false);
  });
});

/** A 200 × 200 px image over about 100 × 100 m: green west half, grey east. */
function image(): GeoImage {
  const size = 200;
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const green = x < size / 2;
      rgba[i] = green ? 90 : 120;
      rgba[i + 1] = green ? 130 : 120;
      rgba[i + 2] = green ? 80 : 120;
      rgba[i + 3] = 255;
    }
  }
  const latSpan = 100 / 111_320;
  return {
    rgba,
    width: size,
    height: size,
    originLon: 7,
    originLat: 51,
    lonSpan: latSpan / Math.cos((51 * Math.PI) / 180),
    latSpan,
  };
}

describe("vegetationMask", () => {
  it("rasterises the image at one metre per cell", () => {
    const mask = vegetationMask(image());
    expect(mask).not.toBeNull();
    expect(mask!.width).toBe(100);
    expect(mask!.height).toBe(100);
    const share = mask!.cells.reduce((sum, v) => sum + v, 0) / 10_000;
    expect(share).toBeCloseTo(0.5, 1);
  });

  it("answers by position and null outside the image", () => {
    const source = image();
    const mask = vegetationMask(source)!;
    const lat = source.originLat - source.latSpan / 2;
    expect(vegetationAt(mask, [7 + source.lonSpan * 0.25, lat])).toBe(true);
    expect(vegetationAt(mask, [7 + source.lonSpan * 0.75, lat])).toBe(false);
    expect(vegetationAt(mask, [6.99, lat])).toBeNull();
    expect(vegetationAt(mask, [7 + source.lonSpan * 0.5, 52])).toBeNull();
  });

  it("returns null for an image without pixels", () => {
    expect(vegetationMask({ ...image(), rgba: null })).toBeNull();
  });
});
