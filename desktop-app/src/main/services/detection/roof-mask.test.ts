import { describe, expect, it } from "vitest";
import type { DetectionResult } from "@shared/types";
import { unprojectPoint, type LonLat } from "../boundary-geometry";
import type { OsmEvidence } from "../boundary/osm-overpass";
import { excludeRoofDetections, roofRings } from "./roof-mask";

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
