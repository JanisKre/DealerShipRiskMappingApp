import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchWithResilience: vi.fn(),
}));

vi.mock("./http.service", () => ({
  fetchWithResilience: mocks.fetchWithResilience,
}));
// Pass-through cache: these tests cover the lookup, not persistence.
vi.mock("./cache.service", () => ({
  TTL: { waybackConfig: 1, waybackArchive: 1 },
  cached: (_key: string, _ttl: number, fetcher: () => Promise<unknown>) =>
    fetcher(),
}));

import { waybackTimeline } from "./wayback.service";

const META = (r: string): string =>
  `https://metadata.maptiles.arcgis.com/arcgis/rest/services/World_Imagery_Metadata_${r}/MapServer`;

// Five versions; at the test point the image changed in 2026-09 (63116),
// 2025-03 (22869) and 2022-03 (10321). 26334 and 30000 reuse older images.
const CONFIG = {
  "63116": {
    itemTitle: "World Imagery (Wayback 2026-09-24)",
    metadataLayerUrl: META("2026_r09"),
  },
  "26334": {
    itemTitle: "World Imagery (Wayback 2026-08-05)",
    metadataLayerUrl: META("2026_r07"),
  },
  "22869": {
    itemTitle: "World Imagery (Wayback 2025-03-27)",
    metadataLayerUrl: META("2025_r03"),
  },
  "30000": {
    itemTitle: "World Imagery (Wayback 2023-01-11)",
    metadataLayerUrl: META("2023_r01"),
  },
  "10321": {
    itemTitle: "World Imagery (Wayback 2022-03-16)",
    metadataLayerUrl: META("2022_r03"),
  },
};

const HOLDER: Record<string, number> = {
  "63116": 63116,
  "26334": 22869,
  "22869": 22869,
  "30000": 10321,
  "10321": 10321,
};

const SCENES: Record<string, { date: string; res: string; name: string }> = {
  "2026_r09": { date: "20260319", res: "0.31", name: "Vivid Advanced" },
  "2025_r03": { date: "20240611", res: "0.31", name: "Vivid Advanced" },
  "2022_r03": { date: "20200701", res: "0.2", name: "Dresden2020" },
};

function json(body: unknown): unknown {
  return { ok: true, json: async () => body };
}

interface Options {
  /** Zoom levels without imagery in any version. */
  emptyZooms?: number[];
  /** Metadata services that fail. */
  failingMeta?: string[];
  config?: unknown;
}

function route({ emptyZooms = [], failingMeta = [], config = CONFIG }: Options = {}) {
  return async (input: string): Promise<unknown> => {
    const url = String(input);
    if (url.includes("waybackconfig.json")) return json(config);
    const tilemap = /\/tilemap\/(\d+)\/(\d+)\//.exec(url);
    if (tilemap) {
      const [, release, z] = tilemap;
      if (emptyZooms.includes(Number(z))) {
        return json({ data: [0], select: [Number(release)], valid: true });
      }
      return json({ data: [1], select: [HOLDER[release]], valid: true });
    }
    const meta = /World_Imagery_Metadata_(\w+)\/MapServer\/identify\?(.*)$/.exec(
      url,
    );
    if (meta) {
      const [, key, query] = meta;
      if (failingMeta.includes(key)) return { ok: false, status: 500 };
      const layer = Number(
        new URLSearchParams(query).get("layers")?.split(":")[1],
      );
      const scene = SCENES[key];
      return json({
        results: [
          {
            layerId: layer,
            attributes: {
              SRC_DATE: scene.date,
              SRC_RES: scene.res,
              NICE_NAME: scene.name,
              NICE_DESC: "Vantor",
            },
          },
        ],
      });
    }
    throw new Error(`unexpected ${url}`);
  };
}

describe("waybackTimeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists only versions whose image changed, dated via their metadata", async () => {
    mocks.fetchWithResilience.mockImplementation(route());

    const timeline = await waybackTimeline(51.0504, 13.7373, 19);

    expect(timeline.zoom).toBe(19);
    expect(timeline.truncated).toBe(false);
    expect(
      timeline.candidates.map((c) => [c.wayback?.release, c.capturedAt]),
    ).toEqual([
      [63116, "2026-03-19"],
      [22869, "2024-06-11"],
      [10321, "2020-07-01"],
    ]);
    expect(timeline.candidates[2]).toMatchObject({
      id: "wayback:10321:z19",
      kind: "esri-wayback",
      dateSource: "esri-wayback-metadata",
      resolutionM: 0.2,
      label: "Esri Wayback 2022-03-16 (Dresden2020)",
      wayback: { release: 10321, publishedAt: "2022-03-16" },
    });
    // One tilemap step per change, not one per release: after each holder
    // the walk continues with the version just below it.
    const tilemapReleases = mocks.fetchWithResilience.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes("/tilemap/"))
      .map((u) => u.split("/tilemap/")[1].split("/")[0]);
    expect(tilemapReleases).toEqual(["63116", "26334", "30000"]);
    // Metadata is queried on the Wayback layer for z19 (30 cm = layer 4).
    const identify = mocks.fetchWithResilience.mock.calls
      .map((c) => String(c[0]))
      .find((u) => u.includes("/identify?"));
    expect(identify).toContain("layers=all%3A4");
  });

  it("drops one zoom level where the newest version has no imagery", async () => {
    mocks.fetchWithResilience.mockImplementation(route({ emptyZooms: [20] }));

    const timeline = await waybackTimeline(51.0504, 13.7373, 20);

    expect(timeline.zoom).toBe(19);
    expect(timeline.candidates).toHaveLength(3);
    expect(timeline.candidates[0].id).toBe("wayback:63116:z19");
  });

  it("returns an empty timeline where no version has imagery", async () => {
    mocks.fetchWithResilience.mockImplementation(
      route({ emptyZooms: [19, 20] }),
    );

    await expect(waybackTimeline(51.0504, 13.7373, 20)).resolves.toEqual({
      candidates: [],
      zoom: 19,
      truncated: false,
    });
  });

  it("stops at the limit and reports older versions as truncated", async () => {
    mocks.fetchWithResilience.mockImplementation(route());

    const timeline = await waybackTimeline(51.0504, 13.7373, 19, 2);

    expect(timeline.candidates.map((c) => c.wayback?.release)).toEqual([
      63116, 22869,
    ]);
    expect(timeline.truncated).toBe(true);
  });

  it("keeps undated versions when their metadata lookup fails", async () => {
    mocks.fetchWithResilience.mockImplementation(
      route({ failingMeta: ["2025_r03"] }),
    );

    const timeline = await waybackTimeline(51.0504, 13.7373, 19);

    expect(timeline.candidates[1]).toMatchObject({
      capturedAt: null,
      dateSource: "none",
      wayback: { release: 22869 },
    });
  });

  it("de-duplicates versions that show the same scene", async () => {
    SCENES["2025_r03_dup"] = SCENES["2026_r09"];
    mocks.fetchWithResilience.mockImplementation(
      route({
        config: {
          ...CONFIG,
          "22869": {
            itemTitle: "World Imagery (Wayback 2025-03-27)",
            metadataLayerUrl: META("2025_r03_dup"),
          },
        },
      }),
    );

    const timeline = await waybackTimeline(51.0504, 13.7373, 19);

    expect(timeline.candidates.map((c) => c.wayback?.release)).toEqual([
      63116, 10321,
    ]);
  });

  it("propagates a config outage so the renderer can show no timeline", async () => {
    mocks.fetchWithResilience.mockResolvedValue({ ok: false, status: 503 });
    await expect(waybackTimeline(51, 13, 19)).rejects.toThrow(/503/);
  });
});
