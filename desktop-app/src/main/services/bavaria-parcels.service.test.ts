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
  bavariaParcelsNear,
  classifyMapPixel,
  parcelsFromParcelMap,
  type MapBox,
} from "./bavaria-parcels.service";

const SIZE = 400; // 100 m at 0.25 m per pixel
const LAT = 48.2;
const LON = 11.6;
const BOX: MapBox = (() => {
  const dLat = 50 / 111_320;
  const dLon = dLat / Math.cos((LAT * Math.PI) / 180);
  return {
    west: LON - dLon,
    south: LAT - dLat,
    east: LON + dLon,
    north: LAT + dLat,
  };
})();

const WHITE = [255, 255, 255];
const TRADE = [244, 244, 244];
const HOUSING = [252, 224, 224];
const BUILDING = [229, 229, 229];
const LINE = [0, 0, 0];

/**
 * A map like the service draws it: a road across the top (rows 0–79), below
 * it a trade plot on the left with a building in it and a housing plot on
 * the right, every area outlined in black.
 */
function mapPixels(): Uint8Array {
  const rgba = new Uint8Array(SIZE * SIZE * 4);
  const fill = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    [r, g, b]: number[],
  ): void => {
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const i = (y * SIZE + x) * 4;
        rgba[i] = r;
        rgba[i + 1] = g;
        rgba[i + 2] = b;
        rgba[i + 3] = 255;
      }
    }
  };
  const outline = (x0: number, y0: number, x1: number, y1: number): void => {
    fill(x0, y0, x1, y0, LINE);
    fill(x0, y1, x1, y1, LINE);
    fill(x0, y0, x0, y1, LINE);
    fill(x1, y0, x1, y1, LINE);
  };
  fill(0, 0, SIZE - 1, SIZE - 1, WHITE);
  fill(0, 80, 199, SIZE - 1, TRADE);
  fill(200, 80, SIZE - 1, SIZE - 1, HOUSING);
  outline(0, 80, 200, SIZE - 1);
  outline(200, 80, SIZE - 1, SIZE - 1);
  // A 20 × 15 m building inside the trade plot.
  fill(40, 160, 120, 220, BUILDING);
  outline(40, 160, 120, 220);
  return rgba;
}

describe("classifyMapPixel", () => {
  it("tells lines, buildings and ground apart", () => {
    expect(classifyMapPixel(0, 0, 0)).toBe("line");
    expect(classifyMapPixel(229, 229, 229)).toBe("building");
    expect(classifyMapPixel(178, 178, 178)).toBe("building");
    expect(classifyMapPixel(255, 255, 255)).toBe("traffic");
    expect(classifyMapPixel(244, 244, 244)).toBe("commercial");
    expect(classifyMapPixel(252, 224, 224)).toBe("residential");
    expect(classifyMapPixel(219, 229, 193)).toBe("open");
  });
});

describe("parcelsFromParcelMap", () => {
  const parcels = parcelsFromParcelMap(mapPixels(), SIZE, SIZE, BOX);
  const byUse = (use: string): typeof parcels =>
    parcels.filter(
      (parcel) =>
        parcel.landUse &&
        Object.entries(parcel.landUse).sort((a, b) => b[1] - a[1])[0][0] ===
          use,
    );

  it("reads one parcel per outlined area, the building merged into its plot", () => {
    expect(parcels).toHaveLength(3);
    const [trade] = byUse("commercial");
    // 50 × 80 m, building included.
    expect(trade.areaSqm).toBeGreaterThan(3900);
    expect(trade.areaSqm).toBeLessThan(4100);
    expect(trade.state).toBe("Bayern");
  });

  it("takes the land use from the ground colour", () => {
    expect(byUse("residential")).toHaveLength(1);
    expect(byUse("traffic")).toHaveLength(1);
    expect(byUse("residential")[0].areaSqm).toBeGreaterThan(3900);
    expect(byUse("traffic")[0].landUse?.traffic).toBeCloseTo(1, 5);
  });

  it("places the parcels in the map's coordinates", () => {
    const [trade] = byUse("commercial");
    const lons = trade.ring.map(([lon]) => lon);
    const lats = trade.ring.map(([, lat]) => lat);
    expect(Math.min(...lons)).toBeCloseTo(BOX.west, 5);
    expect(Math.max(...lons)).toBeCloseTo(LON, 4);
    expect(Math.min(...lats)).toBeCloseTo(BOX.south, 5);
    // The road covers the northern 20 m.
    expect(Math.max(...lats)).toBeCloseTo(BOX.north - 20 / 111_320, 4);
  });

  it("returns nothing for a blank map", () => {
    const blank = new Uint8Array(SIZE * SIZE * 4).fill(255);
    expect(parcelsFromParcelMap(blank, SIZE, SIZE, BOX)).toEqual([]);
  });
});

describe("bavariaParcelsNear", () => {
  beforeEach(() => {
    mocks.fetch.mockReset();
    mocks.cache.clear();
  });

  async function pngResponse(): Promise<Response> {
    const png = await sharp(Buffer.from(mapPixels()), {
      raw: { width: SIZE, height: SIZE, channels: 4 },
    })
      .png()
      .toBuffer();
    return new Response(new Uint8Array(png), {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  }

  it("asks nothing outside Bayern", async () => {
    expect(await bavariaParcelsNear(53.55, 9.99)).toBeNull();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("requests the coloured parcel map and caches the parcels", async () => {
    mocks.fetch.mockResolvedValue(await pngResponse());
    const parcels = await bavariaParcelsNear(LAT, LON);
    expect(parcels).toHaveLength(3);
    const url = String(mocks.fetch.mock.calls[0][0]);
    expect(url).toContain("by_alkis_parzellarkarte_farbe");
    expect(url).toContain("WIDTH=1600");
    expect(await bavariaParcelsNear(LAT, LON)).toHaveLength(3);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("returns null and caches nothing when the service fails", async () => {
    mocks.fetch.mockResolvedValue(new Response("down", { status: 503 }));
    expect(await bavariaParcelsNear(LAT, LON)).toBeNull();
    expect(mocks.cache.size).toBe(0);
  });
});
