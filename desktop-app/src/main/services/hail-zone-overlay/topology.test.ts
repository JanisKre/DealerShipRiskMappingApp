import { describe, expect, it } from "vitest";
import {
  simplifyLine,
  topologyToOverlayAreas,
  type PostcodeTopology,
} from "./topology";

// Two unit squares sharing the edge x = 1 (arc 1). Arc 1 has a tiny kink that
// simplification must remove on both sides in the same way.
const SHARED_EDGE: [number, number][] = [
  [1, 0],
  [1.00001, 0.5],
  [1, 1],
];
const TOPOLOGY: PostcodeTopology = {
  arcs: [
    // 0: left square, outer path from (1,1) around to (1,0)
    [
      [1, 1],
      [0, 1],
      [0, 0],
      [1, 0],
    ],
    // 1: shared edge from (1,0) to (1,1)
    SHARED_EDGE,
    // 2: right square, outer path from (1,0) around to (1,1)
    [
      [1, 0],
      [2, 0],
      [2, 1],
      [1, 1],
    ],
  ],
  objects: {
    postleitzahlen: {
      geometries: [
        { type: "Polygon", arcs: [[0, 1]], properties: { postcode: "10000" } },
        { type: "Polygon", arcs: [[2, -2]], properties: { postcode: "20000" } },
        { type: "Polygon", arcs: [[2, -2]], properties: { postcode: "99999" } },
        { type: "Polygon", arcs: [[2, -2]], properties: {} },
      ],
    },
  },
};

const zoneOf = (postcode: string): 1 | 2 | 3 | 4 | 5 | 6 | null =>
  postcode === "10000" ? 3 : postcode === "20000" ? 6 : null;

describe("simplifyLine", () => {
  it("keeps the end points and drops points within the tolerance", () => {
    const line: [number, number][] = [
      [0, 0],
      [0.5, 0.0001],
      [1, 0],
    ];
    expect(simplifyLine(line, 0.001)).toEqual([
      [0, 0],
      [1, 0],
    ]);
  });

  it("keeps points that deviate more than the tolerance", () => {
    const line: [number, number][] = [
      [0, 0],
      [0.5, 0.5],
      [1, 0],
    ];
    expect(simplifyLine(line, 0.001)).toHaveLength(3);
  });
});

describe("topologyToOverlayAreas", () => {
  const areas = topologyToOverlayAreas(TOPOLOGY, zoneOf, 0.001);

  it("keeps only postcodes with a hail zone and attaches it", () => {
    expect(areas.map((a) => [a.postcode, a.zone])).toEqual([
      ["10000", 3],
      ["20000", 6],
    ]);
  });

  it("builds closed rings and runs reversed arcs backwards", () => {
    const left = areas[0].polygons[0][0];
    const right = areas[1].polygons[0][0];
    expect(left[0]).toEqual(left[left.length - 1]);
    expect(right[0]).toEqual(right[right.length - 1]);
    // The right square walks the shared edge backwards: (1,1) -> (1,0).
    expect(right.slice(-2)).toEqual([
      [1, 1],
      [1, 0],
    ]);
  });

  it("simplifies shared borders identically so neighbours leave no gap", () => {
    const left = areas[0].polygons[0][0];
    const right = areas[1].polygons[0][0];
    // The kink at (1.00001, 0.5) is gone on both sides.
    expect(left).not.toContainEqual([1.0, 0.5]);
    expect(JSON.stringify(left)).not.toContain("1.00001");
    const leftEdge = left.filter(([x]) => x === 1);
    const rightEdge = right.filter(([x]) => x === 1);
    expect(new Set(leftEdge.map(String))).toEqual(
      new Set(rightEdge.map(String)),
    );
  });

  it("keeps the unsimplified outline of an area that would collapse", () => {
    const tiny: PostcodeTopology = {
      arcs: [
        [
          [10, 50],
          [10.0001, 50],
          [10.0001, 50.0001],
          [10, 50.0001],
          [10, 50],
        ],
      ],
      objects: {
        postleitzahlen: {
          geometries: [
            { type: "Polygon", arcs: [[0]], properties: { postcode: "10000" } },
          ],
        },
      },
    };
    const [area] = topologyToOverlayAreas(tiny, zoneOf, 0.01);
    expect(area.polygons[0][0].length).toBeGreaterThanOrEqual(4);
  });

  it("skips geometries with malformed or out-of-range arcs", () => {
    const broken: PostcodeTopology = {
      arcs: TOPOLOGY.arcs,
      objects: {
        postleitzahlen: {
          geometries: [
            {
              type: "Polygon",
              arcs: [[99]],
              properties: { postcode: "10000" },
            },
            { type: "Polygon", arcs: "x", properties: { postcode: "10000" } },
            { type: "Point", arcs: [[0]], properties: { postcode: "10000" } },
          ],
        },
      },
    };
    expect(topologyToOverlayAreas(broken, zoneOf)).toEqual([]);
  });

  it("supports MultiPolygon geometries", () => {
    const multi: PostcodeTopology = {
      arcs: TOPOLOGY.arcs,
      objects: {
        postleitzahlen: {
          geometries: [
            {
              type: "MultiPolygon",
              arcs: [[[0, 1]], [[2, -2]]],
              properties: { postcode: "10000" },
            },
          ],
        },
      },
    };
    const [area] = topologyToOverlayAreas(multi, zoneOf, 0.001);
    expect(area.polygons).toHaveLength(2);
  });
});
