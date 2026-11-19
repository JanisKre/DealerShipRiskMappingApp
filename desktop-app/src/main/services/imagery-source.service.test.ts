import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  emptyImageryMetadata,
  type ImageryMetadata,
} from "@shared/imagery-metadata";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  fetchWithResilience: vi.fn(),
  getEsriImageryMetadata: vi.fn(),
  customImageryCoverage: vi.fn(),
}));

vi.mock("./settings.service", () => ({ getSettings: mocks.getSettings }));
vi.mock("./http.service", () => ({
  fetchWithResilience: mocks.fetchWithResilience,
}));
vi.mock("./custom-imagery.service", () => ({
  customImageryCoverage: mocks.customImageryCoverage,
}));
vi.mock("./imagery-metadata.service", () => ({
  getEsriImageryMetadata: mocks.getEsriImageryMetadata,
}));
vi.mock("./cache.service", () => ({
  TTL: { imageryMetadata: 1 },
  cacheKeyFragment: (v: string) => v.length.toString(16),
  cached: (_key: string, _ttl: number, fetcher: () => Promise<unknown>) =>
    fetcher(),
}));

import {
  parseBkgFlightInfo,
  stateCandidate,
  selectImageryForDetection,
  selectImageryForView,
  tileSourceForCandidate,
} from "./imagery-source.service";

function esriMeta(
  zoom: number,
  capturedAt: string | null,
  resolutionM: number,
): ImageryMetadata {
  return {
    ...emptyImageryMetadata("esri", zoom),
    available: true,
    capturedAt,
    collection: "Vivid Advanced",
    source: "Vantor",
    resolutionM,
  };
}

function bkgResponse(land: string, bildflug: string): unknown {
  return {
    ok: true,
    json: async () => ({
      type: "FeatureCollection",
      features: [{ properties: { land, bildflug, truedop: 1 } }],
    }),
  };
}

describe("parseBkgFlightInfo", () => {
  it("reads state and flight date from the BKG index", () => {
    expect(
      parseBkgFlightInfo({
        features: [{ properties: { land: "NW", bildflug: "2025-04-07" } }],
      }),
    ).toEqual({ state: "NW", flightDate: "2025-04-07" });
  });

  it("rejects empty, foreign or malformed records", () => {
    expect(parseBkgFlightInfo({ features: [] })).toBeNull();
    expect(
      parseBkgFlightInfo({
        features: [{ properties: { land: "XX", bildflug: "2025-04-07" } }],
      }),
    ).toBeNull();
    expect(
      parseBkgFlightInfo({
        features: [{ properties: { land: "NW", bildflug: "07.04.2025" } }],
      }),
    ).toBeNull();
    expect(parseBkgFlightInfo(null)).toBeNull();
  });
});

describe("selectImageryForDetection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockReturnValue({});
    mocks.getEsriImageryMetadata.mockImplementation(
      async (_lat: number, _lon: number, zoom: number) =>
        zoom === 20
          ? esriMeta(20, "2023-06-01", 0.1)
          : esriMeta(19, "2025-06-18", 0.34),
    );
    mocks.fetchWithResilience.mockResolvedValue(
      bkgResponse("NW", "2025-04-07"),
    );
  });

  it("defaults to auto and picks the state orthophoto when it wins", async () => {
    const selection = await selectImageryForDetection(51.2277, 6.7735);

    expect(selection.mode).toBe("auto");
    expect(selection.chosen).toMatchObject({
      id: "dop:NW",
      kind: "state-dop",
      capturedAt: "2025-04-07",
      dateSource: "bkg-flight-index",
      zoom: 20,
    });
    // Esri z19 (0.34 m) is too coarse for detection, so the orthophoto is
    // simply the newest sharp source.
    expect(selection.reason).toBe("newest");
    expect(selection.candidates.map((c) => c.id)).toEqual([
      "esri:z20",
      "esri:z19",
      "dop:NW",
    ]);
  });

  it("drops Esri z20 where Esri publishes no z20 imagery", async () => {
    mocks.getEsriImageryMetadata.mockImplementation(
      async (_lat: number, _lon: number, zoom: number) =>
        zoom === 20
          ? emptyImageryMetadata("esri", 20)
          : esriMeta(19, "2025-06-22", 0.5),
    );
    mocks.fetchWithResilience.mockResolvedValue(
      bkgResponse("BY", "2024-08-24"),
    );

    const selection = await selectImageryForDetection(48.137, 11.575);

    expect(selection.candidates.map((c) => c.id)).toEqual([
      "esri:z19",
      "dop:BY",
    ]);
    // The newer 0.5 m scene is too coarse for counting cars, so detection
    // takes the 0.2 m orthophoto even though it is ten months older.
    expect(selection.chosen.id).toBe("dop:BY");
    expect(selection.reason).toBe("only-option");
  });

  it("keeps Esri for detection when no source is sharp enough, and says why", async () => {
    mocks.getEsriImageryMetadata.mockImplementation(
      async (_lat: number, _lon: number, zoom: number) =>
        zoom === 20
          ? emptyImageryMetadata("esri", 20)
          : esriMeta(19, "2025-06-22", 0.5),
    );
    mocks.fetchWithResilience.mockResolvedValue({ ok: false, status: 503 });

    const selection = await selectImageryForDetection(48.137, 11.575);

    expect(selection.chosen.id).toBe("esri:z19");
    expect(selection.reason).toBe("no-sharp-source");
  });

  it("withholds a BKG date the pinned state service does not serve", async () => {
    // BKG lists a 2026 flight; Berlin publishes 2024 and 2025 only.
    mocks.fetchWithResilience.mockResolvedValue(
      bkgResponse("BE", "2026-04-12"),
    );

    const selection = await selectImageryForDetection(52.52, 13.41);
    const berlin = selection.candidates.find((c) => c.id === "dop:BE");

    expect(berlin).toMatchObject({ capturedAt: null, dateSource: "none" });
    expect(berlin?.note).toContain("2026");
    expect(selection.chosen.kind).toBe("esri");
  });

  it("falls back to Esri where the state has no open service", async () => {
    mocks.fetchWithResilience.mockResolvedValue(
      bkgResponse("HH", "2024-05-08"),
    );
    const selection = await selectImageryForDetection(53.55, 9.99);
    expect(selection.candidates.every((c) => c.kind === "esri")).toBe(true);
  });

  it("keeps working on Esri when the BKG index is unreachable", async () => {
    mocks.fetchWithResilience.mockRejectedValue(new Error("offline"));
    const selection = await selectImageryForDetection(51.2277, 6.7735);
    expect(selection.chosen.kind).toBe("esri");
  });

  it("never consults state services in fixed Esri mode", async () => {
    mocks.getSettings.mockReturnValue({ satelliteProvider: "esri" });
    const selection = await selectImageryForDetection(51.2277, 6.7735);
    expect(selection.reason).toBe("fixed-provider");
    // Of Esri's two scenes only z20 (0.1 m) is sharp enough to count cars on.
    expect(selection.chosen.id).toBe("esri:z20");
    expect(mocks.fetchWithResilience).not.toHaveBeenCalled();
  });

  it("uses only the own source where it has an image", async () => {
    mocks.getSettings.mockReturnValue({
      satelliteProvider: "wms",
      wmsTileUrl: "https://example.test/{z}/{x}/{y}.png",
    });
    mocks.customImageryCoverage.mockResolvedValue("ok");
    const selection = await selectImageryForDetection(51.2277, 6.7735);
    expect(mocks.customImageryCoverage).toHaveBeenCalledWith(51.2277, 6.7735);
    expect(selection.chosen.kind).toBe("custom");
    expect(selection.reason).toBe("fixed-provider");
    expect(selection.fallbackFrom).toBeUndefined();
    expect(mocks.getEsriImageryMetadata).not.toHaveBeenCalled();
  });

  it("makes the automatic choice where the own source has no image, and records it", async () => {
    mocks.getSettings.mockReturnValue({
      satelliteProvider: "wms",
      wmsTileUrl: "https://example.test/{z}/{x}/{y}.png",
      customImagery: { name: "DOP Hamburg" },
    });
    mocks.customImageryCoverage.mockResolvedValue("blank");
    const own = await selectImageryForDetection(51.2277, 6.7735);

    mocks.getSettings.mockReturnValue({ satelliteProvider: "auto" });
    const automatic = await selectImageryForDetection(51.2277, 6.7735);

    // The same image as in "Automatic", for the same reason …
    expect(own.chosen.id).toBe(automatic.chosen.id);
    expect(own.chosen.kind).not.toBe("custom");
    expect(own.reason).toBe(automatic.reason);
    // … with the own source on record as asked for and not used.
    expect(own.mode).toBe("wms");
    expect(own.fallbackFrom).toEqual({ label: "DOP Hamburg", gap: "blank" });
    expect(own.candidates.map((c) => c.id)).toEqual([
      ...automatic.candidates.map((c) => c.id),
      "custom",
    ]);
    expect(own.candidates.at(-1)?.note).toContain("no image at this location");
  });

  it("falls back as well when the own source cannot be reached", async () => {
    mocks.getSettings.mockReturnValue({
      satelliteProvider: "wms",
      wmsTileUrl: "https://example.test/{z}/{x}/{y}.png",
    });
    mocks.customImageryCoverage.mockResolvedValue("unreachable");
    const selection = await selectImageryForDetection(51.2277, 6.7735);
    expect(selection.chosen.kind).not.toBe("custom");
    expect(selection.fallbackFrom?.gap).toBe("unreachable");
  });

  it("labels the custom source with what the user stated about it", async () => {
    mocks.getSettings.mockReturnValue({
      satelliteProvider: "wms",
      wmsTileUrl: "https://example.test/{z}/{x}/{y}.png",
      customImagery: {
        name: "DOP Hamburg",
        attribution: "© FHH, LGV",
        resolutionM: 0.2,
      },
    });
    mocks.customImageryCoverage.mockResolvedValue("ok");
    const selection = await selectImageryForDetection(53.55, 9.99);
    expect(selection.chosen).toMatchObject({
      kind: "custom",
      label: "DOP Hamburg",
      attribution: "© FHH, LGV",
      resolutionM: 0.2,
    });
  });
});

describe("selectImageryForView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockReturnValue({ satelliteProvider: "auto" });
    mocks.getEsriImageryMetadata.mockResolvedValue(
      esriMeta(17, "2025-06-18", 0.34),
    );
    mocks.fetchWithResilience.mockResolvedValue(
      bkgResponse("NW", "2025-04-07"),
    );
  });

  it("draws the own source where the tile at the map centre is an image", async () => {
    mocks.getSettings.mockReturnValue({
      satelliteProvider: "wms",
      wmsTileUrl: "https://example.test/{z}/{x}/{y}.png",
    });
    mocks.customImageryCoverage.mockResolvedValue("ok");
    const selection = await selectImageryForView(53.55, 9.99, 12);
    // Asked at the map zoom: an overview asks for the area in view.
    expect(mocks.customImageryCoverage).toHaveBeenCalledWith(53.55, 9.99, 12);
    expect(selection.chosen).toMatchObject({ kind: "custom", zoom: 12 });
  });

  it("draws the automatic choice where the own source has no image", async () => {
    mocks.getSettings.mockReturnValue({
      satelliteProvider: "wms",
      wmsTileUrl: "https://example.test/{z}/{x}/{y}.png",
    });
    mocks.customImageryCoverage.mockResolvedValue("blank");
    const detail = await selectImageryForView(51.2, 6.8, 17);
    expect(detail.chosen).toMatchObject({ id: "dop:NW", zoom: 17 });
    expect(detail.fallbackFrom?.gap).toBe("blank");
    const overview = await selectImageryForView(51.2, 6.8, 12);
    expect(overview.chosen.kind).toBe("esri");
    expect(overview.reason).toBe("overview-zoom");
    expect(overview.fallbackFrom?.gap).toBe("blank");
  });

  it("shows Esri's mosaic at overview zoom without querying BKG", async () => {
    const selection = await selectImageryForView(51.2, 6.8, 12);
    expect(selection.reason).toBe("overview-zoom");
    expect(mocks.fetchWithResilience).not.toHaveBeenCalled();
  });

  it("switches to the state orthophoto at detail zoom", async () => {
    const selection = await selectImageryForView(51.2, 6.8, 17);
    expect(selection.chosen).toMatchObject({ id: "dop:NW", zoom: 17 });
  });

  it("shows the image detection counts on, not a newer coarse scene", async () => {
    // Esri is two years newer but 0.34 m: too coarse to count cars on, so
    // detection takes the orthophoto and the map must show the same image.
    mocks.fetchWithResilience.mockResolvedValue(
      bkgResponse("NW", "2023-04-07"),
    );
    const view = await selectImageryForView(51.2, 6.8, 18);
    const detection = await selectImageryForDetection(51.2, 6.8);
    expect(detection.chosen.id).toBe("dop:NW");
    expect(view.chosen).toMatchObject({ id: "dop:NW", zoom: 18 });
    expect(view.reason).toBe(detection.reason);
    expect(view.candidates.map((c) => c.id)).toEqual(["esri:z18", "dop:NW"]);
  });

  it("follows detection to Esri where Esri is sharp and newer", async () => {
    mocks.getEsriImageryMetadata.mockResolvedValue(
      esriMeta(19, "2025-06-18", 0.15),
    );
    mocks.fetchWithResilience.mockResolvedValue(
      bkgResponse("NW", "2023-04-07"),
    );
    const view = await selectImageryForView(51.2, 6.8, 19);
    expect(view.chosen.kind).toBe("esri");
    expect(view.reason).toBe("newest");
  });

  it("stays on Esri below the zoom a state service draws at", async () => {
    // Hessen's WMS answers with blank tiles up to z15.
    mocks.fetchWithResilience.mockResolvedValue(
      bkgResponse("HE", "2025-04-07"),
    );
    const overview = await selectImageryForView(50.11, 8.68, 15);
    expect(overview.chosen.kind).toBe("esri");
    expect(overview.reason).toBe("overview-zoom");
    const detail = await selectImageryForView(50.11, 8.68, 16);
    expect(detail.chosen.id).toBe("dop:HE");
  });
});

describe("tileSourceForCandidate", () => {
  it("routes state candidates to the state service with a distinct cache id", () => {
    mocks.getSettings.mockReturnValue({});
    const source = tileSourceForCandidate({
      id: "dop:BY",
      kind: "state-dop",
      label: "DOP20 Bayern",
      capturedAt: "2024-08-24",
      dateSource: "bkg-flight-index",
      resolutionM: 0.2,
      zoom: 20,
      attribution: "",
      state: "BY",
    });
    expect(source.cacheId.startsWith("dop:BY:")).toBe(true);
    expect(source.url(20, 363902, 558002)).toBe(
      "https://wmtsod1.bayernwolke.de/wmts/by_dop/smerc/20/558002/363902",
    );
  });

  it("routes Wayback candidates to their archived version", () => {
    const source = tileSourceForCandidate({
      id: "wayback:10321:z20",
      kind: "esri-wayback",
      label: "Esri Wayback 2022-03-16",
      capturedAt: "2020-07-01",
      dateSource: "esri-wayback-metadata",
      resolutionM: 0.2,
      zoom: 20,
      attribution: "",
      wayback: { release: 10321, publishedAt: "2022-03-16" },
    });
    expect(source.cacheId).toBe("wayback:10321");
    expect(source.url(20, 350806, 564300)).toBe(
      "https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/10321/20/350806/564300",
    );
  });
});

describe("stateCandidate", () => {
  it("dates a state image from the state's own flight-date layer", () => {
    const candidate = stateCandidate(
      { state: "NW", flightDate: "2023-03-01" },
      20,
      "2025-05-11",
    );
    expect(candidate).toMatchObject({
      capturedAt: "2025-05-11",
      dateSource: "state-flight-index",
    });
  });

  it("serves the Bremen flight year the BKG lists, dated", () => {
    const candidate = stateCandidate(
      { state: "HB", flightDate: "2023-04-21" },
      20,
    );
    expect(candidate).toMatchObject({
      capturedAt: "2023-04-21",
      dateSource: "bkg-flight-index",
      vintage: 2023,
      label: "DOP10 Bremen 2023",
    });
    expect(tileSourceForCandidate(candidate!).url(20, 1, 1)).toContain(
      "dop10_2023_HB",
    );
  });

  it("captures Bayern at z19, where its tiles end", () => {
    expect(
      stateCandidate({ state: "BY", flightDate: "2024-08-24" }, 20)?.zoom,
    ).toBe(19);
  });
});
