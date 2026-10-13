import { describe, expect, it } from "vitest";
import {
  buildCmrGranuleSearchUrl,
  gibsTileTemplate,
  isSceneDay,
  mergeRecentScenes,
  parseCmrGranules,
  recentSceneKey,
  RecentScenesSchema,
} from "./imagery-gibs";
import { ipcRequest, ipcResponse } from "./ipc-schema";

function granule(begin: string, cloud: string | null): unknown {
  return {
    umm: {
      GranuleUR: `HLS.S30.T33UVS.${begin}`,
      TemporalExtent: { RangeDateTime: { BeginningDateTime: begin } },
      AdditionalAttributes:
        cloud == null ? [] : [{ Name: "CLOUD_COVERAGE", Values: [cloud] }],
    },
  };
}

describe("gibsTileTemplate", () => {
  it("builds the GIBS WMTS template for a product and day", () => {
    expect(gibsTileTemplate("S30", "2026-10-06")).toBe(
      "https://gibs-{s}.earthdata.nasa.gov/wmts/epsg3857/best/HLS_S30_Nadir_BRDF_Adjusted_Reflectance/default/2026-10-06/GoogleMapsCompatible_Level12/{z}/{y}/{x}.png",
    );
    expect(gibsTileTemplate("L30", "2026-09-01")).toContain(
      "/HLS_L30_Nadir_BRDF_Adjusted_Reflectance/default/2026-09-01/",
    );
  });

  it("rejects anything but an ISO day", () => {
    expect(() => gibsTileTemplate("S30", "2026-10-06/../x")).toThrow(
      RangeError,
    );
    expect(() => gibsTileTemplate("S30", "2026-13-45")).toThrow(RangeError);
    expect(isSceneDay("2026-10-06")).toBe(true);
    expect(isSceneDay(20261006)).toBe(false);
  });
});

describe("buildCmrGranuleSearchUrl", () => {
  it("queries the HLS collection with bbox, window and cloud filter", () => {
    const url = new URL(
      buildCmrGranuleSearchUrl(
        "S30",
        [13.73, 51.04, 13.75, 51.06],
        "2026-08-15T00:00:00Z",
        "2026-10-13T00:00:00Z",
        40,
      ),
    );
    expect(url.origin + url.pathname).toBe(
      "https://cmr.earthdata.nasa.gov/search/granules.umm_json",
    );
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      collection_concept_id: "C2021957295-LPCLOUD",
      bounding_box: "13.73,51.04,13.75,51.06",
      temporal: "2026-08-15T00:00:00Z,2026-10-13T00:00:00Z",
      cloud_cover: "0,40",
      sort_key: "-start_date",
    });
  });

  it("clamps the cloud limit to 0–100", () => {
    const url = buildCmrGranuleSearchUrl("L30", [0, 0, 1, 1], "a", "b", 250);
    expect(url).toContain("cloud_cover=0%2C100");
    expect(url).toContain("C2021957657-LPCLOUD");
  });
});

describe("parseCmrGranules", () => {
  it("returns one scene per day, keeping the clearer granule, newest first", () => {
    expect(
      parseCmrGranules(
        {
          items: [
            granule("2026-09-26T10:16:50.982Z", "1"),
            granule("2026-10-06T10:16:50.240Z", "10"),
            granule("2026-10-06T10:16:52.000Z", "4"),
            granule("2026-08-27T10:16:52.423Z", null),
          ],
        },
        "S30",
      ),
    ).toEqual([
      { product: "S30", day: "2026-10-06", cloudPct: 4 },
      { product: "S30", day: "2026-09-26", cloudPct: 1 },
      { product: "S30", day: "2026-08-27", cloudPct: null },
    ]);
  });

  it("skips malformed granules and responses", () => {
    expect(
      parseCmrGranules(
        {
          items: [
            { umm: { TemporalExtent: {} } },
            granule("not-a-date", "1"),
            granule("2026-10-06T10:16:50Z", "150"),
            null,
          ],
        },
        "S30",
      ),
    ).toEqual([{ product: "S30", day: "2026-10-06", cloudPct: null }]);
    expect(parseCmrGranules({ errors: ["x"] }, "S30")).toEqual([]);
    expect(parseCmrGranules(null, "L30")).toEqual([]);
  });
});

describe("mergeRecentScenes", () => {
  it("orders by day, then by cloud cover", () => {
    const merged = mergeRecentScenes([
      [
        { product: "S30", day: "2026-10-06", cloudPct: 10 },
        { product: "S30", day: "2026-09-01", cloudPct: 0 },
      ],
      [
        { product: "L30", day: "2026-10-06", cloudPct: 2 },
        { product: "L30", day: "2026-09-20", cloudPct: null },
      ],
    ]);
    expect(merged.map(recentSceneKey)).toEqual([
      "L30:2026-10-06",
      "S30:2026-10-06",
      "L30:2026-09-20",
      "S30:2026-09-01",
    ]);
  });
});

describe("imagery:recentScenes IPC", () => {
  it("validates coordinates and the response shape", () => {
    const req = ipcRequest["imagery:recentScenes"];
    expect(req.safeParse({ lat: 51, lon: 13.7 }).success).toBe(true);
    expect(req.safeParse({ lat: 51, lon: 200 }).success).toBe(false);
    expect(ipcResponse["imagery:recentScenes"]).toBe(RecentScenesSchema);
    expect(
      RecentScenesSchema.safeParse({
        scenes: [{ product: "S30", day: "2026-10-06", cloudPct: 4 }],
        days: 60,
        maxCloud: 40,
      }).success,
    ).toBe(true);
    expect(
      RecentScenesSchema.safeParse({
        scenes: [{ product: "X", day: "2026-10-06", cloudPct: 4 }],
        days: 60,
        maxCloud: 40,
      }).success,
    ).toBe(false);
  });
});
