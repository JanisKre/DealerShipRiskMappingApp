import { describe, expect, it } from "vitest";
import {
  classifyLandUse,
  fetchParcelRings,
  parseLandUse,
  parseParcelFeatures,
  fetchParcelsNear,
  isTruncated,
  mergeRings,
  onlyFeatureMembers,
  ringsFromUtm,
  PARCEL_MAX_PAGES,
  parseExteriorRings,
  toUtm32,
  parseWfsCounts,
  statesForPoint,
} from "./alkis.service";

/** Real GML structure of the INSPIRE feature type `cp:CadastralParcel` (Saxony). */
const INSPIRE_CP_SAMPLE = `<?xml version="1.0" encoding="utf-8"?>
<wfs:FeatureCollection xmlns:gml="http://www.opengis.net/gml/3.2" xmlns:wfs="http://www.opengis.net/wfs/2.0">
<wfs:member>
<CadastralParcel gml:id="CadastralParcel_140230___00856000100">
<areaValue uom="m2">456</areaValue>
<geometry>
<gml:Polygon gml:id="o1.position.Geom_0" srsName="http://www.opengis.net/def/crs/epsg/0/4258" srsDimension="2">
<gml:exterior>
<gml:LinearRing>
<gml:posList>51.13293563 13.78332250 51.13320113 13.78388144 51.13329230 13.78363216 51.13293563 13.78332250</gml:posList>
</gml:LinearRing>
</gml:exterior>
</gml:Polygon>
</geometry>
<label>856/1</label>
</CadastralParcel>
</wfs:member>
</wfs:FeatureCollection>`;

/**
 * Real GML structure of Hesse's INSPIRE `cp:CadastralParcel` download service
 * (live-verified 14 Sep 2026 against
 * https://inspire-hessen.de/ows/services/org.2.07247d95-adc7-4c7d-9c7a-ed17af855317_wfs):
 * geometry is a `gml:Surface`/`gml:PolygonPatch`, not a bare `gml:Polygon` —
 * the encoding the older 16-state table never tried, which is why Hesse was
 * recorded as returning nothing.
 */
const HESSEN_CP_SAMPLE = `<?xml version='1.0' encoding='UTF-8'?>
<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0" xmlns:gml="http://www.opengis.net/gml/3.2" xmlns:cp="http://inspire.ec.europa.eu/schemas/cp/4.0" numberMatched="unknown" numberReturned="0">
<wfs:member>
<cp:CadastralParcel gml:id="CadastralParcel_060460043000150010__">
<cp:areaValue uom="m2">26.0</cp:areaValue>
<cp:geometry>
<gml:Surface gml:id="GEOMETRY_9eca7a4b" srsName="urn:ogc:def:crs:EPSG::4258">
<gml:patches>
<gml:PolygonPatch>
<gml:exterior>
<gml:LinearRing>
<gml:posList>50.112922 8.679600 50.112932 8.679645 50.113020 8.679576 50.113016 8.679559 50.112922 8.679600</gml:posList>
</gml:LinearRing>
</gml:exterior>
</gml:PolygonPatch>
</gml:patches>
</gml:Surface>
</cp:geometry>
</cp:CadastralParcel>
</wfs:member>
</wfs:FeatureCollection>`;

/** Real GML structure of the NRW feature type `ave:Flurstueck` (ALKIS simplified). */
const NRW_ALKIS_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<wfs:FeatureCollection xmlns:gml="http://www.opengis.net/gml/3.2" xmlns:wfs="http://www.opengis.net/wfs/2.0" xmlns:ave="http://www.adv-online.de/ave">
<wfs:member>
<ave:Flurstueck gml:id="DENW_1234">
<ave:geom>
<gml:Polygon gml:id="p1" srsName="urn:ogc:def:crs:EPSG::4326">
<gml:exterior>
<gml:LinearRing>
<gml:posList>50.9375 6.9603 50.9380 6.9610 50.9370 6.9615 50.9375 6.9603</gml:posList>
</gml:LinearRing>
</gml:exterior>
</gml:Polygon>
</ave:geom>
</ave:Flurstueck>
</wfs:member>
</wfs:FeatureCollection>`;

describe("parseExteriorRings", () => {
  it("parses the INSPIRE schema cp:CadastralParcel (lat/lon → [lon,lat])", () => {
    const rings = parseExteriorRings(INSPIRE_CP_SAMPLE);
    expect(rings).toHaveLength(1);
    // First point: lat=51.13293563, lon=13.78332250 → GeoJSON [lon, lat]
    expect(rings[0][0]).toEqual([13.7833225, 51.13293563]);
    // Ring is closed (first == last point).
    expect(rings[0][0]).toEqual(rings[0][rings[0].length - 1]);
  });

  it("parses the NRW schema ave:Flurstueck (identical GML geometry)", () => {
    const rings = parseExteriorRings(NRW_ALKIS_SAMPLE);
    expect(rings).toHaveLength(1);
    expect(rings[0][0]).toEqual([6.9603, 50.9375]);
  });

  it("parses Hesse's gml:Surface/PolygonPatch encoding", () => {
    const rings = parseExteriorRings(HESSEN_CP_SAMPLE);
    expect(rings).toHaveLength(1);
    expect(rings[0][0]).toEqual([8.6796, 50.112922]);
    expect(rings[0][0]).toEqual(rings[0][rings[0].length - 1]);
  });

  it("returns an empty list without gml:Polygon elements", () => {
    expect(parseExteriorRings("<wfs:FeatureCollection/>")).toEqual([]);
  });

  it("skips polygons without gml:exterior/posList instead of crashing", () => {
    const broken = `<gml:Polygon><gml:interior/></gml:Polygon>`;
    expect(parseExteriorRings(broken)).toEqual([]);
  });
});

describe("fetchParcelsNear source status", () => {
  it("reports unsupportedHere for a location outside every covered state", async () => {
    // Munich/Bavaria: no state bbox in `STATE_BBOXES` covers it, so this must
    // resolve without ever touching the cache or network.
    const lookup = await fetchParcelsNear(48.137, 11.575);
    expect(lookup.status).toBe("unsupportedHere");
    expect(lookup.reachable).toBe(false);
    expect(lookup.parcels).toEqual([]);
  });
});

describe("WFS feature counts", () => {
  it("reads matched and returned from the response envelope", () => {
    const xml =
      '<wfs:FeatureCollection numberMatched="500" numberReturned="250">' +
      "</wfs:FeatureCollection>";
    expect(parseWfsCounts(xml)).toEqual({ matched: 500, returned: 250 });
  });

  it("flags a response the service could not fit in one page", () => {
    // A truncated set must not be used to assemble a multi-parcel site: which
    // parcels are missing is arbitrary, so the union would be arbitrary too.
    const xml =
      '<wfs:FeatureCollection numberMatched="500" numberReturned="250"/>';
    expect(isTruncated(xml, 250)).toBe(true);
  });

  it("does not flag a response that fit", () => {
    const xml = '<wfs:FeatureCollection numberMatched="7" numberReturned="7"/>';
    expect(isTruncated(xml, 250)).toBe(false);
  });

  it("treats a full page as possibly truncated when matched is unknown", () => {
    // Several state services stream without counting first.
    const xml =
      '<wfs:FeatureCollection numberMatched="unknown" numberReturned="250"/>';
    expect(parseWfsCounts(xml).matched).toBeNull();
    expect(isTruncated(xml, 250)).toBe(true);
  });

  it("is not fooled by a partial page with an unknown match count", () => {
    const xml =
      '<wfs:FeatureCollection numberMatched="unknown" numberReturned="12"/>';
    expect(isTruncated(xml, 250)).toBe(false);
  });

  it("returns nulls when the envelope carries no counts", () => {
    expect(parseWfsCounts("<wfs:FeatureCollection/>")).toEqual({
      matched: null,
      returned: null,
    });
    expect(isTruncated("<wfs:FeatureCollection/>", 250)).toBe(false);
  });
});

describe("curve-segment rings (Hamburg)", () => {
  it("joins the segments of a gml:Ring into one closed ring", () => {
    const xml = `<gml:Surface><gml:patches><gml:PolygonPatch><gml:exterior><gml:Ring>
      <gml:curveMember><gml:Curve><gml:segments><gml:LineStringSegment>
        <gml:posList>53.0 10.0 53.0 10.001</gml:posList>
      </gml:LineStringSegment></gml:segments></gml:Curve></gml:curveMember>
      <gml:curveMember><gml:Curve><gml:segments><gml:LineStringSegment>
        <gml:posList>53.0 10.001 53.001 10.001 53.0 10.0</gml:posList>
      </gml:LineStringSegment></gml:segments></gml:Curve></gml:curveMember>
    </gml:Ring></gml:exterior></gml:PolygonPatch></gml:patches></gml:Surface>`;
    expect(parseExteriorRings(xml)).toEqual([
      [
        [10.0, 53.0],
        [10.001, 53.0],
        [10.001, 53.001],
        [10.0, 53.0],
      ],
    ]);
  });
});

describe("toUtm32", () => {
  it("matches the published UTM values on the central meridian", () => {
    // EPSG:25832 reference: 50° N on 9° E is E 500000, N 5538630.70.
    const [east, north] = toUtm32(50, 9);
    expect(east).toBeCloseTo(500_000, 1);
    expect(north).toBeCloseTo(5_538_630.7, 0);
  });

  it("puts Erfurt where the Thüringen service finds its parcels", () => {
    const [east, north] = toUtm32(50.9787, 11.0328);
    expect(east).toBeGreaterThan(642_600);
    expect(east).toBeLessThan(642_800);
    expect(north).toBeGreaterThan(5_649_300);
    expect(north).toBeLessThan(5_649_500);
  });
});

describe("fetchParcelRings (paging)", () => {
  const endpoint = {
    url: "https://example.test/wfs",
    typeName: "x",
    crs: 4326,
  };

  /** A WFS page with `count` square parcels starting at `first`. */
  function page(first: number, count: number, matched: string): string {
    const members = Array.from({ length: count }, (_, i) => {
      const lat = 50 + (first + i) * 0.001;
      return `<wfs:member><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>${lat} 7 ${lat} 7.0005 ${lat + 0.0005} 7.0005 ${lat} 7</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></wfs:member>`;
    }).join("");
    return `<wfs:FeatureCollection numberMatched="${matched}" numberReturned="${count}">${members}</wfs:FeatureCollection>`;
  }

  it("pages with startIndex until the answer is complete", async () => {
    const calls: number[] = [];
    const result = await fetchParcelRings(
      endpoint,
      50,
      7,
      250,
      async (_e, _lat, _lon, _r, startIndex = 0) => {
        calls.push(startIndex);
        return startIndex === 0 ? page(0, 250, "300") : page(250, 50, "300");
      },
    );
    expect(calls).toEqual([0, 250]);
    expect(result).not.toBe("error");
    if (result === "error") return;
    expect(result.rings).toHaveLength(300);
    expect(result.truncated).toBe(false);
  });

  it("stops when the service ignores startIndex and keeps the answer truncated", async () => {
    const calls: number[] = [];
    const result = await fetchParcelRings(
      endpoint,
      50,
      7,
      250,
      async (_e, _lat, _lon, _r, startIndex = 0) => {
        calls.push(startIndex);
        return page(0, 250, "unknown");
      },
    );
    expect(calls).toEqual([0, 250]);
    if (result === "error") throw new Error("unexpected");
    expect(result.rings).toHaveLength(250);
    expect(result.truncated).toBe(true);
  });

  it("keeps what arrived when a later page fails", async () => {
    const result = await fetchParcelRings(
      endpoint,
      50,
      7,
      250,
      async (_e, _lat, _lon, _r, startIndex = 0) =>
        startIndex === 0 ? page(0, 250, "unknown") : "error",
    );
    if (result === "error") throw new Error("unexpected");
    expect(result.rings).toHaveLength(250);
    expect(result.truncated).toBe(true);
  });

  it("reports a failed first page as an error", async () => {
    expect(
      await fetchParcelRings(endpoint, 50, 7, 250, async () => "error"),
    ).toBe("error");
  });

  it("stops at PARCEL_MAX_PAGES", async () => {
    let calls = 0;
    await fetchParcelRings(
      endpoint,
      50,
      7,
      250,
      async (_e, _lat, _lon, _r, startIndex = 0) => {
        calls += 1;
        return page(startIndex, 250, "unknown");
      },
    );
    expect(calls).toBe(PARCEL_MAX_PAGES);
  });
});

describe("mergeRings", () => {
  it("adds only rings it does not hold yet", () => {
    const a: [number, number][] = [
      [7, 50],
      [7.001, 50],
      [7.001, 50.001],
      [7, 50],
    ];
    const b: [number, number][] = [
      [8, 51],
      [8.001, 51],
      [8.001, 51.001],
      [8, 51],
    ];
    expect(mergeRings([a], [a, b])).toEqual([a, b]);
  });
});

describe("parcel attributes (simplified ALKIS)", () => {
  const ring = (lat: number): string =>
    `<gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>${lat} 7 ${lat} 7.0005 ${lat + 0.0005} 7.0005 ${lat} 7</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon>`;
  const member = (lat: number, lage: string, tntxt?: string): string =>
    `<wfs:member><Flurstueck><lagebeztxt>${lage}</lagebeztxt>${tntxt ? `<tntxt>${tntxt}</tntxt>` : ""}<geometrie>${ring(lat)}</geometrie></Flurstueck></wfs:member>`;

  it("classifies land-use names of the different states", () => {
    expect(classifyLandUse("Straßenverkehr")).toBe("traffic");
    expect(classifyLandUse("Strassenverkehr/Fahrbahn")).toBe("traffic");
    expect(classifyLandUse("Begleitfläche Straßenverkehr")).toBe("traffic");
    expect(classifyLandUse("Weg")).toBe("traffic");
    expect(
      classifyLandUse(
        "Industrie- und Gewerbefläche(funktion:Handel und Dienstleistung)",
      ),
    ).toBe("commercial");
    expect(classifyLandUse("Handwerk")).toBe("commercial");
    expect(classifyLandUse("Fläche gemischter Nutzung")).toBe("mixed");
    expect(
      classifyLandUse(
        "Flaeche Gemischter Nutzung/Wohnen mit Handel und Dienstleistungen",
      ),
    ).toBe("mixed");
    expect(classifyLandUse("Wohnbaufläche")).toBe("residential");
    expect(classifyLandUse("Landwirtschaft(vegetationsmerkmal:Grünland)")).toBe(
      "open",
    );
    expect(classifyLandUse("Fliessgewaesser/Kanal")).toBe("open");
    expect(classifyLandUse("Platz")).toBe("other");
  });

  it("turns tntxt into shares of the parcel", () => {
    expect(parseLandUse("Straßenverkehr;249|Weg;115|Wohnbaufläche;36")).toEqual(
      { traffic: 0.91, residential: 0.09 },
    );
    expect(parseLandUse("Strassenverkehr; 1707")).toEqual({ traffic: 1 });
    expect(parseLandUse("")).toBeUndefined();
    expect(parseLandUse("unlesbar")).toBeUndefined();
  });

  it("reads address and land use per feature", () => {
    const xml = `<wfs:FeatureCollection>${member(50, "Schmiedstraße 12", "Industrie- und Gewerbefläche;362")}${member(50.001, "ohne Lage", "Landwirtschaft;900")}${member(50.002, "M&amp;R-Weg 3")}</wfs:FeatureCollection>`;
    const features = parseParcelFeatures(xml);
    expect(features).toHaveLength(3);
    expect(features[0].address).toBe("Schmiedstraße 12");
    expect(features[0].landUse).toEqual({ commercial: 1 });
    expect(features[1].address).toBeUndefined();
    expect(features[1].landUse).toEqual({ open: 1 });
    expect(features[2].address).toBe("M&R-Weg 3");
    expect(features[2].landUse).toBeUndefined();
  });

  it("falls back to bare rings without member elements", () => {
    const features = parseParcelFeatures(`<x>${ring(50)}</x>`);
    expect(features).toHaveLength(1);
    expect(features[0].address).toBeUndefined();
  });

  it("hands the attributes on with the rings and counts members when numberReturned is 0", async () => {
    const endpoint = {
      url: "https://example.test/wfs",
      typeName: "x",
      crs: 4258,
    };
    const full = `<wfs:FeatureCollection numberMatched="unknown" numberReturned="0">${Array.from({ length: 250 }, (_, i) => member(50 + i * 0.001, `Weg ${i + 1}`, "Wohnbaufläche;500")).join("")}</wfs:FeatureCollection>`;
    const result = await fetchParcelRings(
      endpoint,
      50,
      7,
      250,
      async () => full,
    );
    expect(result).not.toBe("error");
    if (result === "error") return;
    expect(result.rings).toHaveLength(250);
    // A full page of a service that always reports 0 is a capped answer.
    expect(result.truncated).toBe(true);
    expect(result.attributes.size).toBe(250);
    expect([...result.attributes.values()][0]).toEqual({
      address: "Weg 1",
      landUse: { residential: 1 },
    });
  });
});

describe("services in UTM and with several layers (v10)", () => {
  it("keeps only the parcel members of an answer with every layer", () => {
    const xml = `<wfs:FeatureCollection numberReturned="4" numberMatched="4">
      <wfs:member><wfs:FeatureCollection numberReturned="2">
        <wfs:member><Flurstueck gml:id="A"><lagebeztxt>Spritzengang 4</lagebeztxt><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>6019700 573500 6019700 573520 6019720 573520 6019700 573500</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></Flurstueck></wfs:member>
        <wfs:member><Nutzung gml:id="B"><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>1 2 3 4 5 6 1 2</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></Nutzung></wfs:member>
      </wfs:FeatureCollection></wfs:member>
    </wfs:FeatureCollection>`;
    const only = onlyFeatureMembers(xml, "Flurstueck");
    expect(only).toContain('numberReturned="1"');
    const features = parseParcelFeatures(only);
    expect(features).toHaveLength(1);
    expect(features[0].address).toBe("Spritzengang 4");
  });

  it("turns rings read from EPSG:25833 into geographic coordinates", () => {
    // parseExteriorRings flips "east north" into [north, east].
    const [[lon, lat]] = ringsFromUtm([[5_948_260.155, 262_656.515]], 33);
    expect(lat).toBeCloseTo(53.629, 2);
    expect(lon).toBeCloseTo(11.41, 2);
  });

  it("looks up Saarland parcels, before Rheinland-Pfalz", () => {
    expect(statesForPoint(49.234, 6.99)[0]).toBe("Saarland");
  });
});
