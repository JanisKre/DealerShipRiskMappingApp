import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  fetchWithResilience: vi.fn(),
  /** Lifetime the coverage answer was cached with, per cache key. */
  ttl: new Map<string, number>(),
}));

vi.mock("./cache.service", () => ({
  cacheKeyFragment: (v: string) => v.length.toString(16),
  cached: async (
    key: string,
    ttlMs: number,
    fetcher: () => Promise<unknown>,
    ttlFor?: (value: unknown) => number,
  ) => {
    const value = await fetcher();
    mocks.ttl.set(key, ttlFor ? ttlFor(value) : ttlMs);
    return value;
  },
}));

vi.mock("./settings.service", () => ({ getSettings: mocks.getSettings }));
vi.mock("./http.service", () => ({
  fetchWithResilience: mocks.fetchWithResilience,
}));

import {
  customImageryCoverage,
  TEST_POINT,
  TEST_ZOOM,
  testCustomImagery,
} from "./custom-imagery.service";

const TEMPLATE = "https://tiles.example.test/{z}/{x}/{y}.jpg";

/** A 256 px tile: one flat colour, or a gradient standing in for an image. */
async function tile(flat: boolean): Promise<Buffer> {
  const pixels = Buffer.alloc(256 * 256 * 3, 255);
  if (!flat) {
    for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 7) % 256;
  }
  return sharp(pixels, { raw: { width: 256, height: 256, channels: 3 } })
    .png()
    .toBuffer();
}

function answer(body: Buffer | string, contentType: string): Response {
  return new Response(typeof body === "string" ? body : new Uint8Array(body), {
    headers: { "content-type": contentType },
  });
}

describe("testCustomImagery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockReturnValue({ wmsTileUrl: TEMPLATE });
  });

  it("does not fetch without a saved, valid template", async () => {
    mocks.getSettings.mockReturnValue({
      wmsTileUrl: "http://insecure.example.test/{z}/{x}/{y}",
    });
    const result = await testCustomImagery();
    expect(result).toMatchObject({ ok: false, code: "not-configured" });
    expect(mocks.fetchWithResilience).not.toHaveBeenCalled();
  });

  it("fetches one tile of the saved template at the given point", async () => {
    mocks.fetchWithResilience.mockResolvedValue(
      answer(await tile(false), "image/png"),
    );
    // Dresden city centre is in z18 tile x 141075, y 87701.
    const result = await testCustomImagery({ lat: 51.0504, lon: 13.7373 });
    expect(mocks.fetchWithResilience).toHaveBeenCalledTimes(1);
    expect(mocks.fetchWithResilience.mock.calls[0][0]).toBe(
      "https://tiles.example.test/18/141075/87701.jpg",
    );
    expect(result).toMatchObject({
      ok: true,
      code: "ok",
      lat: 51.0504,
      lon: 13.7373,
      zoom: TEST_ZOOM,
    });
    expect(result.preview).toMatch(/^data:image\/png;base64,/);
  });

  it("uses the fixed sample point without one", async () => {
    mocks.fetchWithResilience.mockResolvedValue(
      answer(await tile(false), "image/png"),
    );
    const result = await testCustomImagery();
    expect(result).toMatchObject({ ...TEST_POINT, ok: true });
  });

  it("reports a flat tile as outside the coverage, with the tile", async () => {
    mocks.fetchWithResilience.mockResolvedValue(
      answer(await tile(true), "image/png"),
    );
    const result = await testCustomImagery();
    expect(result).toMatchObject({ ok: false, code: "blank" });
    expect(result.preview).toBeDefined();
  });

  it("shows the start of a WMS error document sent with HTTP 200", async () => {
    mocks.fetchWithResilience.mockResolvedValue(
      answer(
        '<ServiceExceptionReport>\n  <ServiceException code="LayerNotDefined">unknown layer</ServiceException></ServiceExceptionReport>',
        "text/xml",
      ),
    );
    const result = await testCustomImagery();
    expect(result).toMatchObject({ ok: false, code: "not-an-image" });
    expect(result.detail).toContain("LayerNotDefined");
    expect(result.preview).toBeUndefined();
  });

  it("reports the HTTP status of a refused request", async () => {
    mocks.fetchWithResilience.mockResolvedValue(
      new Response("no", { status: 403 }),
    );
    expect(await testCustomImagery()).toMatchObject({
      ok: false,
      code: "http-error",
      status: 403,
    });
  });

  it("reports a network failure without throwing", async () => {
    mocks.fetchWithResilience.mockRejectedValue(
      new Error("getaddrinfo ENOTFOUND"),
    );
    expect(await testCustomImagery()).toMatchObject({
      ok: false,
      code: "unreachable",
      detail: "getaddrinfo ENOTFOUND",
    });
  });
});

describe("customImageryCoverage", () => {
  const HOUR = 60 * 60 * 1000;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ttl.clear();
    mocks.getSettings.mockReturnValue({ wmsTileUrl: TEMPLATE });
  });

  it("asks for the zoom-18 tile of a site and trusts an image for a day", async () => {
    mocks.fetchWithResilience.mockResolvedValue(
      answer(await tile(false), "image/png"),
    );
    expect(await customImageryCoverage(51.0504, 13.7373)).toBe("ok");
    expect(mocks.fetchWithResilience.mock.calls[0][0]).toBe(
      "https://tiles.example.test/18/141075/87701.jpg",
    );
    expect([...mocks.ttl.values()]).toEqual([24 * HOUR]);
  });

  it("asks at the map zoom for an overview and never above zoom 18", async () => {
    mocks.fetchWithResilience.mockImplementation(async () =>
      answer(await tile(false), "image/png"),
    );
    await customImageryCoverage(51.0504, 13.7373, 6);
    await customImageryCoverage(51.0504, 13.7373, 21);
    expect(mocks.fetchWithResilience.mock.calls.map((c) => c[0])).toEqual([
      "https://tiles.example.test/6/34/21.jpg",
      "https://tiles.example.test/18/141075/87701.jpg",
    ]);
  });

  it("reads a flat tile as no image here", async () => {
    mocks.fetchWithResilience.mockResolvedValue(
      answer(await tile(true), "image/png"),
    );
    expect(await customImageryCoverage(51.0504, 13.7373)).toBe("blank");
    expect([...mocks.ttl.values()]).toEqual([24 * HOUR]);
  });

  it("asks again soon after an error instead of trusting it for a day", async () => {
    mocks.fetchWithResilience.mockRejectedValue(new Error("offline"));
    expect(await customImageryCoverage(51.0504, 13.7373)).toBe("unreachable");
    mocks.fetchWithResilience.mockResolvedValue(
      new Response("no", { status: 401 }),
    );
    expect(await customImageryCoverage(48.137, 11.575)).toBe("http-error");
    expect([...mocks.ttl.values()]).toEqual([5 * 60 * 1000, 5 * 60 * 1000]);
  });

  it("does not fetch without a usable template", async () => {
    mocks.getSettings.mockReturnValue({});
    expect(await customImageryCoverage(51.0504, 13.7373)).toBe("unreachable");
    expect(mocks.fetchWithResilience).not.toHaveBeenCalled();
  });
});
