import { describe, expect, it } from "vitest";
import { stripRetiredPerils } from "./retired-perils";
import {
  SessionSchema,
  type AnalyzedDealership,
  type NatCatHazard,
} from "./types";

const EVIDENCE = {
  source: "fixture",
  retrievedAt: "2026-01-01T00:00:00.000Z",
  method: "fixture",
  confidence: 0.8,
  fallbackUsed: false,
  limitations: [],
};

function score(peril: string, value: number): NatCatHazard {
  return { peril, score: value, hazardValue: value, unit: "x" };
}

/** A location as stored by a multi-peril build (screening-0.4.0). */
const legacy = {
  id: "d1",
  name: "Berlin Motors",
  lat: 52.5,
  lon: 13.4,
  natCatImport: {
    provider: "zuers-geo",
    retrievedAt: EVIDENCE.retrievedAt,
    hazards: [score("flood", 100)],
    attributes: { floodClass: 4 },
    evidence: EVIDENCE,
  },
  natCat: {
    provider: "composite",
    retrievedAt: EVIDENCE.retrievedAt,
    hazards: [
      { ...score("hail", 70), provider: "swissre-catnet" },
      { ...score("flood", 100), provider: "zuers-geo" },
      { ...score("heavyRain", 60), provider: "zuers-geo" },
    ],
    attributes: {},
    evidence: EVIDENCE,
  },
  risk: {
    overallScore: 70,
    perils: [
      score("wind", 40),
      score("lightning", 20),
      score("snow", 5),
      score("flood", 100),
      score("hail", 70),
      score("heat", 10),
    ],
    eal: 1200,
    ealBreakdown: { hail: 1200, wind: 300, flood: 500, total: 1200 },
    modelVersion: "screening-0.4.0",
    computedAt: EVIDENCE.retrievedAt,
  },
} as unknown as AnalyzedDealership;

describe("stripRetiredPerils", () => {
  it("keeps hail and drops every other peril and the ZÜRS import", () => {
    const d = stripRetiredPerils(legacy);
    expect(d).not.toHaveProperty("natCatImport");
    expect(d.natCat?.hazards).toEqual([
      { ...score("hail", 70), provider: "swissre-catnet" },
    ]);
    expect(d.risk?.perils).toEqual([score("hail", 70)]);
    expect(d.risk?.eal).toBe(1200);
  });

  it("drops a provider assessment without a hail value", () => {
    const d = stripRetiredPerils({
      ...legacy,
      natCat: { ...legacy.natCat, provider: "zuers-geo" },
    } as unknown as AnalyzedDealership);
    expect(d).not.toHaveProperty("natCat");
  });

  it("makes a legacy session valid for saving again", () => {
    const session = {
      id: "s1",
      name: "Legacy",
      createdAt: EVIDENCE.retrievedAt,
      updatedAt: EVIDENCE.retrievedAt,
      dealerships: [stripRetiredPerils(legacy)],
    };
    const parsed = SessionSchema.parse(session);
    expect(parsed.dealerships[0].risk?.ealBreakdown).toEqual({
      hail: 1200,
      total: 1200,
    });
  });
});

describe("SessionSchema", () => {
  it("drops retired peril scores when parsing", () => {
    const parsed = SessionSchema.parse({
      id: "s1",
      name: "Legacy",
      createdAt: EVIDENCE.retrievedAt,
      updatedAt: EVIDENCE.retrievedAt,
      dealerships: [{ ...legacy, natCat: undefined, natCatImport: undefined }],
    });
    expect(parsed.dealerships[0].risk?.perils).toEqual([score("hail", 70)]);
  });
});
