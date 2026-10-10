import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  emptyImageryMetadata,
  type ImageryMetadata,
} from "@shared/imagery-metadata";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  fetchWithResilience: vi.fn(),
  getEsriImageryMetadata: vi.fn(),
}));

vi.mock("./settings.service", () => ({ getSettings: mocks.getSettings }));
vi.mock("./http.service", () => ({
  fetchWithResilience: mocks.fetchWithResilience,
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
    // BKG lists a 2025 flight, the open Berlin service is truedop_2024.
    mocks.fetchWithResilience.mockResolvedValue(
      bkgResponse("BE", "2025-08-12"),
    );

    const selection = await selectImageryForDetection(52.52, 13.41);
    const berlin = selection.candidates.find((c) => c.id === "dop:BE");

    expect(berlin).toMatchObject({ capturedAt: null, dateSource: "none" });
    expect(berlin?.note).toContain("2024");
    expect(selection.chosen.kind).toBe("esri");
  });

  it("falls back to Esri where the state has no open service", async () => {
    mocks.fetchWithResilience.mockResolvedValue(
      bkgResponse("ST", "2024-07-21"),
    );
    const selection = await selectImageryForDetection(52.12, 11.63);
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

  it("uses the custom template unchanged in WMS mode", async () => {
    mocks.getSettings.mockReturnValue({
      satelliteProvider: "wms",
      wmsTileUrl: "https://example.test/{z}/{x}/{y}.png",
    });
    const selection = await selectImageryForDetection(51.2277, 6.7735);
    expect(selection.chosen.kind).toBe("custom");
    expect(mocks.getEsriImageryMetadata).not.toHaveBeenCalled();
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

  it("shows Esri's mosaic at overview zoom without querying BKG", async () => {
    const selection = await selectImageryForView(51.2, 6.8, 12);
    expect(selection.reason).toBe("overview-zoom");
    expect(mocks.fetchWithResilience).not.toHaveBeenCalled();
  });

  it("switches to the state orthophoto at detail zoom", async () => {
    const selection = await selectImageryForView(51.2, 6.8, 17);
    expect(selection.chosen).toMatchObject({ id: "dop:NW", zoom: 17 });
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
});
