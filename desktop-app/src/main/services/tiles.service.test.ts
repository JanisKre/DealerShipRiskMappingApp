import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const sharpChain = {
    resize: vi.fn(),
    removeAlpha: vi.fn(),
    raw: vi.fn(),
    toBuffer: vi.fn(),
  };
  sharpChain.resize.mockReturnValue(sharpChain);
  sharpChain.removeAlpha.mockReturnValue(sharpChain);
  sharpChain.raw.mockReturnValue(sharpChain);
  return {
    sharp: vi.fn(() => sharpChain),
    sharpChain,
    cacheGet: vi.fn(),
    cacheSet: vi.fn(),
    getSettings: vi.fn(),
    fetchWithResilience: vi.fn(),
  };
});

vi.mock("sharp", () => ({ default: mocks.sharp }));
vi.mock("./cache.service", () => ({
  cacheGet: mocks.cacheGet,
  cacheSet: mocks.cacheSet,
}));
vi.mock("./settings.service", () => ({ getSettings: mocks.getSettings }));
vi.mock("./http.service", () => ({
  fetchWithResilience: mocks.fetchWithResilience,
}));

import { TILE_SIZE } from "@shared/constants";
import { aerialImageForBbox } from "./tiles.service";

describe("aerial tile mosaics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockReturnValue({ satelliteProvider: "esri" });
    mocks.cacheGet.mockReturnValue(null);
    mocks.fetchWithResilience.mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(Buffer.from("tile")),
    });
    mocks.sharpChain.toBuffer.mockResolvedValue(
      Buffer.alloc(TILE_SIZE * TILE_SIZE * 3, 96),
    );
  });

  it("caps concurrent tile requests so a wide box cannot flood the provider", async () => {
    // The boundary evidence raster covers 400 m, which is hundreds of tiles.
    // Firing them all at once gets rate-limited rather than served faster.
    let inFlight = 0;
    let peak = 0;
    mocks.fetchWithResilience.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 0));
      inFlight -= 1;
      return {
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(Buffer.from("tile")),
      };
    });

    const capture = await aerialImageForBbox([7, 51, 7.004, 51.004], 18);

    expect(capture.tileCount).toBeGreaterThan(8);
    expect(peak).toBeLessThanOrEqual(8);
    // Every tile is still fetched and stitched; the cap only paces them.
    expect(capture.validTileCount).toBe(capture.tileCount);
    expect(mocks.fetchWithResilience).toHaveBeenCalledTimes(capture.tileCount);
  });

  it("loads, decodes and mosaics all tiles for a bbox", async () => {
    const capture = await aerialImageForBbox([7, 51, 7.0001, 51.0001], 18);

    expect(capture.tileCount).toBeGreaterThan(0);
    expect(capture.validTileCount).toBe(capture.tileCount);
    expect(capture.width % TILE_SIZE).toBe(0);
    expect(capture.height % TILE_SIZE).toBe(0);
    expect(capture.rgba).not.toBeNull();
    const rgba = capture.rgba!;
    expect(rgba).toHaveLength(capture.width * capture.height * 4);
    expect(rgba[0]).toBe(96);
    expect(rgba[3]).toBe(255);
    expect(mocks.fetchWithResilience).toHaveBeenCalled();
    expect(mocks.cacheSet).toHaveBeenCalled();
  });

  it("uses gray fallback tiles when imagery cannot be loaded", async () => {
    mocks.fetchWithResilience.mockRejectedValue(new Error("offline"));

    const capture = await aerialImageForBbox([7, 51, 7.0001, 51.0001], 18);

    expect(capture.validTileCount).toBe(0);
    expect(capture.tileCount).toBeGreaterThan(0);
    expect(capture.rgba).not.toBeNull();
    const rgba = capture.rgba!;
    expect(rgba[0]).toBe(128);
    expect(rgba[1]).toBe(128);
    expect(rgba[2]).toBe(128);
    expect(rgba[3]).toBe(255);
    // A genuine outage retries down to the floor zoom (cheap, fast-failing
    // requests) rather than getting stuck on a permanently blank mosaic —
    // it still terminates and returns a sane gray-fallback result.
    expect(capture.zoom).toBeLessThan(18);
  });

  it("retries one zoom level down when a region has no imagery at the requested zoom", async () => {
    // Some orthophoto providers don't publish their sharpest imagery
    // everywhere; a region that's unavailable at zoom 20 but fully covered
    // at zoom 19 should transparently fall back instead of returning a
    // blank mosaic.
    mocks.fetchWithResilience.mockImplementation((url: string) =>
      url.includes("/20/")
        ? Promise.resolve({ ok: false, status: 404 })
        : Promise.resolve({
            ok: true,
            arrayBuffer: vi.fn().mockResolvedValue(Buffer.from("tile")),
          }),
    );

    const capture = await aerialImageForBbox([7, 51, 7.0001, 51.0001], 20);

    expect(capture.zoom).toBe(19);
    expect(capture.validTileCount).toBe(capture.tileCount);
  });

  it("does not retry when the requested zoom already has good coverage", async () => {
    const capture = await aerialImageForBbox([7, 51, 7.0001, 51.0001], 20);

    expect(capture.zoom).toBe(20);
    expect(capture.validTileCount).toBe(capture.tileCount);
  });
});
