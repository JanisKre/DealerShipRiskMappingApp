import { describe, expect, it } from "vitest";
import {
  describeImagerySelection,
  fillTileTemplate,
  GERMAN_STATES,
  selectImagery,
  stateAttribution,
  STATE_DOP_SERVICES,
  stateTileTemplate,
  tileBboxEpsg3857,
  type ImageryCandidate,
} from "./imagery-sources";

function candidate(
  id: string,
  capturedAt: string | null,
  resolutionM: number | null,
  kind: ImageryCandidate["kind"] = id.startsWith("dop") ? "state-dop" : "esri",
): ImageryCandidate {
  return {
    id,
    kind,
    label: id,
    capturedAt,
    dateSource: capturedAt ? "esri-metadata" : "none",
    resolutionM,
    zoom: 20,
    attribution: "",
  };
}

describe("selectImagery", () => {
  // Fixtures mirror the live comparison from October 2026.
  it("prefers a sharper orthophoto that is less than 6 months older (Düsseldorf)", () => {
    const esri19 = candidate("esri:z19", "2025-06-18", 0.34);
    const esri20 = candidate("esri:z20", "2023-06-01", 0.1);
    const dop = candidate("dop:NW", "2025-04-07", 0.1);
    const { chosen, reason } = selectImagery([esri20, esri19, dop], esri20);
    expect(chosen.id).toBe("dop:NW");
    expect(reason).toBe("sharper-within-tolerance");
  });

  it("keeps the newer satellite scene when the orthophoto is much older (Munich)", () => {
    const esri19 = candidate("esri:z19", "2025-06-22", 0.5);
    const dop = candidate("dop:BY", "2024-08-24", 0.2);
    const { chosen, reason } = selectImagery([esri19, dop], esri19);
    expect(chosen.id).toBe("esri:z19");
    expect(reason).toBe("newest");
  });

  it("never counts on Esri's old z20 orthophoto when z19 is years newer (Dresden)", () => {
    const esri20 = candidate("esri:z20", "2020-07-01", 0.2);
    const esri19 = candidate("esri:z19", "2025-02-04", 0.46);
    const dop = candidate("dop:SN", "2024-03-19", 0.2);
    expect(selectImagery([esri20, esri19, dop], esri20).chosen.id).toBe(
      "esri:z19",
    );
  });

  it("excludes sources too coarse to resolve cars", () => {
    const coarse = candidate("esri:z11", "2026-01-01", 15);
    const fine = candidate("dop:BB", "2024-04-30", 0.2);
    expect(selectImagery([coarse, fine], coarse).chosen.id).toBe("dop:BB");
  });

  it("reports dated but too-coarse sources as no sharp source", () => {
    const fallback = candidate("esri:z19", "2025-06-22", 0.5);
    const result = selectImagery([fallback], fallback, {
      maxResolutionM: 0.25,
    });
    expect(result).toEqual({ chosen: fallback, reason: "no-sharp-source" });
  });

  it("falls back when nothing is dated", () => {
    const fallback = candidate("esri:z19", null, 0.5);
    const result = selectImagery(
      [fallback, candidate("dop:BE", null, 0.2)],
      fallback,
    );
    expect(result).toEqual({ chosen: fallback, reason: "no-dated-source" });
  });

  it("reports a single dated source as the only option", () => {
    const only = candidate("esri:z19", "2025-03-19", 0.34);
    expect(selectImagery([only], only).reason).toBe("only-option");
  });

  it("breaks resolution ties in favour of the newer source", () => {
    const older = candidate("esri:z20", "2025-02-15", 0.2);
    const newer = candidate("dop:HH", "2025-02-18", 0.2);
    expect(selectImagery([older, newer], older).chosen.id).toBe("dop:HH");
  });

  it("honours a custom tolerance", () => {
    const esri = candidate("esri:z19", "2025-06-18", 0.34);
    const dop = candidate("dop:NW", "2025-04-07", 0.1);
    expect(
      selectImagery([esri, dop], esri, { toleranceDays: 30 }).chosen.id,
    ).toBe("esri:z19");
  });
});

describe("tile templates", () => {
  it("computes Web Mercator tile bounds", () => {
    const [minX, minY, maxX, maxY] = tileBboxEpsg3857(0, 0, 0);
    expect(minX).toBeCloseTo(-20037508.34, 1);
    expect(maxY).toBeCloseTo(20037508.34, 1);
    expect(maxX).toBeCloseTo(20037508.34, 1);
    expect(minY).toBeCloseTo(-20037508.34, 1);
    const [a, , c] = tileBboxEpsg3857(19, 272008, 174991);
    // One z19 tile is ~76 m wide in Web Mercator units.
    expect(c - a).toBeCloseTo(76.437, 2);
  });

  it("fills XYZ templates for Bavaria", () => {
    expect(
      fillTileTemplate(
        stateTileTemplate(STATE_DOP_SERVICES.BY!),
        19,
        279001,
        181951,
      ),
    ).toBe("https://wmtsod1.bayernwolke.de/wmts/by_dop/smerc/19/279001/181951");
  });

  it("renders one WMS tile per request for WMS states", () => {
    const url = new URL(
      fillTileTemplate(
        stateTileTemplate(STATE_DOP_SERVICES.NW!),
        19,
        272008,
        174991,
      ),
    );
    expect(url.searchParams.get("REQUEST")).toBe("GetMap");
    expect(url.searchParams.get("LAYERS")).toBe("nw_dop_rgb");
    expect(url.searchParams.get("CRS")).toBe("EPSG:3857");
    expect(url.searchParams.get("WIDTH")).toBe("256");
    expect(url.searchParams.get("BBOX")).toBe(
      tileBboxEpsg3857(19, 272008, 174991).join(","),
    );
  });

  it("keeps existing query parameters of a WMS base URL", () => {
    const url = new URL(
      fillTileTemplate(stateTileTemplate(STATE_DOP_SERVICES.HE!), 18, 1, 1),
    );
    expect(url.searchParams.get("language")).toBe("ger");
    expect(url.searchParams.get("LAYERS")).toBe("he_dop20_rgb");
  });
});

describe("STATE_DOP_SERVICES", () => {
  it("only lists HTTPS services with a layer for every WMS entry", () => {
    for (const service of Object.values(STATE_DOP_SERVICES)) {
      expect(service.url.startsWith("https://")).toBe(true);
      expect(GERMAN_STATES).toContain(service.state);
      if (service.kind === "wms") expect(service.layer).toBeTruthy();
      expect(service.resolutionM).toBeLessThanOrEqual(0.2);
    }
    // Hamburg and Sachsen-Anhalt have no verified open endpoint yet.
    expect(Object.keys(STATE_DOP_SERVICES)).toHaveLength(14);
  });

  it("inserts the retrieval year into attributions", () => {
    expect(stateAttribution(STATE_DOP_SERVICES.NI!, 2026)).toBe(
      "© LGLN (2026), CC BY 4.0",
    );
  });
});

describe("describeImagerySelection", () => {
  it("summarises source, date, resolution and reason", () => {
    const dop = candidate("dop:NW", "2025-04-07", 0.1);
    expect(
      describeImagerySelection({
        mode: "auto",
        chosen: { ...dop, label: "DOP10 Nordrhein-Westfalen" },
        reason: "sharper-within-tolerance",
        candidates: [dop],
        toleranceDays: 183,
        resolvedAt: "2026-10-04T00:00:00.000Z",
      }),
    ).toBe(
      "Vehicles counted on DOP10 Nordrhein-Westfalen (2025-04-07, 0.1 m, z20; selection: sharper-within-tolerance)",
    );
  });
});
