import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  cache: new Map<string, unknown>(),
}));
vi.mock("./http.service", () => ({ fetchWithResilience: mocks.fetch }));
vi.mock("./cache.service", () => ({
  cacheGet: (key: string) => mocks.cache.get(key),
  cacheSet: (key: string, value: unknown) => mocks.cache.set(key, value),
}));

import {
  bavariaStreetMask,
  maskFromPng,
  onStreet,
} from "./bavaria-landuse.service";

/** A PNG like the WMS answer: a white horizontal street band, transparent elsewhere. */
async function streetPng(
  size: number,
  bandFrom: number,
  bandTo: number,
): Promise<Buffer> {
  const rgba = Buffer.alloc(size * size * 4);
  for (let row = bandFrom; row < bandTo; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const i = (row * size + col) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = rgba[i + 3] = 255;
    }
  }
  return sharp(rgba, { raw: { width: size, height: size, channels: 4 } })
    .png()
    .toBuffer();
}

function pngResponse(png: Buffer): Response {
  return new Response(new Uint8Array(png), {
    status: 200,
    headers: { "content-type": "image/png" },
  });
}

const box = { west: 11.0, south: 48.0, east: 11.01, north: 48.01 };

beforeEach(() => {
  mocks.fetch.mockReset();
  mocks.cache.clear();
});

describe("maskFromPng / onStreet", () => {
  it("reads opaque pixels as traffic area and finds points on it", async () => {
    // 100 px; rows 40–59 (from the north) are street.
    const mask = await maskFromPng(await streetPng(100, 40, 60), box);
    expect(mask.cells.reduce((a, b) => a + b, 0)).toBe(2000);
    const lat = (row: number): number =>
      box.north - ((row + 0.5) / 100) * (box.north - box.south);
    expect(onStreet(mask, [11.005, lat(50)])).toBe(true);
    expect(onStreet(mask, [11.005, lat(10)])).toBe(false);
    expect(onStreet(mask, [12, 48.005])).toBe(false);
  });
});

describe("bavariaStreetMask", () => {
  it("asks nothing outside Bayern", async () => {
    expect(await bavariaStreetMask(51.0, 7.0)).toBeNull();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("requests the traffic layer in WMS 1.3.0 axis order and caches the raster", async () => {
    mocks.fetch.mockResolvedValue(pngResponse(await streetPng(440, 200, 240)));
    const first = await bavariaStreetMask(48.137, 11.575);
    expect(first).not.toBeNull();
    const url = String(mocks.fetch.mock.calls[0][0]);
    expect(url).toContain("LAYERS=by_alkis_tn_verkehr");
    expect(url).toMatch(/BBOX=48\.13\d+,11\.57\d+,48\.13\d+,11\.57\d+/);
    const second = await bavariaStreetMask(48.137, 11.575);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(Array.from(second!.cells)).toEqual(Array.from(first!.cells));
  });

  it("returns null for a blank map and for a failure, caching only the blank map", async () => {
    mocks.fetch.mockResolvedValueOnce(pngResponse(await streetPng(440, 0, 0)));
    expect(await bavariaStreetMask(48.2, 11.6)).toBeNull();
    expect(mocks.cache.size).toBe(1);
    mocks.fetch.mockResolvedValueOnce(new Response("", { status: 500 }));
    expect(await bavariaStreetMask(48.3, 11.7)).toBeNull();
    expect(mocks.cache.size).toBe(1);
  });
});
