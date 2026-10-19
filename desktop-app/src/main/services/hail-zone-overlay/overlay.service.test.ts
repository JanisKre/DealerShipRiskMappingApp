import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { brotliCompressSync } from "zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ dir: "" }));
vi.mock("electron", () => ({ app: { getPath: () => state.dir } }));
const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("../http.service", () => ({ fetchWithResilience: fetchMock }));

import { getHailZoneOverlay } from "./overlay.service";

const TOPOLOGY = {
  copyright: "© OpenStreetMap contributors",
  license: "ODbL-1.0",
  timestamp: "2026-02-20T15:22:54.983Z",
  arcs: [
    [
      [13, 51],
      [13.1, 51],
      [13.1, 51.1],
      [13, 51.1],
      [13, 51],
    ],
  ],
  objects: {
    postleitzahlen: {
      geometries: [
        { type: "Polygon", arcs: [[0]], properties: { postcode: "01067" } },
        // Not in the hail zone table.
        { type: "Polygon", arcs: [[0]], properties: { postcode: "00000" } },
        // Must not resolve through Object.prototype.
        {
          type: "Polygon",
          arcs: [[0]],
          properties: { postcode: "constructor" },
        },
      ],
    },
  },
};

function respondWith(body: Buffer, status = 200): void {
  fetchMock.mockResolvedValueOnce(
    new Response(new Uint8Array(body), {
      status,
      headers: { "content-length": String(body.length) },
    }),
  );
}

describe("getHailZoneOverlay", () => {
  beforeEach(async () => {
    state.dir = await mkdtemp(join(tmpdir(), "hail-overlay-"));
    fetchMock.mockReset();
  });
  afterEach(async () => {
    await rm(state.dir, { recursive: true, force: true });
  });

  it("downloads once, joins the hail zone and serves later calls from the cache", async () => {
    respondWith(brotliCompressSync(Buffer.from(JSON.stringify(TOPOLOGY))));

    const first = await getHailZoneOverlay();
    expect(first.areas.map((a) => [a.postcode, a.zone])).toEqual([
      ["01067", 2],
    ]);
    expect(first.attribution).toBe("© OpenStreetMap contributors");
    expect(first.dataDate).toBe("2026-02-20T15:22:54.983Z");

    const cacheFile = join(state.dir, "hail-zones", "overlay-v1.json");
    expect(JSON.parse(await readFile(cacheFile, "utf8")).areas).toHaveLength(1);

    const second = await getHailZoneOverlay();
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shares one download between concurrent callers", async () => {
    respondWith(brotliCompressSync(Buffer.from(JSON.stringify(TOPOLOGY))));
    const [a, b] = await Promise.all([
      getHailZoneOverlay(),
      getHailZoneOverlay(),
    ]);
    expect(a).toEqual(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects on an HTTP error and downloads again next time", async () => {
    respondWith(Buffer.from("nope"), 503);
    await expect(getHailZoneOverlay()).rejects.toThrow("HTTP 503");

    respondWith(brotliCompressSync(Buffer.from(JSON.stringify(TOPOLOGY))));
    await expect(getHailZoneOverlay()).resolves.toMatchObject({
      areas: [{ postcode: "01067" }],
    });
  });

  it("rejects data that is not a postcode topology", async () => {
    respondWith(brotliCompressSync(Buffer.from(JSON.stringify({ foo: 1 }))));
    await expect(getHailZoneOverlay()).rejects.toThrow();
  });

  it("rejects a download that contains no known postcode", async () => {
    const empty = {
      ...TOPOLOGY,
      objects: {
        postleitzahlen: {
          geometries: [
            { type: "Polygon", arcs: [[0]], properties: { postcode: "00000" } },
          ],
        },
      },
    };
    respondWith(brotliCompressSync(Buffer.from(JSON.stringify(empty))));
    await expect(getHailZoneOverlay()).rejects.toThrow("no known postcode");
  });

  it("refuses an unexpectedly large download", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("x", {
        headers: { "content-length": String(200 * 1024 * 1024) },
      }),
    );
    await expect(getHailZoneOverlay()).rejects.toThrow("unexpectedly large");
  });
});
