import { describe, expect, it } from "vitest";
import type { DetectionResult } from "@shared/types";
import { unprojectPoint, type LonLat } from "../boundary-geometry";
import type { OsmEvidence } from "../boundary/osm-overpass";
import {
  excludeRoofDetections,
  officialRoofRings,
  roofRings,
} from "./roof-mask";

const ORIGIN: LonLat = [8.51, 49.45];

function rect(w: number, s: number, e: number, n: number): LonLat[] {
  const ring = (
    [
      [w, s],
      [e, s],
      [e, n],
      [w, n],
    ] as Array<[number, number]>
  ).map((p) => unprojectPoint(p, ORIGIN));
  ring.push(ring[0]);
  return ring;
}

function detectionAt(points: Array<[number, number]>): DetectionResult {
  return {
    vehicleCount: points.length,
    confidence: 0.8,
    model: "test",
    classCounts: { car: points.length, van: 0, truck: 0, bus: 0 },
    boxes: points.map((p) => {
      const [lon, lat] = unprojectPoint(p, ORIGIN);
      return {
        x: 0,
        y: 0,
        w: 0.01,
        h: 0.01,
        score: 0.8,
        classLabel: "car",
        lon,
        lat,
      };
    }),
    evidence: {
      source: "test",
      retrievedAt: "2026-10-18T00:00:00Z",
      method: "test",
      confidence: 0.8,
      fallbackUsed: false,
      limitations: [],
    },
  };
}

const hall = rect(0, 0, 40, 20);

describe("roof mask", () => {
  it("drops detections well inside a building and keeps the yard", () => {
    // Two on the solar roof, one in the yard, one hugging the wall.
    const result = excludeRoofDetections(
      detectionAt([
        [10, 10],
        [30, 12],
        [20, -15],
        [20, 0.5],
      ]),
      [hall],
    );
    expect(result.vehicleCount).toBe(2);
    expect(result.classCounts?.car).toBe(2);
    expect(result.evidence?.limitations.join(" ")).toMatch(/2 detection/);
  });

  it("leaves the detection untouched without footprints", () => {
    const detection = detectionAt([[10, 10]]);
    expect(excludeRoofDetections(detection, [])).toBe(detection);
  });

  it("does not mask rooftop or multi-storey car parks", () => {
    const evidence: OsmEvidence = {
      areas: [
        {
          kind: "building",
          ring: hall,
          tags: { building: "industrial" },
          osmType: "way",
          osmId: 1,
        },
        {
          kind: "parking",
          ring: rect(100, 0, 140, 40),
          tags: { building: "parking" },
          osmType: "way",
          osmId: 2,
        },
        {
          kind: "parking",
          ring: rect(200, 0, 240, 40),
          tags: { building: "retail", parking: "rooftop" },
          osmType: "way",
          osmId: 3,
        },
        {
          kind: "parking",
          ring: rect(300, 0, 340, 40),
          tags: { amenity: "parking" },
          osmType: "way",
          osmId: 4,
        },
      ],
      lines: [],
      addressNodes: [],
      namedPlaces: [],
    };
    expect(roofRings(evidence)).toEqual([hall]);
  });
});

describe("official roof rings", () => {
  const office = rect(0, 0, 40, 20);
  const carPark = rect(100, 0, 140, 40);
  const osmCarPark: OsmEvidence = {
    areas: [
      {
        kind: "parking",
        ring: rect(98, -2, 142, 42),
        tags: { building: "parking" },
        osmType: "way",
        osmId: 9,
      },
    ],
    lines: [],
    addressNodes: [],
    namedPlaces: [],
  };

  it("leaves out car parks the cadastre names by function", () => {
    expect(
      officialRoofRings(
        [
          { ring: office, parkingRoof: false, functionKnown: true },
          { ring: carPark, parkingRoof: true, functionKnown: true },
        ],
        null,
      ),
    ).toEqual([office]);
  });

  it("leaves out footprints of unknown function that overlap an OSM car park", () => {
    expect(
      officialRoofRings(
        [
          { ring: office, parkingRoof: false, functionKnown: false },
          { ring: carPark, parkingRoof: false, functionKnown: false },
        ],
        osmCarPark,
      ),
    ).toEqual([office]);
  });

  it("trusts a known function over an overlapping OSM car park", () => {
    // The cadastre says office; OSM's tag is the weaker claim.
    expect(
      officialRoofRings(
        [{ ring: carPark, parkingRoof: false, functionKnown: true }],
        osmCarPark,
      ),
    ).toEqual([carPark]);
  });

  it("names the footprint sources in the provenance", () => {
    const result = excludeRoofDetections(
      detectionAt([[10, 10]]),
      [office],
      2,
      "OSM buildings + ALKIS buildings NRW",
    );
    expect(result.evidence?.method).toMatch(
      /roof mask \(OSM buildings \+ ALKIS buildings NRW\)$/,
    );
  });
});
