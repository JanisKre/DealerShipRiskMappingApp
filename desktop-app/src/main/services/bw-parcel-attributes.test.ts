import { describe, expect, it } from "vitest";
import { ringAreaSqm, unprojectPoint, type LonLat } from "./boundary-geometry";
import type { ParcelFeature } from "./alkis.service";
import {
  attachBwAttributes,
  joinAddresses,
  parseBwAddressPoints,
  parseBwLandUse,
} from "./bw-parcel-attributes";

const ORIGIN: LonLat = [9.17, 48.77];
const at = (e: number, n: number): LonLat => unprojectPoint([e, n], ORIGIN);
function rect(w: number, s: number, e: number, n: number): LonLat[] {
  return [at(w, s), at(e, s), at(e, n), at(w, n), at(w, s)];
}
const gml = (ring: LonLat[]): string =>
  `<gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>${ring
    .map(([lon, lat]) => `${lat} ${lon}`)
    .join(" ")}</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon>`;

function addressXml(
  points: Array<{ p: LonLat; street: string; number?: string }>,
): string {
  return `<wfs:FeatureCollection>${points
    .map(
      ({ p, street, number }) => `<wfs:member><nora:v_al_lagebezeichnung>
      <nora:lagebezeichnung>${street}</nora:lagebezeichnung>
      ${number ? `<nora:hausnummer>${number}</nora:hausnummer>` : ""}
      <nora:geom><gml:Point><gml:pos>${p[1]} ${p[0]}</gml:pos></gml:Point></nora:geom>
    </nora:v_al_lagebezeichnung></wfs:member>`,
    )
    .join("")}</wfs:FeatureCollection>`;
}

function useXml(uses: Array<{ ring: LonLat[]; name: string }>): string {
  return `<wfs:FeatureCollection>${uses
    .map(
      ({ ring, name }) => `<wfs:member><nora:v_al_tatsaechliche_nutzung>
      <nora:objektname>${name}</nora:objektname>
      <nora:geom>${gml(ring)}</nora:geom>
    </nora:v_al_tatsaechliche_nutzung></wfs:member>`,
    )
    .join("")}</wfs:FeatureCollection>`;
}

const plot = (ring: LonLat[]): ParcelFeature => ({
  ring,
  areaSqm: ringAreaSqm(ring),
  state: "Baden-Württemberg",
});

describe("BW address points and land use", () => {
  it("reads address points with a house number (lat lon order)", () => {
    const points = parseBwAddressPoints(
      addressXml([
        { p: at(5, 5), street: "Hirschstraße", number: "14" },
        { p: at(6, 6), street: "Bebenhäuser Hof" },
      ]),
    );
    expect(points).toHaveLength(1);
    expect(points[0].street).toBe("Hirschstraße");
    expect(points[0].point[0]).toBeCloseTo(at(5, 5)[0], 7);
  });

  it("writes several numbers the way the address keys read them", () => {
    expect(
      joinAddresses([
        { point: ORIGIN, street: "Hirschstraße", number: "16" },
        { point: ORIGIN, street: "Hirschstraße", number: "14" },
        { point: ORIGIN, street: "Schulstraße", number: "3" },
      ]),
    ).toBe("Hirschstraße 14, 16; Schulstraße 3");
    expect(joinAddresses([])).toBeUndefined();
  });

  it("gives a parcel the addresses inside it and its sampled land use", () => {
    const yard = plot(rect(0, 0, 40, 40));
    const road = plot(rect(40, 0, 50, 40));
    const uses = parseBwLandUse(
      useXml([
        { ring: rect(0, 0, 30, 40), name: "Industrie- und Gewerbefläche" },
        { ring: rect(30, 0, 50, 40), name: "Straßenverkehr" },
      ]),
    );
    const [withAttrs, roadAttrs] = attachBwAttributes(
      [yard, road],
      parseBwAddressPoints(
        addressXml([{ p: at(10, 10), street: "Hirschstraße", number: "14" }]),
      ),
      uses,
    );
    expect(withAttrs.address).toBe("Hirschstraße 14");
    expect(withAttrs.landUse?.commercial).toBeCloseTo(0.75, 1);
    expect(withAttrs.landUse?.traffic).toBeCloseTo(0.25, 1);
    expect(roadAttrs.address).toBeUndefined();
    expect(roadAttrs.landUse).toEqual({ traffic: 1 });
  });
});
