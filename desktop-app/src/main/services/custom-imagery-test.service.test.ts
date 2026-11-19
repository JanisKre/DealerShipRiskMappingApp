import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  fetchWithResilience: vi.fn(),
}));

vi.mock("./settings.service", () => ({ getSettings: mocks.getSettings }));
vi.mock("./http.service", () => ({
  fetchWithResilience: mocks.fetchWithResilience,
}));

import {
  TEST_POINT,
  TEST_ZOOM,
  testCustomImagery,
} from "./custom-imagery-test.service";

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
