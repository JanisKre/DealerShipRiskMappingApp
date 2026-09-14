import { describe, expect, it } from "vitest";
import {
  fetchParcelsNear,
  isTruncated,
  parseExteriorRings,
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
    const xml = '<wfs:FeatureCollection numberMatched="500" numberReturned="250"/>';
    expect(isTruncated(xml, 250)).toBe(true);
  });

  it("does not flag a response that fit", () => {
    const xml = '<wfs:FeatureCollection numberMatched="7" numberReturned="7"/>';
    expect(isTruncated(xml, 250)).toBe(false);
  });

  it("treats a full page as possibly truncated when matched is unknown", () => {
    // Several state services stream without counting first.
    const xml = '<wfs:FeatureCollection numberMatched="unknown" numberReturned="250"/>';
    expect(parseWfsCounts(xml).matched).toBeNull();
    expect(isTruncated(xml, 250)).toBe(true);
  });

  it("is not fooled by a partial page with an unknown match count", () => {
    const xml = '<wfs:FeatureCollection numberMatched="unknown" numberReturned="12"/>';
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
