import { describe, expect, it } from "vitest";
import {
  assembleRelationRings,
  buildOsmEvidenceQuery,
  classifyArea,
  classifyLine,
  halfWidthForLine,
  parseOsmEvidence,
  roadHalfWidthM,
  type OverpassElement,
} from "./osm-overpass";
import {
  DEFAULT_RATE_LIMIT_PAUSE_MS,
  rateLimitPauseMs,
} from "./overpass-client";

describe("buildOsmEvidenceQuery", () => {
  const query = buildOsmEvidenceQuery(48.1882, 11.5743);

  it("ends in a bare `out geom;`", () => {
    expect(query.trimEnd().endsWith("out geom;")).toBe(true);
  });

  it("never combines a geometry mode with `center`", () => {
    // The shipped query ended in `out geom center tags;`, which returns
    // elements with no geometry array at all. Every element was then dropped
    // by the caller's length check, so the OSM provider returned nothing on
    // every lookup it ever performed. This assertion is the regression guard.
    expect(query).not.toMatch(/\bcenter\b/);
  });

  it("asks for the tags that delimit a site, not only the ones that fill it", () => {
    for (const fragment of [
      '["barrier"]',
      '["highway"]',
      '["railway"]',
      '["waterway"]',
      '["building"]',
      '["natural"]',
      '"addr:housenumber"',
    ]) {
      expect(query).toContain(fragment);
    }
  });

  it("uses nwr so relations are included, not just ways", () => {
    expect(query).toContain('nwr(around:300,48.1882,11.5743)["building"]');
  });

  it("honours a custom radius", () => {
    expect(buildOsmEvidenceQuery(1, 2, 150)).toContain("around:150,1,2");
  });
});

describe("classifyArea", () => {
  it.each([
    [{ shop: "car" }, "dealerArea"],
    [{ shop: "car_repair" }, "dealerArea"],
    [{ office: "car_dealer" }, "dealerArea"],
    [{ amenity: "parking" }, "parking"],
    [{ site: "parking" }, "parking"],
    [{ landuse: "retail" }, "landuse"],
    [{ landuse: "industrial" }, "landuse"],
    [{ building: "yes" }, "building"],
    [{ landuse: "grass" }, "vegetation"],
    [{ natural: "wood" }, "vegetation"],
    [{ leisure: "park" }, "vegetation"],
    [{ natural: "water" }, "water"],
  ])("classifies %j", (tags, expected) => {
    expect(classifyArea(tags)).toBe(expected);
  });

  it("prefers the dealership reading over the building reading", () => {
    // A showroom tagged as both should count as dealer area, which carries far
    // more weight than a generic building.
    expect(classifyArea({ shop: "car", building: "retail" })).toBe("dealerArea");
  });

  it("treats a grassed area inside a retail zone as vegetation", () => {
    expect(classifyArea({ landuse: "grass", area: "yes" })).toBe("vegetation");
  });

  it("returns null for irrelevant tags", () => {
    expect(classifyArea({ amenity: "bench" })).toBeNull();
    expect(classifyArea({})).toBeNull();
  });
});

describe("classifyLine", () => {
  it("treats fences, walls and hedges as barriers", () => {
    for (const barrier of ["fence", "wall", "hedge", "retaining_wall"]) {
      expect(classifyLine({ barrier })).toBe("barrier");
    }
  });

  it("keeps a gate closed", () => {
    // A gate is a hole in the fence. Leaving it open lets region growing leak
    // onto the street through a 4 m opening.
    expect(classifyLine({ barrier: "gate" })).toBe("barrier");
  });

  it("treats public road classes as boundaries", () => {
    for (const highway of [
      "motorway",
      "trunk",
      "primary",
      "secondary",
      "tertiary",
      "residential",
      "unclassified",
      "living_street",
    ]) {
      expect(classifyLine({ highway })).toBe("publicRoad");
    }
  });

  it("does NOT cut the lot on footways, paths or cycleways", () => {
    // The regression that matters most: buffering every highway=* as negative
    // would slice dealership lots in half wherever a footpath crosses them.
    for (const highway of [
      "footway",
      "path",
      "pedestrian",
      "cycleway",
      "steps",
      "track",
    ]) {
      expect(classifyLine({ highway })).toBeNull();
    }
  });

  it("reads a parking aisle as interior circulation, not a boundary", () => {
    expect(classifyLine({ highway: "service", service: "parking_aisle" })).toBe(
      "serviceAisle",
    );
    expect(classifyLine({ highway: "service", service: "driveway" })).toBe(
      "serviceAisle",
    );
  });

  it("leaves an unqualified service road neutral", () => {
    expect(classifyLine({ highway: "service" })).toBeNull();
  });

  it("treats an alley as a public road", () => {
    expect(classifyLine({ highway: "service", service: "alley" })).toBe(
      "publicRoad",
    );
  });

  it("treats rails and watercourses as boundaries", () => {
    expect(classifyLine({ railway: "rail" })).toBe("railway");
    expect(classifyLine({ waterway: "stream" })).toBe("waterway");
  });
});

describe("roadHalfWidthM", () => {
  it("prefers an explicit width", () => {
    expect(roadHalfWidthM({ highway: "residential", width: "8" })).toBe(4);
  });

  it("falls back to lanes at 3 m each", () => {
    expect(roadHalfWidthM({ highway: "residential", lanes: "2" })).toBe(3);
  });

  it("falls back to the road class", () => {
    expect(roadHalfWidthM({ highway: "residential" })).toBe(3);
    expect(roadHalfWidthM({ highway: "motorway" })).toBe(7.5);
  });

  it("ignores an unparseable width", () => {
    expect(roadHalfWidthM({ highway: "residential", width: "wide" })).toBe(3);
  });

  it("gives a barrier no width at all", () => {
    expect(halfWidthForLine("barrier", { barrier: "fence" })).toBe(0);
  });
});

describe("assembleRelationRings", () => {
  const p = (lon: number, lat: number): { lat: number; lon: number } => ({
    lat,
    lon,
  });

  it("chains two outer members into one closed ring", () => {
    const rings = assembleRelationRings([
      { type: "way", role: "outer", geometry: [p(0, 0), p(1, 0), p(1, 1)] },
      { type: "way", role: "outer", geometry: [p(1, 1), p(0, 1), p(0, 0)] },
    ]);
    expect(rings).toHaveLength(1);
    expect(rings[0][0]).toEqual(rings[0][rings[0].length - 1]);
    expect(rings[0].length).toBeGreaterThanOrEqual(5);
  });

  it("reverses a member that is stored tail-first", () => {
    const rings = assembleRelationRings([
      { type: "way", role: "outer", geometry: [p(0, 0), p(1, 0), p(1, 1)] },
      { type: "way", role: "outer", geometry: [p(0, 0), p(0, 1), p(1, 1)] },
    ]);
    expect(rings).toHaveLength(1);
  });

  it("drops a chain that cannot be closed", () => {
    // A half-traced boundary is worse than none.
    expect(
      assembleRelationRings([
        { type: "way", role: "outer", geometry: [p(0, 0), p(1, 0)] },
        { type: "way", role: "outer", geometry: [p(5, 5), p(6, 6)] },
      ]),
    ).toHaveLength(0);
  });

  it("ignores inner members", () => {
    const rings = assembleRelationRings([
      {
        type: "way",
        role: "outer",
        geometry: [p(0, 0), p(2, 0), p(2, 2), p(0, 2), p(0, 0)],
      },
      {
        type: "way",
        role: "inner",
        geometry: [p(1, 1), p(1.5, 1), p(1.5, 1.5), p(1, 1)],
      },
    ]);
    expect(rings).toHaveLength(1);
  });

  it("returns nothing for undefined members", () => {
    expect(assembleRelationRings(undefined)).toHaveLength(0);
  });
});

describe("parseOsmEvidence", () => {
  const square = [
    { lat: 0, lon: 0 },
    { lat: 0, lon: 1 },
    { lat: 1, lon: 1 },
    { lat: 1, lon: 0 },
    { lat: 0, lon: 0 },
  ];

  it("keeps a closed dealer way as an area", () => {
    const evidence = parseOsmEvidence({
      elements: [
        { type: "way", id: 1, tags: { shop: "car" }, geometry: square },
      ] as OverpassElement[],
    });
    expect(evidence.areas).toHaveLength(1);
    expect(evidence.areas[0].kind).toBe("dealerArea");
    expect(evidence.areas[0].osmId).toBe(1);
  });

  it("records a fence as both a closed area candidate and a barrier line", () => {
    // A fence drawn around a yard is a closed way. It must cut, and it must not
    // be mistaken for a filled area.
    const evidence = parseOsmEvidence({
      elements: [
        { type: "way", id: 2, tags: { barrier: "fence" }, geometry: square },
      ] as OverpassElement[],
    });
    expect(evidence.lines).toHaveLength(1);
    expect(evidence.lines[0].kind).toBe("barrier");
    expect(evidence.areas).toHaveLength(0);
  });

  it("does not treat an open way as an area", () => {
    const evidence = parseOsmEvidence({
      elements: [
        {
          type: "way",
          id: 3,
          tags: { building: "yes" },
          geometry: square.slice(0, 3),
        },
      ] as OverpassElement[],
    });
    expect(evidence.areas).toHaveLength(0);
  });

  it("collects address nodes", () => {
    const evidence = parseOsmEvidence({
      elements: [
        {
          type: "node",
          id: 4,
          lat: 52.5,
          lon: 13.4,
          tags: { "addr:housenumber": "12", "addr:street": "Musterweg" },
        },
      ] as OverpassElement[],
    });
    expect(evidence.addressNodes).toHaveLength(1);
    expect(evidence.addressNodes[0].point).toEqual([13.4, 52.5]);
  });

  it("resolves a building mapped as a relation", () => {
    const evidence = parseOsmEvidence({
      elements: [
        {
          type: "relation",
          id: 5,
          tags: { building: "yes" },
          members: [
            {
              type: "way",
              role: "outer",
              geometry: [
                { lat: 0, lon: 0 },
                { lat: 0, lon: 1 },
                { lat: 1, lon: 1 },
              ],
            },
            {
              type: "way",
              role: "outer",
              geometry: [
                { lat: 1, lon: 1 },
                { lat: 0, lon: 0 },
              ],
            },
          ],
        },
      ] as OverpassElement[],
    });
    expect(evidence.areas).toHaveLength(1);
    expect(evidence.areas[0].osmType).toBe("relation");
  });

  it("carries the road buffer width through to the line", () => {
    const evidence = parseOsmEvidence({
      elements: [
        {
          type: "way",
          id: 6,
          tags: { highway: "secondary", lanes: "4" },
          geometry: [
            { lat: 0, lon: 0 },
            { lat: 0, lon: 1 },
          ],
        },
      ] as OverpassElement[],
    });
    expect(evidence.lines[0].kind).toBe("publicRoad");
    expect(evidence.lines[0].halfWidthM).toBe(6);
  });

  it("survives an empty or malformed response", () => {
    expect(parseOsmEvidence({}).areas).toHaveLength(0);
    expect(parseOsmEvidence({ elements: [] }).lines).toHaveLength(0);
  });
});

describe("rateLimitPauseMs", () => {
  it("honours Retry-After given in seconds", () => {
    expect(rateLimitPauseMs("120")).toBe(120_000);
  });

  it("honours Retry-After given as an HTTP date", () => {
    const now = Date.parse("2026-09-14T10:00:00Z");
    const later = new Date(now + 90_000).toUTCString();
    expect(rateLimitPauseMs(later, now)).toBeGreaterThan(80_000);
    expect(rateLimitPauseMs(later, now)).toBeLessThanOrEqual(90_000);
  });

  it("falls back to a long pause when the server says nothing", () => {
    expect(rateLimitPauseMs(null)).toBe(DEFAULT_RATE_LIMIT_PAUSE_MS);
  });

  it("ignores an unparseable or past Retry-After", () => {
    expect(rateLimitPauseMs("soon")).toBe(DEFAULT_RATE_LIMIT_PAUSE_MS);
    expect(rateLimitPauseMs("Mon, 01 Jan 2001 00:00:00 GMT")).toBe(
      DEFAULT_RATE_LIMIT_PAUSE_MS,
    );
  });

  it("caps an absurd Retry-After rather than silencing a mirror for hours", () => {
    expect(rateLimitPauseMs("999999")).toBeLessThanOrEqual(30 * 60_000);
  });
});
