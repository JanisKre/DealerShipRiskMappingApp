import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  cache: new Map<string, unknown>(),
}));
vi.mock("./http.service", () => ({ fetchWithResilience: mocks.fetch }));
vi.mock("./cache.service", () => ({
  cacheGet: (key: string) => mocks.cache.get(key),
  cacheSet: (key: string, value: unknown) => mocks.cache.set(key, value),
  TTL: { cadastre: 1 },
}));

import { toUtm32 } from "./alkis.service";
import {
  bavariaLod2Buildings,
  fromUtm32,
  isInBavariaBox,
  lod2TilesFor,
  parseLod2Chunk,
} from "./bavaria-lod2.service";

/** A building in the real LoD2 Bayern layout: function code, ground surface in UTM 32 (3D). */
function building(
  id: string,
  east: number,
  north: number,
  size: number,
  fn = "31001_2000",
): string {
  const z = 548.75;
  const ring = [
    [east, north],
    [east + size, north],
    [east + size, north + size],
    [east, north + size],
    [east, north],
  ]
    .map(([e, n]) => `${e.toFixed(3)} ${n.toFixed(3)} ${z}`)
    .join(" ");
  return `<cityObjectMember><bldg:Building gml:id="${id}"><bldg:function>${fn}</bldg:function>
<bldg:lod2Solid><gml:Solid><gml:exterior><gml:CompositeSurface><gml:surfaceMember xlink:href="#x"/></gml:CompositeSurface></gml:exterior></gml:Solid></bldg:lod2Solid>
<bldg:boundedBy><bldg:RoofSurface gml:id="${id}_r"><bldg:lod2MultiSurface><gml:MultiSurface><gml:surfaceMember><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>${ring}</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></gml:surfaceMember></gml:MultiSurface></bldg:lod2MultiSurface></bldg:RoofSurface></bldg:boundedBy>
<bldg:boundedBy><bldg:GroundSurface gml:id="${id}_g"><bldg:lod2MultiSurface><gml:MultiSurface srsDimension="3"><gml:surfaceMember><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>${ring}</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></gml:surfaceMember></gml:MultiSurface></bldg:lod2MultiSurface></bldg:GroundSurface></bldg:boundedBy>
</bldg:Building></cityObjectMember>`;
}

function tile(...buildings: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?><CityModel><gml:name>LoD2_32_700_5578_2_BY</gml:name>${buildings.join("\n")}</CityModel>`;
}

/** A streamed response that delivers the text in small chunks. */
function streamed(text: string, chunk = 97): Response {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(offset, offset + chunk));
      offset += chunk;
    },
  });
  return new Response(body, { status: 200 });
}

// A point in Munich and its UTM coordinates.
const LAT = 48.137;
const LON = 11.575;
const [E, N] = toUtm32(LAT, LON);

beforeEach(() => {
  mocks.fetch.mockReset();
  mocks.cache.clear();
});

describe("UTM 32 inverse", () => {
  it.each([
    [48.137, 11.575],
    [50.3, 10.2],
    [47.6, 9.1],
  ])("round-trips %f, %f to a few millimetres", (lat, lon) => {
    const [east, north] = toUtm32(lat, lon);
    const [lon2, lat2] = fromUtm32(east, north);
    expect(Math.abs(lat2 - lat) * 111_320).toBeLessThan(0.01);
    expect(
      Math.abs(lon2 - lon) * 111_320 * Math.cos((lat * Math.PI) / 180),
    ).toBeLessThan(0.01);
  });
});

describe("tiles", () => {
  it("names the 2 km tile by its south-west corner in km", () => {
    const tiles = lod2TilesFor(LAT, LON, 50);
    const e = Math.floor(E / 2000) * 2;
    const n = Math.floor(N / 2000) * 2;
    expect(tiles).toContain(`${e}_${n}`);
  });

  it("takes the neighbouring tiles when the box crosses a tile edge", () => {
    // 10 m from a corner of the grid.
    const [lon, lat] = fromUtm32(700_010, 5_578_010);
    expect(lod2TilesFor(lat, lon, 190).sort()).toEqual(
      ["698_5576", "698_5578", "700_5576", "700_5578"].sort(),
    );
  });

  it("knows roughly where Bayern is", () => {
    expect(isInBavariaBox(48.137, 11.575)).toBe(true);
    expect(isInBavariaBox(51.0, 7.0)).toBe(false);
  });
});

describe("parseLod2Chunk", () => {
  it("reads ground surfaces, not roofs, and marks car parks", () => {
    const { footprints } = parseLod2Chunk(
      tile(
        building("a", 700_100, 5_578_100, 20),
        building("b", 700_200, 5_578_100, 30, "31001_2461"),
      ),
    );
    expect(footprints).toHaveLength(2);
    expect(footprints[0].p).toBe(0);
    expect(footprints[1].p).toBe(1);
    // Decimetres, 2D.
    expect(footprints[0].r.slice(0, 2)).toEqual([7_001_000, 55_781_000]);
  });

  it("keeps an unfinished building for the next chunk", () => {
    const text = tile(building("a", 700_100, 5_578_100, 20));
    const cut = text.indexOf("GroundSurface");
    const first = parseLod2Chunk(text.slice(0, cut));
    expect(first.footprints).toHaveLength(0);
    const second = parseLod2Chunk(first.rest + text.slice(cut));
    expect(second.footprints).toHaveLength(1);
  });
});

describe("bavariaLod2Buildings", () => {
  const near = building(
    "near",
    Math.round(E) + 20,
    Math.round(N) + 20,
    30,
    "31001_2462",
  );
  const far = building("far", Math.round(E) + 600, Math.round(N) + 600, 30);

  it("streams the tile and returns the footprints near the point in [lon, lat]", async () => {
    mocks.fetch.mockImplementation(async () => streamed(tile(near, far)));
    const buildings = await bavariaLod2Buildings(LAT, LON, 190);
    expect(buildings).toHaveLength(1);
    expect(buildings![0].parkingRoof).toBe(true);
    const [lon, lat] = buildings![0].ring[0];
    expect(Math.abs(lat - LAT)).toBeLessThan(0.001);
    expect(Math.abs(lon - LON)).toBeLessThan(0.001);
    expect(String(mocks.fetch.mock.calls[0][0])).toMatch(
      /^https:\/\/download1\.bayernwolke\.de\/a\/lod2\/citygml\/\d+_\d+\.gml$/,
    );
  });

  it("caches a tile, so a second site in it asks nothing", async () => {
    mocks.fetch.mockImplementation(async () => streamed(tile(near)));
    await bavariaLod2Buildings(LAT, LON, 190);
    const calls = mocks.fetch.mock.calls.length;
    await bavariaLod2Buildings(LAT, LON, 190);
    expect(mocks.fetch.mock.calls.length).toBe(calls);
  });

  it("falls back to the mirror and reports null when neither answers", async () => {
    mocks.fetch.mockResolvedValue(new Response("", { status: 503 }));
    expect(await bavariaLod2Buildings(LAT, LON, 190)).toBeNull();
    expect(
      mocks.fetch.mock.calls.some((c) => String(c[0]).includes("download2")),
    ).toBe(true);
    expect(mocks.cache.size).toBe(0);
  });

  it("treats a missing tile as no buildings", async () => {
    mocks.fetch.mockResolvedValue(new Response("", { status: 404 }));
    expect(await bavariaLod2Buildings(LAT, LON, 190)).toEqual([]);
  });
});
