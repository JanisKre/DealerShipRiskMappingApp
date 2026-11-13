import { describe, expect, it } from "vitest";
import {
  fetchParcelRings,
  fetchParcelsNear,
  isTruncated,
  mergeRings,
  PARCEL_MAX_PAGES,
  parseExteriorRings,
  toUtm32,
  parseWfsCounts,
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
