import { describe, expect, it } from "vitest";
import { DEFAULT_RISK_PARAMETERS } from "@shared/parameters";
import {
  buildEvidenceGrid,
  buildResultFromFusion,
  FUSION_VERSION,
  fuseBoundary,
  fusedConfidence,
  LAYER_WEIGHTS,
  layerDiversity,
  matchesSite,
  type FusionBundle,
  type VehicleEvidence,
} from "./fusion";
import { polygonRasterIoU } from "./rasterize";
import { cellIndex, lonLatToCell } from "./grid";
import { unprojectPoint, ringAreaSqm, type LonLat } from "../boundary-geometry";
import type { OsmEvidence } from "./osm-overpass";
import type { Polygon } from "@shared/types";

const ANCHOR: LonLat = [13.4, 52.5];
const PARAMS = DEFAULT_RISK_PARAMETERS;

/** Ring from metric offsets (east, north) about the anchor. */
function ring(points: Array<[number, number]>): LonLat[] {
  const out = points.map((p) => unprojectPoint(p, ANCHOR));
  out.push(out[0]);
  return out;
}

function rect(
  centreE: number,
  centreN: number,
  halfW: number,
  halfH: number,
): LonLat[] {
  return ring([
    [centreE - halfW, centreN - halfH],
    [centreE + halfW, centreN - halfH],
    [centreE + halfW, centreN + halfH],
    [centreE - halfW, centreN + halfH],
  ]);
}

function emptyOsm(): OsmEvidence {
  return { areas: [], lines: [], addressNodes: [], namedPlaces: [] };
}

function bundle(patch: Partial<FusionBundle> = {}): FusionBundle {
  return {
    anchor: ANCHOR,
    osm: emptyOsm(),
    parcels: [],
    parcelsTruncated: false,
    availability: { osm: true, alkis: true },
    ...patch,
  };
}

describe("matchesSite", () => {
  it("matches on a distinctive name token", () => {
    expect(matchesSite({ name: "Autohaus Brinkmann" }, "Brinkmann GmbH")).toBe(
      true,
    );
  });

  it("ignores generic tokens that would match anything", () => {
    // "Autohaus" alone must not bind this site to every dealer on the street.
    expect(matchesSite({ name: "Autohaus Schmidt" }, "Autohaus Meyer")).toBe(
      false,
    );
  });

  it("matches on postcode plus house number", () => {
    expect(
      matchesSite(
        { "addr:postcode": "10115", "addr:housenumber": "12" },
        undefined,
        "Musterweg 12, 10115 Berlin",
      ),
    ).toBe(true);
  });

  it("rejects the right postcode with the wrong house number", () => {
    expect(
      matchesSite(
        { "addr:postcode": "10115", "addr:housenumber": "99" },
        undefined,
        "Musterweg 12, 10115 Berlin",
      ),
    ).toBe(false);
  });

  it("is false with nothing to match on", () => {
    expect(matchesSite({}, undefined, undefined)).toBe(false);
  });
});

describe("buildEvidenceGrid", () => {
  it("records a layer per contributing source", () => {
    const { layers } = buildEvidenceGrid(
      bundle({
        osm: {
          areas: [
            {
              kind: "dealerArea",
              ring: rect(0, 0, 40, 25),
              tags: {},
              osmType: "way",
              osmId: 1,
            },
            {
              kind: "building",
              ring: rect(0, 0, 10, 8),
              tags: {},
              osmType: "way",
              osmId: 2,
            },
          ],
          lines: [],
          addressNodes: [],
        },
      }),
      PARAMS,
    );
    const names = layers.map((l) => l.layer);
    expect(names).toContain("osm-dealerArea");
    expect(names).toContain("osm-building");
    expect(layers.every((l) => l.cells > 0)).toBe(true);
  });

  it("marks OSM unavailable rather than silently contributing nothing", () => {
    const { layers } = buildEvidenceGrid(bundle({ osm: null }), PARAMS);
    const osm = layers.find((l) => l.layer === "osm");
    expect(osm?.available).toBe(false);
    expect(osm?.limitation).toMatch(/unreachable/i);
  });

  it("scores only the parcel containing the anchor", () => {
    const { layers } = buildEvidenceGrid(
      bundle({
        parcels: [
          { ring: rect(0, 0, 30, 30), areaSqm: 3600, state: "Berlin" },
          { ring: rect(120, 0, 30, 30), areaSqm: 3600, state: "Berlin" },
        ],
      }),
      PARAMS,
    );
    const parcel = layers.find((l) => l.layer === "alkis-anchor-parcel");
    expect(parcel).toBeDefined();
    // Only one parcel's worth of cells: ~3600 m² at 0.25 m² per cell.
    expect(parcel!.cells).toBeLessThan(16_000);
  });

  it("blocks cells along a road but not along a parking aisle", () => {
    const road = [
      unprojectPoint([-100, 40], ANCHOR),
      unprojectPoint([100, 40], ANCHOR),
    ];
    const aisle = [
      unprojectPoint([-100, 0], ANCHOR),
      unprojectPoint([100, 0], ANCHOR),
    ];
    const { grid } = buildEvidenceGrid(
      bundle({
        osm: {
          areas: [],
          lines: [
            {
              kind: "publicRoad",
              line: road,
              halfWidthM: 3,
              tags: {},
              osmId: 1,
            },
            {
              kind: "serviceAisle",
              line: aisle,
              halfWidthM: 3,
              tags: {},
              osmId: 2,
            },
          ],
          addressNodes: [],
        },
      }),
      PARAMS,
    );
    const blockedCount = grid.blocked.reduce((sum, v) => sum + v, 0);
    expect(blockedCount).toBeGreaterThan(0);
    // The aisle contributes positive score, never a cut.
    const aisleCell = grid.score[400 * grid.spec.cols + 400];
    expect(aisleCell).toBeGreaterThan(0);
  });
});

describe("fuseBoundary", () => {
  it("recovers a fenced lot bounded by a road, from partial evidence", () => {
    // The intended site: 80 m x 60 m. No single source describes it:
    // - the mapped parking polygon covers only the western half
    // - the building covers a corner
    // - the cadastral parcel is larger than the site
    // - a fence closes the east side, a road bounds the north
    const site = rect(0, 0, 40, 30);
    const fence = ring([
      [40, -30],
      [40, 30],
      [40, 30],
      [40, -30],
    ]);
    const result = fuseBoundary(
      bundle({
        osm: {
          areas: [
            {
              kind: "parking",
              ring: rect(-20, 0, 20, 30),
              tags: {},
              osmType: "way",
              osmId: 1,
            },
            {
              kind: "dealerArea",
              ring: rect(10, 0, 30, 28),
              tags: { name: "Autohaus Brinkmann" },
              osmType: "way",
              osmId: 2,
            },
            {
              kind: "building",
              ring: rect(20, 15, 12, 10),
              tags: {},
              osmType: "way",
              osmId: 3,
            },
          ],
          lines: [
            {
              kind: "publicRoad",
              line: [
                unprojectPoint([-120, 45], ANCHOR),
                unprojectPoint([120, 45], ANCHOR),
              ],
              halfWidthM: 5,
              tags: { highway: "secondary" },
              osmId: 4,
            },
            {
              kind: "barrier",
              line: fence,
              halfWidthM: 0,
              tags: { barrier: "fence" },
              osmId: 5,
            },
          ],
          addressNodes: [],
        },
        parcels: [{ ring: rect(0, 0, 55, 45), areaSqm: 9900, state: "Berlin" }],
        name: "Autohaus Brinkmann",
      }),
      PARAMS,
    );

    expect(result).not.toBeNull();
    const iou = polygonRasterIoU(result!.polygon, {
      type: "Polygon",
      coordinates: [site],
    } as Polygon);
    expect(iou).toBeGreaterThan(0.6);
    expect(result!.confirmed).toBe(true);
    expect(result!.stoppedBy).toBe("exhausted");
  });

  it("does not grow across a public road", () => {
    const result = fuseBoundary(
      bundle({
        osm: {
          areas: [
            {
              kind: "dealerArea",
              ring: rect(0, -30, 40, 25),
              tags: {},
              osmType: "way",
              osmId: 1,
            },
            // A second, unrelated lot on the far side of the road.
            {
              kind: "dealerArea",
              ring: rect(0, 40, 40, 25),
              tags: {},
              osmType: "way",
              osmId: 2,
            },
          ],
          lines: [
            {
              kind: "publicRoad",
              line: [
                unprojectPoint([-150, 6], ANCHOR),
                unprojectPoint([150, 6], ANCHOR),
              ],
              halfWidthM: 5,
              tags: { highway: "primary" },
              osmId: 3,
            },
          ],
          addressNodes: [],
        },
        anchor: unprojectPoint([0, -30], ANCHOR),
      }),
      PARAMS,
    );
    expect(result).not.toBeNull();
    // Only the southern lot: ~80 x 50 = 4000 m², not 8000+.
    expect(result!.areaSqm).toBeLessThan(6_000);
  });

  it("abstains when only a cadastral parcel is available", () => {
    // A parcel is a legal unit, not evidence of operational use: it is
    // routinely larger than the lot (a dealership on part of a plot) or
    // smaller (a lot spanning several plots). Fusing from it alone would just
    // redraw the parcel and label it an operational lot with fused-grade
    // confidence. Returning null hands the decision back to the candidate
    // chain, which proposes the parcel honestly and flags it for review.
    const result = fuseBoundary(
      bundle({
        osm: null,
        availability: { osm: false, alkis: true },
        parcels: [{ ring: rect(0, 0, 35, 30), areaSqm: 4200, state: "Berlin" }],
      }),
      PARAMS,
    );
    expect(result).toBeNull();
  });

  it("lets the parcel corroborate evidence without extending past it", () => {
    // Reinforcement is a score-level mechanism and is asserted on the grid,
    // where it happens. (Snapping is a separate, shape-level step that does
    // deliberately adopt the parcel's edges — see "cadastral snapping".)
    const osm: OsmEvidence = {
      areas: [
        {
          kind: "parking",
          ring: rect(0, 0, 30, 22),
          tags: {},
          osmType: "way",
          osmId: 1,
        },
      ],
      lines: [],
      addressNodes: [],
    };
    const parcels = [
      { ring: rect(0, 0, 60, 50), areaSqm: 12_000, state: "Berlin" },
    ];

    const withoutParcel = buildEvidenceGrid(bundle({ osm }), PARAMS);
    const withParcel = buildEvidenceGrid(bundle({ osm, parcels }), PARAMS);

    const parcelLayer = withParcel.layers.find(
      (l) => l.layer === "alkis-anchor-parcel",
    );
    expect(parcelLayer?.cells).toBeGreaterThan(0);

    const centre = 400 * withParcel.grid.spec.cols + 400;
    // Inside the evidenced area the parcel adds weight ...
    expect(withParcel.grid.score[centre]).toBeGreaterThan(
      withoutParcel.grid.score[centre],
    );

    // ... but a cell inside the parcel and outside the evidence stays at zero,
    // which is what stops a large plot from flooding the region on its own.
    const outside = 400 * withParcel.grid.spec.cols + 490; // ~45 m east
    expect(withoutParcel.grid.score[outside]).toBe(0);
    expect(withParcel.grid.score[outside]).toBe(0);
  });

  it("records OSM as unavailable rather than as a negative signal", () => {
    const result = fuseBoundary(
      bundle({
        osm: null,
        availability: { osm: false, alkis: true },
        matchedRing: rect(0, 0, 30, 25),
      }),
      PARAMS,
    );
    expect(result).not.toBeNull();
    expect(result!.layers.find((l) => l.layer === "osm")?.available).toBe(
      false,
    );
  });

  it("returns null when there is nothing to grow from", () => {
    expect(fuseBoundary(bundle(), PARAMS)).toBeNull();
  });

  it("reports the area cap rather than silently truncating", () => {
    const result = fuseBoundary(
      bundle({
        osm: {
          areas: [
            {
              kind: "dealerArea",
              ring: rect(0, 0, 150, 150),
              tags: {},
              osmType: "way",
              osmId: 1,
            },
          ],
          lines: [],
          addressNodes: [],
        },
      }),
      { ...PARAMS, boundaryMaxAreaSqm: 2_000 },
    );
    expect(result!.stoppedBy).toBe("areaCap");
    expect(result!.reasons.join(" ")).toMatch(/areaCap/);
  });

  it("is deterministic", () => {
    const input = bundle({
      osm: {
        areas: [
          {
            kind: "dealerArea",
            ring: rect(3, -4, 37, 26),
            tags: {},
            osmType: "way",
            osmId: 1,
          },
        ],
        lines: [],
        addressNodes: [],
      },
    });
    const a = fuseBoundary(input, PARAMS)!;
    const b = fuseBoundary(input, PARAMS)!;
    expect(a.polygon).toEqual(b.polygon);
    expect(a.areaSqm).toBe(b.areaSqm);
  });

  it("takes area from the mask, so an unfilled void is not counted as lot", () => {
    // A large enclosed void stays open in the mask but cannot be expressed in
    // the outer ring, so ring area would overstate the site.
    const result = fuseBoundary(
      bundle({
        osm: {
          areas: [
            {
              kind: "dealerArea",
              ring: rect(0, 0, 90, 90),
              tags: {},
              osmType: "way",
              osmId: 1,
            },
            {
              kind: "water",
              ring: rect(0, 0, 40, 40),
              tags: {},
              osmType: "way",
              osmId: 2,
            },
          ],
          lines: [],
          addressNodes: [],
        },
      }),
      PARAMS,
    );
    expect(result).not.toBeNull();
    const ringArea = ringAreaSqm(result!.polygon.coordinates[0] as LonLat[]);
    expect(result!.areaSqm).toBeLessThan(ringArea * 0.9);
  });
});

describe("fusedConfidence", () => {
  const base = {
    barrierSupport: 0.5,
    layerDiversity: 0.5,
    cadastreSnapped: false,
    areaPlausibility: 0.8,
    confirmed: true,
    stoppedByCap: false,
  };

  it("stays within [0,1]", () => {
    expect(
      fusedConfidence({
        ...base,
        barrierSupport: 1,
        layerDiversity: 1,
        cadastreSnapped: true,
        areaPlausibility: 1,
      }),
    ).toBeLessThanOrEqual(1);
    expect(
      fusedConfidence({
        ...base,
        barrierSupport: 0,
        layerDiversity: 0,
        areaPlausibility: 0,
        confirmed: false,
      }),
    ).toBeGreaterThanOrEqual(0);
  });

  it("rises with barrier support", () => {
    expect(fusedConfidence({ ...base, barrierSupport: 0.9 })).toBeGreaterThan(
      fusedConfidence({ ...base, barrierSupport: 0.1 }),
    );
  });

  it("rises with layer diversity", () => {
    expect(fusedConfidence({ ...base, layerDiversity: 1 })).toBeGreaterThan(
      fusedConfidence({ ...base, layerDiversity: 0 }),
    );
  });

  it("halves when nothing strong was found", () => {
    expect(fusedConfidence({ ...base, confirmed: false })).toBeCloseTo(
      fusedConfidence(base) / 2,
      6,
    );
  });

  it("is penalised when a cap truncated the site", () => {
    expect(fusedConfidence({ ...base, stoppedByCap: true })).toBeLessThan(
      fusedConfidence(base),
    );
  });
});

describe("layerDiversity", () => {
  it("counts only positive layers that actually contributed", () => {
    expect(
      layerDiversity([
        { layer: "a", source: "s", weight: 1, cells: 10, available: true },
        { layer: "b", source: "s", weight: -1, cells: 10, available: true },
        { layer: "c", source: "s", weight: 1, cells: 0, available: true },
        { layer: "d", source: "s", weight: 1, cells: 5, available: false },
      ]),
    ).toBeCloseTo(0.25, 6);
  });

  it("saturates at four corroborating layers", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      layer: `l${i}`,
      source: "s",
      weight: 1,
      cells: 1,
      available: true,
    }));
    expect(layerDiversity(many)).toBe(1);
  });
});

describe("buildResultFromFusion", () => {
  it("produces a fused operational lot with full provenance", () => {
    const outcome = fuseBoundary(
      bundle({
        osm: {
          areas: [
            {
              kind: "dealerArea",
              ring: rect(0, 0, 40, 25),
              tags: {},
              osmType: "way",
              osmId: 1,
            },
          ],
          lines: [],
          addressNodes: [],
        },
      }),
      PARAMS,
    )!;
    const result = buildResultFromFusion(outcome, PARAMS, {
      barrierSupport: 0.6,
      cadastreSnapped: true,
      parcelCount: 2,
      areaPlausibility: 0.9,
      sourceAgreement: 0.7,
    });

    expect(result.source).toBe("fused");
    expect(result.role).toBe("operationalLot");
    expect(result.quality?.fusionVersion).toBe(FUSION_VERSION);
    expect(result.quality?.cadastreSnapped).toBe(true);
    expect(result.quality?.parcelCount).toBe(2);
    expect(result.quality?.layers?.length).toBeGreaterThan(0);
    expect(result.evidence?.fallbackUsed).toBe(false);
    expect(result.evidence?.limitations[0]).toMatch(/not a survey/i);
  });
});

describe("separately-confirmed components (P3)", () => {
  const road = [
    unprojectPoint([-150, 6], ANCHOR),
    unprojectPoint([150, 6], ANCHOR),
  ];

  it("adds a same-named lot across the road as a MultiPolygon part", () => {
    const result = fuseBoundary(
      bundle({
        osm: {
          areas: [
            {
              kind: "dealerArea",
              ring: rect(0, -30, 40, 25),
              tags: { name: "Autohaus Brinkmann" },
              osmType: "way",
              osmId: 1,
            },
            // A same-named storage yard the site's own name confirms as theirs.
            {
              kind: "dealerArea",
              ring: rect(0, 40, 30, 20),
              tags: { name: "Autohaus Brinkmann" },
              osmType: "way",
              osmId: 2,
            },
          ],
          lines: [
            {
              kind: "publicRoad",
              line: road,
              halfWidthM: 5,
              tags: { highway: "primary" },
              osmId: 3,
            },
          ],
          addressNodes: [],
        },
        anchor: unprojectPoint([0, -30], ANCHOR),
        name: "Autohaus Brinkmann",
      }),
      PARAMS,
    );
    expect(result).not.toBeNull();
    expect(result!.polygon.type).toBe("MultiPolygon");
    expect(result!.additionalComponents).toBe(1);
    expect(result!.reasons.join(" ")).toMatch(/separately-confirmed component/);
    // Both lots should be counted now, not just the southern one.
    expect(result!.areaSqm).toBeGreaterThan(6_000);
  });

  it("keeps a single Polygon when the second lot has no name/address match", () => {
    const result = fuseBoundary(
      bundle({
        osm: {
          areas: [
            {
              kind: "dealerArea",
              ring: rect(0, -30, 40, 25),
              tags: {},
              osmType: "way",
              osmId: 1,
            },
            {
              kind: "dealerArea",
              ring: rect(0, 40, 40, 25),
              tags: {},
              osmType: "way",
              osmId: 2,
            },
          ],
          lines: [
            {
              kind: "publicRoad",
              line: road,
              halfWidthM: 5,
              tags: { highway: "primary" },
              osmId: 3,
            },
          ],
          addressNodes: [],
        },
        anchor: unprojectPoint([0, -30], ANCHOR),
      }),
      PARAMS,
    );
    expect(result).not.toBeNull();
    expect(result!.polygon.type).toBe("Polygon");
    expect(result!.additionalComponents).toBe(0);
  });
});

describe("cadastral snapping", () => {
  const dealerOsm = (ring: LonLat[]): OsmEvidence => ({
    areas: [{ kind: "dealerArea", ring, tags: {}, osmType: "way", osmId: 1 }],
    lines: [],
    addressNodes: [],
  });

  it("replaces the raster outline with the parcel union when they agree", () => {
    // Evidence covers a site that two abutting parcels describe exactly.
    const site = rect(0, 0, 40, 25);
    const result = fuseBoundary(
      bundle({
        osm: dealerOsm(site),
        parcels: [
          { ring: rect(-20, 0, 20, 25), areaSqm: 2_000, state: "Berlin" },
          { ring: rect(20, 0, 20, 25), areaSqm: 2_000, state: "Berlin" },
        ],
      }),
      PARAMS,
    );
    expect(result).not.toBeNull();
    expect(result!.cadastre).toBeDefined();
    expect(result!.cadastre!.parcelCount).toBe(2);
  });

  it("keeps the fused outline when the cadastre describes a different place", () => {
    const result = fuseBoundary(
      bundle({
        osm: dealerOsm(rect(0, 0, 40, 25)),
        // A parcel layout that barely overlaps the evidenced site.
        parcels: [
          { ring: rect(150, 0, 40, 25), areaSqm: 2_000, state: "Berlin" },
        ],
      }),
      PARAMS,
    );
    expect(result).not.toBeNull();
    expect(result!.cadastre).toBeUndefined();
  });

  it("skips snapping when the cadastral response was truncated", () => {
    // Which parcels are missing is arbitrary, so the union would be arbitrary.
    const site = rect(0, 0, 40, 25);
    const result = fuseBoundary(
      bundle({
        osm: dealerOsm(site),
        parcels: [
          { ring: rect(0, 0, 40, 25), areaSqm: 4_000, state: "Berlin" },
        ],
        parcelsTruncated: true,
      }),
      PARAMS,
    );
    expect(result!.cadastre).toBeUndefined();
    expect(result!.reasons.join(" ")).toMatch(/truncated/);
  });
});

describe("foreign businesses as counter-evidence (P3)", () => {
  // Modelled on a real failure: a dealership in a business park whose result
  // swallowed a neighbour's named industrial plot and a car wash next door.
  const dealer = rect(0, 0, 40, 25);
  const siteName = "Autohaus Dresden GmbH";

  it("does not grow into a neighbour's named industrial landuse", () => {
    const osm: OsmEvidence = {
      areas: [
        { kind: "parking", ring: dealer, tags: {}, osmType: "way", osmId: 1 },
        // Unnamed landuse under the dealer plus a named plot touching it.
        {
          kind: "landuse",
          ring: rect(0, 0, 40, 25),
          tags: { landuse: "commercial" },
          osmType: "way",
          osmId: 2,
        },
        {
          kind: "landuse",
          ring: rect(80, 0, 40, 25),
          tags: { landuse: "industrial", name: "Fabmatics GmbH" },
          osmType: "way",
          osmId: 3,
        },
      ],
      lines: [],
      addressNodes: [],
      namedPlaces: [],
    };
    const result = fuseBoundary(bundle({ osm, name: siteName }), PARAMS);
    expect(result).not.toBeNull();
    expect(result!.areaSqm).toBeLessThan(4_600);
    expect(result!.reasons.join(" ")).toMatch(
      /another operator's site: Fabmatics GmbH/,
    );
    expect(result!.layers.some((l) => l.layer === "osm-foreignBusiness")).toBe(
      true,
    );
  });

  it("turns a neighbouring building with another business inside it negative", () => {
    const osm: OsmEvidence = {
      areas: [
        { kind: "parking", ring: dealer, tags: {}, osmType: "way", osmId: 1 },
        {
          kind: "landuse",
          ring: rect(30, 0, 70, 25),
          tags: { landuse: "commercial" },
          osmType: "way",
          osmId: 2,
        },
        {
          kind: "building",
          ring: rect(65, 0, 20, 20),
          tags: { building: "yes" },
          osmType: "way",
          osmId: 3,
        },
      ],
      lines: [],
      addressNodes: [],
      namedPlaces: [
        {
          point: unprojectPoint([65, 0], ANCHOR),
          tags: { amenity: "car_wash", name: "Astrein Autoreinigung" },
        },
      ],
    };
    const { grid } = buildEvidenceGrid(bundle({ osm, name: siteName }), PARAMS);
    const at = (e: number, n: number): number => {
      const cell = lonLatToCell(grid.spec, unprojectPoint([e, n], ANCHOR))!;
      return grid.score[cellIndex(grid.spec, cell.col, cell.row)];
    };
    expect(at(65, 10)).toBeLessThan(0);
    expect(at(0, 0)).toBeGreaterThan(0.5);
  });

  it("treats a separate business-park plot housing other firms as theirs", () => {
    const osm: OsmEvidence = {
      areas: [
        { kind: "parking", ring: dealer, tags: {}, osmType: "way", osmId: 1 },
        {
          kind: "landuse",
          ring: rect(0, 0, 40, 25),
          tags: { landuse: "commercial" },
          osmType: "way",
          osmId: 2,
        },
        // An unnamed office plot next door; only its tenants' points say whose it is.
        {
          kind: "landuse",
          ring: rect(90, 0, 50, 30),
          tags: { landuse: "commercial" },
          osmType: "way",
          osmId: 3,
        },
        {
          kind: "parking",
          ring: rect(90, 0, 45, 25),
          tags: {},
          osmType: "way",
          osmId: 4,
        },
      ],
      lines: [],
      addressNodes: [],
      namedPlaces: [
        {
          point: unprojectPoint([95, 5], ANCHOR),
          tags: { office: "company", name: "DREEBIT GmbH" },
        },
      ],
    };
    const result = fuseBoundary(bundle({ osm, name: siteName }), PARAMS);
    expect(result).not.toBeNull();
    expect(result!.areaSqm).toBeLessThan(4_600);
  });

  it("never marks the dealership's own point or name as foreign", () => {
    const osm: OsmEvidence = {
      areas: [
        { kind: "parking", ring: dealer, tags: {}, osmType: "way", osmId: 1 },
        // A tenant node a few metres from the anchor: protected, not carved out.
        {
          kind: "building",
          ring: rect(0, 0, 10, 10),
          tags: {
            building: "retail",
            name: "Fremdfirma Meier",
            shop: "car_parts",
          },
          osmType: "way",
          osmId: 2,
        },
      ],
      lines: [],
      addressNodes: [],
      namedPlaces: [
        {
          point: unprojectPoint([30, 0], ANCHOR),
          tags: { shop: "car", name: "Autohaus Dresden GmbH", brand: "Opel" },
        },
      ],
    };
    const result = fuseBoundary(bundle({ osm, name: siteName }), PARAMS);
    expect(result).not.toBeNull();
    expect(result!.reasons.join(" ")).not.toMatch(/another operator/);
    expect(result!.areaSqm).toBeGreaterThan(3_500);
  });
});

describe("separate components need more than an adjacent parcel (P3)", () => {
  const road = [
    unprojectPoint([-150, 6], ANCHOR),
    unprojectPoint([150, 6], ANCHOR),
  ];
  const anchor = unprojectPoint([0, -30], ANCHOR);
  // Two parcels sharing the road's centre line as their edge: adjacent.
  const parcels = [
    { ring: rect(0, -25, 45, 31), areaSqm: 5_580, state: "Sachsen" },
    { ring: rect(0, 33, 45, 27), areaSqm: 4_860, state: "Sachsen" },
  ];
  const withSecondLot = (
    tags: Record<string, string>,
    kind: "parking" | "dealerArea",
  ): ReturnType<typeof fuseBoundary> =>
    fuseBoundary(
      bundle({
        anchor,
        name: "Autohaus Brinkmann",
        parcels,
        osm: {
          areas: [
            {
              kind: "dealerArea",
              ring: rect(0, -30, 40, 25),
              tags: { name: "Autohaus Brinkmann" },
              osmType: "way",
              osmId: 1,
            },
            { kind, ring: rect(0, 35, 30, 20), tags, osmType: "way", osmId: 2 },
          ],
          lines: [
            {
              kind: "publicRoad",
              line: road,
              halfWidthM: 5,
              tags: { highway: "primary" },
              osmId: 3,
            },
          ],
          addressNodes: [],
          namedPlaces: [],
        },
      }),
      PARAMS,
    );

  it("rejects an untagged car park whose only link is the adjacent parcel", () => {
    const result = withSecondLot({ amenity: "parking" }, "parking");
    expect(result).not.toBeNull();
    // The unnamed car park sits outside the site parcels, so the site gate
    // damps it below the confirmation threshold before membership is asked.
    expect(result!.additionalComponents).toBe(0);
  });

  it("still accepts vehicle-trade use on the adjacent parcel", () => {
    const result = withSecondLot({ shop: "car" }, "dealerArea");
    expect(result).not.toBeNull();
    expect(result!.additionalComponents).toBe(1);
  });

  it("rejects a component that belongs to another named business", () => {
    const result = withSecondLot(
      { shop: "car", name: "Autohaus Konkurrenz" },
      "dealerArea",
    );
    expect(result).not.toBeNull();
    expect(result!.additionalComponents).toBe(0);
  });
});

describe("business park: the site does not swallow its neighbours", () => {
  // One industrial landuse over three parcels: the dealership in the middle,
  // an unnamed hall with a yard to the east, an unnamed car park to the south,
  // tied together by shared driveways — the layout that v2 flooded.
  const dealerParcel = rect(0, 0, 40, 40);
  const eastParcel = rect(80, 0, 40, 40);
  const southParcel = rect(0, -80, 40, 40);
  const parcels = [dealerParcel, eastParcel, southParcel].map((r) => ({
    ring: r,
    areaSqm: ringAreaSqm(r),
    state: "Baden-Württemberg",
  }));
  const osm: OsmEvidence = {
    areas: [
      {
        kind: "landuse",
        ring: rect(40, -40, 90, 90),
        tags: { landuse: "industrial" },
        osmType: "way",
        osmId: 1,
      },
      {
        kind: "dealerArea",
        ring: rect(0, 0, 36, 36),
        tags: { shop: "car", name: "Autohaus Brinkmann" },
        osmType: "way",
        osmId: 2,
      },
      {
        kind: "building",
        ring: rect(80, 10, 30, 20),
        tags: { building: "industrial" },
        osmType: "way",
        osmId: 3,
      },
      {
        kind: "parking",
        ring: rect(80, -28, 30, 10),
        tags: { amenity: "parking" },
        osmType: "way",
        osmId: 4,
      },
      {
        kind: "parking",
        ring: rect(0, -80, 35, 30),
        tags: { amenity: "parking" },
        osmType: "way",
        osmId: 5,
      },
    ],
    lines: [
      {
        kind: "serviceAisle",
        line: [
          unprojectPoint([20, 0], ANCHOR),
          unprojectPoint([110, 0], ANCHOR),
        ],
        halfWidthM: 3,
        tags: { highway: "service" },
        osmId: 6,
      },
      {
        kind: "serviceAisle",
        line: [
          unprojectPoint([0, -20], ANCHOR),
          unprojectPoint([0, -110], ANCHOR),
        ],
        halfWidthM: 3,
        tags: { highway: "service" },
        osmId: 7,
      },
    ],
    addressNodes: [],
    namedPlaces: [],
  };

  it("keeps the result on the dealership parcel", () => {
    const result = fuseBoundary(
      bundle({ osm, parcels, name: "Autohaus Brinkmann" }),
      PARAMS,
    );
    expect(result).not.toBeNull();
    const dealerArea = ringAreaSqm(dealerParcel);
    expect(result!.areaSqm).toBeLessThanOrEqual(dealerArea * 1.25);
    expect(
      polygonRasterIoU(result!.polygon, {
        type: "Polygon",
        coordinates: [dealerParcel],
      }),
    ).toBeGreaterThanOrEqual(0.8);
    for (const neighbour of [
      [80, 10],
      [80, -28],
      [0, -80],
    ] as Array<[number, number]>) {
      const cell = lonLatToCell(
        result!.grid.spec,
        unprojectPoint(neighbour, ANCHOR),
      )!;
      expect(
        result!.mask[cellIndex(result!.grid.spec, cell.col, cell.row)],
      ).toBe(0);
    }
    expect(result!.layers.some((l) => l.layer === "alkis-site-gate")).toBe(
      true,
    );
  });

  it("reports the real point relation when the anchor is off the site", () => {
    const outcome = fuseBoundary(
      bundle({ osm, parcels, name: "Autohaus Brinkmann" }),
      PARAMS,
    )!;
    const result = buildResultFromFusion(
      { ...outcome, anchor: unprojectPoint([0, 300], ANCHOR) },
      PARAMS,
      {
        barrierSupport: 0.5,
        cadastreSnapped: false,
        parcelCount: 1,
        areaPlausibility: 0.9,
        sourceAgreement: 0.5,
      },
    );
    expect(result.quality?.pointRelation).toBe("outside");
    expect(result.quality?.pointDistanceM).toBeGreaterThan(200);
  });
});

describe("vehicle evidence (fusion v4)", () => {
  // A small mapped forecourt at the anchor and an unmapped yard of parked
  // cars directly east of it — the truncated-lot case vehicles should fix.
  const forecourt = rect(0, 0, 15, 15);
  const osm = (): OsmEvidence => ({
    ...emptyOsm(),
    areas: [
      { kind: "parking", ring: forecourt, tags: {}, osmType: "way", osmId: 1 },
    ],
  });

  /** Cars on a 3 m × 5 m stall grid, east offsets [fromE, toE], north [fromN, toN]. */
  function carGrid(
    fromE: number,
    toE: number,
    fromN: number,
    toN: number,
    score = 0.9,
  ): VehicleEvidence[] {
    const out: VehicleEvidence[] = [];
    for (let e = fromE; e <= toE; e += 3) {
      for (let n = fromN; n <= toN; n += 5) {
        out.push({ point: unprojectPoint([e, n], ANCHOR), score });
      }
    }
    return out;
  }

  it("grows a truncated lot over an adjacent cluster of parked cars", () => {
    const without = fuseBoundary(bundle({ osm: osm() }), PARAMS)!;
    const withCars = fuseBoundary(
      bundle({ osm: osm(), vehicles: carGrid(16, 49, -10, 10) }),
      PARAMS,
    )!;
    expect(without).not.toBeNull();
    expect(withCars).not.toBeNull();
    // The yard adds roughly 34 m × 20 m on top of the 30 m × 30 m forecourt.
    expect(withCars.areaSqm).toBeGreaterThan(without.areaSqm + 500);
    const layer = withCars.layers.find((l) => l.layer === "yolo-vehicles");
    expect(layer?.cells).toBeGreaterThan(0);
    expect(layer?.weight).toBeCloseTo(LAYER_WEIGHTS.vehicle);
  });

  it("is identical to the vehicle-free result when no detections are passed", () => {
    const a = fuseBoundary(bundle({ osm: osm() }), PARAMS)!;
    const b = fuseBoundary(bundle({ osm: osm(), vehicles: [] }), PARAMS)!;
    expect(b.areaSqm).toBe(a.areaSqm);
    expect(a.layers.some((l) => l.layer === "yolo-vehicles")).toBe(false);
  });

  it("never confirms a site from vehicles alone", () => {
    const cars = bundle({ vehicles: carGrid(-30, 30, -20, 20) });
    const { grid } = buildEvidenceGrid(cars, PARAMS);
    const max = grid.score.reduce((m, v) => Math.max(m, v), 0);
    expect(max).toBeLessThan(PARAMS.boundaryGrowHighThreshold);
    // At most the existing anchor-cell fallback: grown, but unconfirmed, so
    // its confidence is halved and the result goes to review.
    const result = fuseBoundary(cars, PARAMS);
    expect(result?.confirmed ?? false).toBe(false);
  });

  it("ignores cars on another business's premises", () => {
    const supermarket = rect(45, 0, 25, 20);
    const foreignOsm: OsmEvidence = {
      ...osm(),
      areas: [
        ...osm().areas,
        {
          kind: "landuse",
          ring: supermarket,
          tags: { landuse: "retail", name: "Kaufland" },
          osmType: "way",
          osmId: 2,
        },
      ],
    };
    const site = bundle({
      osm: foreignOsm,
      name: "Autohaus Brinkmann",
      vehicles: carGrid(25, 64, -15, 15),
    });
    const { grid, layers } = buildEvidenceGrid(site, PARAMS);
    // Every car sits inside the supermarket polygon, so none contributes.
    expect(layers.find((l) => l.layer === "yolo-vehicles")?.cells).toBe(0);
    const cell = lonLatToCell(grid.spec, unprojectPoint([45, 0], ANCHOR))!;
    expect(grid.score[cellIndex(grid.spec, cell.col, cell.row)]).toBeLessThan(0);

    const result = fuseBoundary(site, PARAMS)!;
    const baseline = fuseBoundary(
      bundle({ osm: foreignOsm, name: "Autohaus Brinkmann" }),
      PARAMS,
    )!;
    expect(result.areaSqm).toBe(baseline.areaSqm);
  });

  it("is switched off by a zero vehicle evidence weight", () => {
    const params = { ...PARAMS, boundaryVehicleEvidenceWeight: 0 };
    const a = fuseBoundary(bundle({ osm: osm() }), params)!;
    const b = fuseBoundary(
      bundle({ osm: osm(), vehicles: carGrid(16, 49, -10, 10) }),
      params,
    )!;
    expect(b.areaSqm).toBe(a.areaSqm);
  });
});
