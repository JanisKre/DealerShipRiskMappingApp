import { describe, expect, it } from "vitest";
import { DEFAULT_RISK_PARAMETERS } from "@shared/parameters";
import { boundaryNeedsReview } from "@shared/boundary-review";
import { ringAreaSqm, unprojectPoint, type LonLat } from "../boundary-geometry";
import type { ParcelFeature } from "../alkis.service";
import type { EvidenceArea, OsmEvidence } from "./osm-overpass";
import {
  alkisParcelStage,
  CASCADE_CONFIDENCE,
  finalizeCascadeResult,
  osmDealerStage,
  osmSurfaceStage,
  runVectorCascade,
  type CascadeInput,
} from "./cascade";

const ANCHOR: LonLat = [13.4, 52.5];

/** Axis-aligned rectangle in metres relative to the anchor. */
function rect(
  west: number,
  south: number,
  east: number,
  north: number,
): LonLat[] {
  const ring = (
    [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
    ] as Array<[number, number]>
  ).map((c) => unprojectPoint(c, ANCHOR));
  ring.push(ring[0]);
  return ring;
}

let nextId = 1;
function area(
  kind: EvidenceArea["kind"],
  ring: LonLat[],
  tags: Record<string, string> = {},
): EvidenceArea {
  return { kind, ring, tags, osmType: "way", osmId: nextId++ };
}

function parcel(ring: LonLat[]): ParcelFeature {
  return { ring, areaSqm: ringAreaSqm(ring), state: "Berlin" };
}

function osm(...areas: EvidenceArea[]): OsmEvidence {
  return { areas, lines: [], addressNodes: [] };
}

/** Geodesic and planar areas differ by a fraction of a percent. */
function expectArea(actual: number | undefined, expected: number): void {
  expect(actual).toBeDefined();
  expect(Math.abs(actual! - expected) / expected).toBeLessThan(0.01);
}

function input(overrides: Partial<CascadeInput> = {}): CascadeInput {
  return {
    anchor: ANCHOR,
    osm: osm(),
    parcels: [],
    parcelsTruncated: false,
    parameters: DEFAULT_RISK_PARAMETERS,
    ...overrides,
  };
}

describe("stage 1: OSM dealer area", () => {
  it("accepts a dealer area that contains the point", () => {
    const outcome = osmDealerStage(
      input({
        osm: osm(area("dealerArea", rect(-40, -30, 40, 30), { shop: "car" })),
      }),
    );
    expect(outcome.result?.role).toBe("operationalLot");
    expect(outcome.result?.provider).toBe("osm-dealer-area");
    expect(outcome.result?.confidence).toBe(CASCADE_CONFIDENCE.dealerInside);
  });

  it("raises confidence when the name matches", () => {
    const outcome = osmDealerStage(
      input({
        name: "Autohaus Beispiel GmbH",
        osm: osm(
          area("dealerArea", rect(-40, -30, 40, 30), {
            shop: "car",
            name: "Beispiel Automobile",
          }),
        ),
      }),
    );
    expect(outcome.result?.confidence).toBe(
      CASCADE_CONFIDENCE.dealerMatchedInside,
    );
  });

  it("accepts a nearby dealer area only when it carries the identity", () => {
    const nearby = rect(20, -30, 90, 30); // 20 m east of the point
    expect(
      osmDealerStage(
        input({ osm: osm(area("dealerArea", nearby, { shop: "car" })) }),
      ).result,
    ).toBeNull();
    const matched = osmDealerStage(
      input({
        name: "Autohaus Beispiel",
        osm: osm(area("dealerArea", nearby, { shop: "car", name: "Beispiel" })),
      }),
    );
    expect(matched.result?.confidence).toBe(
      CASCADE_CONFIDENCE.dealerMatchedNear,
    );
  });

  it("marks a containing area named after another business", () => {
    const outcome = osmDealerStage(
      input({
        name: "Autohaus Beispiel",
        osm: osm(
          area("dealerArea", rect(-40, -30, 40, 30), {
            shop: "car",
            name: "Nachbar Motors",
          }),
        ),
      }),
    );
    expect(outcome.result?.confidence).toBe(
      CASCADE_CONFIDENCE.dealerNamedOtherwise,
    );
    expect(outcome.reason).toMatch(/Nachbar Motors/);
  });

  it("prefers the identity-matched area over a merely containing one", () => {
    const outcome = osmDealerStage(
      input({
        name: "Autohaus Beispiel",
        osm: osm(
          area("dealerArea", rect(-40, -30, 40, 30), { shop: "car" }),
          area("dealerArea", rect(-60, -50, 60, 50), {
            shop: "car",
            name: "Beispiel",
          }),
        ),
      }),
    );
    expect(outcome.result?.label).toBe("Beispiel");
  });

  it("ignores showroom buildings and implausibly small areas", () => {
    const outcome = osmDealerStage(
      input({
        osm: osm(
          area("dealerArea", rect(-20, -15, 20, 15), {
            shop: "car",
            building: "retail",
          }),
          area("dealerArea", rect(-5, -5, 5, 5), { shop: "car" }),
        ),
      }),
    );
    expect(outcome.result).toBeNull();
  });

  it("declines when OSM was unreachable", () => {
    expect(osmDealerStage(input({ osm: null })).reason).toBe("OSM unreachable");
  });
});

describe("stage 2: ALKIS parcel", () => {
  it("accepts a plausibly sized parcel containing the point", () => {
    const outcome = alkisParcelStage(
      input({ parcels: [parcel(rect(-40, -30, 40, 30))] }),
    );
    expect(outcome.result?.source).toBe("alkis");
    expect(outcome.result?.role).toBe("parcel");
    expect(outcome.result?.confidence).toBe(CASCADE_CONFIDENCE.parcel);
  });

  it("declines a parcel that is not at the point", () => {
    const outcome = alkisParcelStage(
      input({ parcels: [parcel(rect(50, -30, 130, 30))] }),
    );
    expect(outcome.result).toBeNull();
    expect(outcome.reason).toMatch(/no cadastral parcel contains/);
  });

  it("declines an estate-sized parcel but offers it for review", () => {
    const outcome = alkisParcelStage(
      input({ parcels: [parcel(rect(-150, -150, 150, 150))] }), // 90,000 m²
    );
    expect(outcome.result).toBeNull();
    expect(outcome.alternatives).toHaveLength(1);
  });

  it("joins a small parcel with an adjacent parcel carrying parking", () => {
    const showroom = parcel(rect(-15, -15, 15, 15)); // 900 m²
    const yard = parcel(rect(15, -15, 55, 15)); // shares the east edge
    const unrelated = parcel(rect(-15, 15, 15, 45)); // adjacent, no evidence
    const outcome = alkisParcelStage(
      input({
        parcels: [showroom, yard, unrelated],
        osm: osm(area("parking", rect(20, -10, 50, 10))),
      }),
    );
    expect(outcome.result?.confidence).toBe(CASCADE_CONFIDENCE.parcelJoined);
    expectArea(outcome.result?.areaSqm, 900 + 1_200);
  });

  it("does not join neighbours from a truncated parcel set", () => {
    const outcome = alkisParcelStage(
      input({
        parcels: [
          parcel(rect(-15, -15, 15, 15)),
          parcel(rect(15, -15, 55, 15)),
        ],
        parcelsTruncated: true,
        osm: osm(area("parking", rect(20, -10, 50, 10))),
      }),
    );
    expect(outcome.result?.confidence).toBe(CASCADE_CONFIDENCE.parcel);
    expectArea(outcome.result?.areaSqm, 900);
  });

  it("declines a sliver parcel", () => {
    expect(
      alkisParcelStage(input({ parcels: [parcel(rect(-8, -8, 8, 8))] })).result,
    ).toBeNull();
  });
});

describe("stage 3: OSM parking and buildings", () => {
  it("joins parking islands next to the one at the point", () => {
    const outcome = osmSurfaceStage(
      input({
        osm: osm(
          area("parking", rect(-30, -20, 30, 20)),
          area("parking", rect(35, -20, 70, 20)), // 5 m gap: joins
          area("parking", rect(120, -20, 160, 20)), // far: stays out
        ),
      }),
    );
    expect(outcome.result?.provider).toBe("osm-surface");
    expectArea(outcome.result?.areaSqm, 2_400 + 1_400);
  });

  it("does not pull in an unrelated neighbouring building", () => {
    const outcome = osmSurfaceStage(
      input({
        osm: osm(
          area("parking", rect(-30, -20, 30, 20)),
          area("building", rect(32, -20, 60, 20)),
        ),
      }),
    );
    expectArea(outcome.result?.areaSqm, 2_400);
  });

  it("declines a building footprint without any parking", () => {
    const outcome = osmSurfaceStage(
      input({ osm: osm(area("building", rect(-20, -15, 20, 15))) }),
    );
    expect(outcome.result).toBeNull();
    expect(outcome.alternatives[0]?.role).toBe("building");
  });
});

describe("cascade order", () => {
  it("stops at the first accepting stage and keeps later ones as alternatives", () => {
    const outcome = runVectorCascade(
      input({
        osm: osm(area("dealerArea", rect(-40, -30, 40, 30), { shop: "car" })),
        parcels: [parcel(rect(-50, -40, 50, 40))],
      }),
    );
    expect(outcome.stage).toBe(1);
    expect(outcome.trace).toHaveLength(1);
    expect(outcome.alternatives.map((a) => a.source)).toEqual(["alkis"]);
  });

  it("falls through to the parcel when no dealer area exists", () => {
    const outcome = runVectorCascade(
      input({ parcels: [parcel(rect(-50, -40, 50, 40))] }),
    );
    expect(outcome.stage).toBe(2);
    expect(outcome.trace[0]).toMatch(/^stage 1: no OSM dealer area/);
  });

  it("returns no result when every vector stage declines", () => {
    const outcome = runVectorCascade(input());
    expect(outcome.result).toBeNull();
    expect(outcome.trace).toHaveLength(3);
  });
});

describe("finalized results and review", () => {
  const parameters = DEFAULT_RISK_PARAMETERS;

  it("does not send a dealer area at the point to review", () => {
    const { result, stage, trace, alternatives } = runVectorCascade(
      input({
        osm: osm(area("dealerArea", rect(-40, -30, 40, 30), { shop: "car" })),
      }),
    );
    const final = finalizeCascadeResult(
      result!,
      stage!,
      ANCHOR,
      alternatives,
      trace,
      parameters,
    );
    expect(final.quality?.usedEngine).toBe("cascade");
    expect(final.quality?.cascadeStage).toBe(1);
    expect(final.quality?.pointRelation).toBe("inside");
    expect(boundaryNeedsReview(final, parameters)).toBe(false);
  });

  it("sends a parcel result to review", () => {
    const { result, stage, trace, alternatives } = runVectorCascade(
      input({ parcels: [parcel(rect(-50, -40, 50, 40))] }),
    );
    const final = finalizeCascadeResult(
      result!,
      stage!,
      ANCHOR,
      alternatives,
      trace,
      parameters,
    );
    expect(boundaryNeedsReview(final, parameters)).toBe(true);
  });

  it("reports agreement with an alternative from another dataset", () => {
    const shared = rect(-40, -30, 40, 30);
    const { result, stage, trace, alternatives } = runVectorCascade(
      input({
        osm: osm(area("dealerArea", shared, { shop: "car" })),
        parcels: [parcel(shared)],
      }),
    );
    const final = finalizeCascadeResult(
      result!,
      stage!,
      ANCHOR,
      alternatives,
      trace,
      parameters,
    );
    expect(final.quality?.sourceAgreement).toBeGreaterThan(0.8);
  });
});
