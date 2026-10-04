import { describe, expect, it } from "vitest";
import {
  buildEsriIdentifyUrl,
  esriMetadataLayerForZoom,
  imageryAgeYears,
  parseEsriDate,
  parseEsriIdentify,
  satelliteSensorName,
} from "./imagery-metadata";

// Trimmed from live World Imagery identify responses (October 2026).
const BRANDENBURG_Z20 = {
  results: [
    {
      layerId: 8,
      layerName: "15cm Resolution Metadata",
      attributes: {
        SRC_DATE: "20190419",
        SRC_RES: "0.2",
        SRC_ACC: "0.2",
        SAMP_RES: "0.2",
        SRC_DESC: "Land Brandenburg",
        NICE_NAME: "Brandenburg2019",
        NICE_DESC: "© GeoBasis-DE/LGB",
        MinMapLevel: "20",
        MaxMapLevel: "20",
        ReleaseName: "Maps 2022.R07",
      },
    },
  ],
};

const MUNICH_Z19 = {
  results: [
    {
      layerId: 9,
      layerName: "30cm Resolution Metadata",
      attributes: {
        SRC_DATE: "20250622",
        SRC_RES: "0.5",
        SRC_ACC: "8.47",
        SAMP_RES: "0.3",
        SRC_DESC: "WV02",
        NICE_NAME: "Vivid Advanced",
        NICE_DESC: "Vantor",
        MinMapLevel: "12",
        MaxMapLevel: "19",
        ReleaseName: "Raster Basemaps 2025.R11",
      },
    },
  ],
};

describe("esriMetadataLayerForZoom", () => {
  it("maps each zoom to World Imagery's per-resolution metadata layer", () => {
    expect(esriMetadataLayerForZoom(20)).toBe(8); // 15 cm
    expect(esriMetadataLayerForZoom(19)).toBe(9); // 30 cm
    expect(esriMetadataLayerForZoom(12)).toBe(16); // 38 m
  });

  it("clamps to the layers that exist", () => {
    expect(esriMetadataLayerForZoom(25)).toBe(5);
    expect(esriMetadataLayerForZoom(3)).toBe(18);
  });
});

describe("buildEsriIdentifyUrl", () => {
  it("queries only the layer for the requested zoom at the point", () => {
    const url = new URL(buildEsriIdentifyUrl(52, 13.2, 20));
    expect(url.hostname).toBe("services.arcgisonline.com");
    expect(url.searchParams.get("layers")).toBe("all:8");
    expect(url.searchParams.get("geometry")).toBe("13.2,52");
    expect(url.searchParams.get("f")).toBe("json");
  });
});

describe("parseEsriDate", () => {
  it("converts YYYYMMDD to ISO", () => {
    expect(parseEsriDate("20190419")).toBe("2019-04-19");
    expect(parseEsriDate(20250622)).toBe("2025-06-22");
  });

  it("rejects Esri's 'Null' and malformed values", () => {
    expect(parseEsriDate("Null")).toBeNull();
    expect(parseEsriDate("2019-04-19")).toBeNull();
    expect(parseEsriDate("20191399")).toBeNull();
    expect(parseEsriDate(undefined)).toBeNull();
  });
});

describe("parseEsriIdentify", () => {
  it("extracts every published metadata field", () => {
    expect(parseEsriIdentify(BRANDENBURG_Z20, 20)).toEqual({
      provider: "esri",
      zoom: 20,
      available: true,
      capturedAt: "2019-04-19",
      source: "© GeoBasis-DE/LGB",
      collection: "Brandenburg2019",
      description: "Land Brandenburg",
      resolutionM: 0.2,
      mosaicResolutionM: 0.2,
      accuracyM: 0.2,
      minZoom: 20,
      maxZoom: 20,
      release: "Maps 2022.R07",
    });
    expect(parseEsriIdentify(MUNICH_Z19, 19)).toMatchObject({
      capturedAt: "2025-06-22",
      source: "Vantor",
      description: "WV02",
      resolutionM: 0.5,
      mosaicResolutionM: 0.3,
      accuracyM: 8.47,
      minZoom: 12,
      maxZoom: 19,
      release: "Raster Basemaps 2025.R11",
    });
  });

  it("treats Esri's 'Null' placeholders as missing", () => {
    // Low-zoom overview mosaic (TerraColor) publishes no date or release.
    const meta = parseEsriIdentify(
      {
        results: [
          {
            layerId: 18,
            attributes: {
              SRC_DATE: "Null",
              SRC_RES: "15",
              NICE_NAME: "TerraColor NextGen",
              NICE_DESC: "Earthstar Geographics",
              ReleaseName: "Null",
            },
          },
        ],
      },
      10,
    );
    expect(meta).toMatchObject({
      available: true,
      capturedAt: null,
      release: null,
      resolutionM: 15,
    });
  });

  it("ignores results from other zoom levels", () => {
    // The z19 record must not be reported as the z20 image.
    expect(parseEsriIdentify(MUNICH_Z19, 20).available).toBe(false);
  });

  it("reports unavailable for empty or unexpected responses", () => {
    expect(parseEsriIdentify({ results: [] }, 19).available).toBe(false);
    expect(parseEsriIdentify({ error: { code: 400 } }, 19).available).toBe(
      false,
    );
    expect(parseEsriIdentify(null, 19).available).toBe(false);
  });
});

describe("satelliteSensorName", () => {
  it("expands known sensor codes and leaves aerial descriptions alone", () => {
    expect(satelliteSensorName("WV02")).toBe("WorldView-2");
    expect(satelliteSensorName("ge01")).toBe("GeoEye-1");
    expect(satelliteSensorName("Land Brandenburg")).toBeNull();
    expect(satelliteSensorName(null)).toBeNull();
  });
});

describe("imageryAgeYears", () => {
  const now = new Date("2026-10-04T00:00:00Z");

  it("counts full years since capture", () => {
    expect(imageryAgeYears("2019-04-19", now)).toBe(7);
    expect(imageryAgeYears("2025-06-22", now)).toBe(1);
  });

  it("never goes negative and tolerates bad input", () => {
    expect(imageryAgeYears("2027-01-01", now)).toBe(0);
    expect(imageryAgeYears("not-a-date", now)).toBe(0);
  });
});
