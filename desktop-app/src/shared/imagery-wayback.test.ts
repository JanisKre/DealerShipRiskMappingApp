import { describe, expect, it } from "vitest";
import { parseEsriIdentify } from "./imagery-metadata";
import type { ImageryCandidate } from "./imagery-sources";
import {
  buildWaybackTilemapUrl,
  buildWaybackTileUrl,
  ImageryTimelineSchema,
  parseWaybackConfig,
  parseWaybackTilemap,
  safeWaybackMetadataUrl,
  waybackCandidateForVersion,
  waybackMetadataLayerForZoom,
  waybackTileTemplate,
} from "./imagery-wayback";
import { ipcRequest, ipcResponse } from "./ipc-schema";

// Excerpt of waybackconfig.json as published in October 2026.
const CONFIG = {
  "26334": {
    itemID: "106760699ba242daab4885c9b062a133",
    itemTitle: "World Imagery (Wayback 2026-08-05)",
    itemURL:
      "https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/26334/{level}/{row}/{col}",
    metadataLayerUrl:
      "https://metadata.maptiles.arcgis.com/arcgis/rest/services/World_Imagery_Metadata_2026_r07/MapServer",
    layerIdentifier: "WB_2026_R07",
  },
  "63116": {
    itemID: "ab83ada1bd3145978eecfb115aaa10c3",
    itemTitle: "World Imagery (Wayback 2026-09-24)",
    itemURL:
      "https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/63116/{level}/{row}/{col}",
    metadataLayerUrl:
      "https://metadata.maptiles.arcgis.com/arcgis/rest/services/World_Imagery_Metadata_2026_r09/MapServer",
    layerIdentifier: "WB_2026_R09",
  },
  "10": {
    itemID: "903f0abe9c3b452dafe1ca5b8dd858b9",
    itemTitle: "World Imagery (Wayback 2014-02-20)",
    itemURL:
      "https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/10/{level}/{row}/{col}",
    layerIdentifier: "WB_2014_R01",
  },
};

describe("parseWaybackConfig", () => {
  it("lists releases newest first with their metadata services", () => {
    expect(parseWaybackConfig(CONFIG)).toEqual([
      {
        release: 63116,
        publishedAt: "2026-09-24",
        metadataLayerUrl:
          "https://metadata.maptiles.arcgis.com/arcgis/rest/services/World_Imagery_Metadata_2026_r09/MapServer",
      },
      {
        release: 26334,
        publishedAt: "2026-08-05",
        metadataLayerUrl:
          "https://metadata.maptiles.arcgis.com/arcgis/rest/services/World_Imagery_Metadata_2026_r07/MapServer",
      },
      { release: 10, publishedAt: "2014-02-20", metadataLayerUrl: null },
    ]);
  });

  it("skips malformed entries and non-object input", () => {
    expect(
      parseWaybackConfig({
        abc: CONFIG["63116"],
        "-1": CONFIG["63116"],
        "77": { itemTitle: "World Imagery" },
        "78": "nope",
      }),
    ).toEqual([]);
    expect(parseWaybackConfig(null)).toEqual([]);
    expect(parseWaybackConfig([CONFIG["63116"]])).toEqual([]);
  });

  it("drops metadata services outside Esri's Wayback metadata host", () => {
    const [release] = parseWaybackConfig({
      "5": {
        itemTitle: "World Imagery (Wayback 2020-01-08)",
        metadataLayerUrl:
          "https://evil.example.com/arcgis/rest/services/X/MapServer",
      },
    });
    expect(release.metadataLayerUrl).toBeNull();
  });
});

describe("safeWaybackMetadataUrl", () => {
  it("normalizes a valid metadata MapServer URL", () => {
    expect(
      safeWaybackMetadataUrl(
        "https://metadata.maptiles.arcgis.com/arcgis/rest/services/World_Imagery_Metadata_2026_r09/MapServer/?f=json",
      ),
    ).toBe(
      "https://metadata.maptiles.arcgis.com/arcgis/rest/services/World_Imagery_Metadata_2026_r09/MapServer",
    );
  });

  it.each([
    "http://metadata.maptiles.arcgis.com/arcgis/rest/services/A/MapServer",
    "https://metadata.maptiles.arcgis.com.evil.com/arcgis/rest/services/A/MapServer",
    "https://user:pw@metadata.maptiles.arcgis.com/arcgis/rest/services/A/MapServer",
    "https://metadata.maptiles.arcgis.com:8443/arcgis/rest/services/A/MapServer",
    "https://metadata.maptiles.arcgis.com/arcgis/rest/services/../admin/MapServer",
    "https://metadata.maptiles.arcgis.com/other/path",
    "not a url",
    42,
  ])("rejects %s", (value) => {
    expect(safeWaybackMetadataUrl(value)).toBeNull();
  });
});

describe("Wayback URLs", () => {
  it("builds tile, template and tilemap URLs from validated integers", () => {
    expect(buildWaybackTileUrl(10321, 20, 350806, 564300)).toBe(
      "https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/10321/20/350806/564300",
    );
    expect(waybackTileTemplate(63116)).toBe(
      "https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/63116/{z}/{y}/{x}",
    );
    expect(buildWaybackTilemapUrl(63116, 20, 350806, 564300)).toBe(
      "https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tilemap/63116/20/350806/564300",
    );
  });

  it("rejects invalid releases and tiles", () => {
    expect(() => buildWaybackTileUrl(0, 1, 0, 0)).toThrow(RangeError);
    expect(() => buildWaybackTileUrl(1.5, 1, 0, 0)).toThrow(RangeError);
    expect(() => buildWaybackTileUrl(10, 1, 2, 0)).toThrow(RangeError);
    expect(() => buildWaybackTilemapUrl(10, 24, 0, 0)).toThrow(RangeError);
    expect(() => waybackTileTemplate(Number.NaN)).toThrow(RangeError);
  });
});

describe("parseWaybackTilemap", () => {
  it("reads the release that holds the tile", () => {
    expect(
      parseWaybackTilemap({
        data: [1],
        location: { height: 1, left: 564300, top: 350806, width: 1 },
        select: [10321],
        size: [7809],
        valid: true,
      }),
    ).toEqual({ hasTile: true, release: 10321 });
  });

  it("reports missing imagery and malformed responses", () => {
    expect(parseWaybackTilemap({ data: [0], select: [63116] })).toEqual({
      hasTile: false,
      release: 63116,
    });
    expect(parseWaybackTilemap({ error: "x" })).toEqual({
      hasTile: false,
      release: null,
    });
    expect(parseWaybackTilemap(null)).toEqual({
      hasTile: false,
      release: null,
    });
  });
});

describe("waybackMetadataLayerForZoom", () => {
  it("maps zoom to the 0–13 Wayback metadata layers", () => {
    expect(waybackMetadataLayerForZoom(20)).toBe(3); // 15 cm
    expect(waybackMetadataLayerForZoom(19)).toBe(4); // 30 cm
    expect(waybackMetadataLayerForZoom(23)).toBe(0);
    expect(waybackMetadataLayerForZoom(5)).toBe(13);
  });

  it("parses a Wayback identify response with the Wayback layer id", () => {
    const meta = parseEsriIdentify(
      {
        results: [
          {
            layerId: 3,
            attributes: {
              SRC_DATE: "20200701",
              SRC_RES: "0.2",
              SRC_DESC: "Land Sachsen",
              NICE_NAME: "Dresden2020",
              NICE_DESC: "GeoSN",
              MinMapLevel: "20",
              MaxMapLevel: "20",
              ReleaseName: "Maps 2022.R03",
            },
          },
        ],
      },
      20,
      waybackMetadataLayerForZoom(20),
    );
    expect(meta).toMatchObject({
      available: true,
      capturedAt: "2020-07-01",
      collection: "Dresden2020",
      source: "GeoSN",
      resolutionM: 0.2,
    });
  });
});

function candidate(release: number, publishedAt: string): ImageryCandidate {
  return {
    id: `wayback:${release}:z19`,
    kind: "esri-wayback",
    label: `Esri Wayback ${publishedAt}`,
    capturedAt: "2024-01-01",
    dateSource: "esri-wayback-metadata",
    resolutionM: 0.3,
    zoom: 19,
    attribution: "",
    wayback: { release, publishedAt },
  };
}

describe("waybackCandidateForVersion", () => {
  const timeline = [
    candidate(63116, "2026-09-24"),
    candidate(22869, "2025-03-27"),
    candidate(10321, "2022-03-16"),
  ];

  it("finds the image a pinned version shows: the newest listed one not newer than it", () => {
    expect(
      waybackCandidateForVersion(timeline, {
        release: 63116,
        publishedAt: "2026-09-24",
      })?.wayback?.release,
    ).toBe(63116);
    // Release 26334 (2026-08-05) reused the 2025 image here.
    expect(
      waybackCandidateForVersion(timeline, {
        release: 26334,
        publishedAt: "2026-08-05",
      })?.wayback?.release,
    ).toBe(22869);
  });

  it("returns null when the timeline does not reach back that far", () => {
    expect(
      waybackCandidateForVersion(timeline, {
        release: 10,
        publishedAt: "2014-02-20",
      }),
    ).toBeNull();
  });
});

describe("imagery:timeline IPC", () => {
  it("validates the request like imagery:select", () => {
    const schema = ipcRequest["imagery:timeline"];
    expect(schema.safeParse({ lat: 51, lon: 13.7, zoom: 20 }).success).toBe(
      true,
    );
    expect(schema.safeParse({ lat: 91, lon: 13.7, zoom: 20 }).success).toBe(
      false,
    );
    expect(schema.safeParse({ lat: 51, lon: 13.7, zoom: 19.5 }).success).toBe(
      false,
    );
  });

  it("accepts a timeline response", () => {
    expect(ipcResponse["imagery:timeline"]).toBe(ImageryTimelineSchema);
    expect(
      ImageryTimelineSchema.safeParse({
        candidates: [candidate(63116, "2026-09-24")],
        zoom: 19,
        truncated: false,
      }).success,
    ).toBe(true);
  });
});
