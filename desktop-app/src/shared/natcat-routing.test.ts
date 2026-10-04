import { describe, expect, it } from "vitest";
import {
  DEFAULT_NAT_CAT_ROUTING,
  composeNatCat,
  effectiveNatCatRouting,
  importedNatCat,
  isDefaultRouting,
  sourcesToQuery,
  type NatCatRouting,
} from "./natcat-routing";
import type {
  NatCatAssessment,
  NatCatHazard,
  NatCatProvider,
  NatCatSettings,
} from "./types";

const NOW = new Date("2026-10-04T12:00:00.000Z");

function assessment(
  provider: NatCatProvider,
  hazards: Array<[string, number]>,
  attributes: NatCatAssessment["attributes"] = {},
): NatCatAssessment {
  return {
    provider,
    retrievedAt: NOW.toISOString(),
    hazards: hazards.map(([peril, score]) => ({ peril, score, unit: "score" })),
    attributes,
    evidence: {
      source: provider,
      retrievedAt: NOW.toISOString(),
      method: "fixture",
      confidence: provider === "zuers-geo" ? 0.9 : 0.8,
      fallbackUsed: false,
      limitations: [`${provider} limitation`],
    },
  };
}

const catnet = assessment("swissre-catnet", [
  ["hail", 70],
  ["wind", 40],
  ["flood", 30],
]);
const jba = assessment("jba-flood", [
  ["flood", 85],
  ["heavyRain", 60],
]);
const zuers = assessment(
  "zuers-geo",
  [
    ["flood", 50],
    ["heavyRain", 33],
  ],
  { floodClass: 2 },
);

const connectors: NatCatRouting["connectors"] = {
  "swissre-catnet": { endpoint: "https://catnet.example/lookup" },
  "jba-flood": { endpoint: "https://jba.example/lookup" },
};

function routing(partial: Partial<NatCatRouting>): NatCatRouting {
  return { primary: "screening", perilSources: {}, connectors, ...partial };
}

const peril = (
  a: NatCatAssessment | undefined,
  name: string,
): NatCatHazard | undefined => a?.hazards.find((h) => h.peril === name);

describe("NatCat routing settings", () => {
  it("defaults to screening for every peril", () => {
    const r = effectiveNatCatRouting(undefined);
    expect(r.primary).toBe("screening");
    expect(isDefaultRouting(r)).toBe(true);
    expect(sourcesToQuery(r)).toEqual([]);
  });

  it("migrates the legacy CatNet switch", () => {
    const r = effectiveNatCatRouting({
      provider: "swissre-catnet",
      catnetEndpoint: "https://catnet.example/lookup",
    });
    expect(r.primary).toBe("swissre-catnet");
    expect(r.connectors["swissre-catnet"]?.endpoint).toBe(
      "https://catnet.example/lookup",
    );
    expect(sourcesToQuery(r)).toEqual(["swissre-catnet"]);
  });

  it("resets to screening while keeping the connectors", () => {
    const configured: NatCatSettings = {
      provider: "swissre-catnet",
      primary: "swissre-catnet",
      perilSources: { flood: "jba-flood" },
      connectors,
    };
    const r = effectiveNatCatRouting({
      ...configured,
      ...DEFAULT_NAT_CAT_ROUTING,
    });
    expect(isDefaultRouting(r)).toBe(true);
    expect(r.connectors).toEqual(connectors);
  });

  it("queries only connected sources the routing needs", () => {
    const r = routing({
      primary: "swissre-catnet",
      perilSources: { flood: "jba-flood", hail: "munichre-lri" },
    });
    expect(sourcesToQuery(r)).toEqual(["swissre-catnet", "jba-flood"]);
  });
});

describe("composeNatCat", () => {
  it("leaves everything to screening by default", () => {
    expect(
      composeNatCat({ routing: routing({}), results: {}, now: NOW }),
    ).toBeUndefined();
  });

  it("takes all perils from the primary source", () => {
    const result = composeNatCat({
      routing: routing({ primary: "swissre-catnet" }),
      results: { "swissre-catnet": catnet },
      now: NOW,
    });
    expect(result?.provider).toBe("swissre-catnet");
    expect(result?.hazards.map((h) => [h.peril, h.score, h.provider])).toEqual([
      ["wind", 40, "swissre-catnet"],
      ["flood", 30, "swissre-catnet"],
      ["hail", 70, "swissre-catnet"],
    ]);
    expect(result?.evidence.fallbackUsed).toBe(false);
  });

  it("combines a primary source with a per-peril specialist", () => {
    const result = composeNatCat({
      routing: routing({
        primary: "swissre-catnet",
        perilSources: { flood: "jba-flood" },
      }),
      results: { "swissre-catnet": catnet, "jba-flood": jba },
      now: NOW,
    });
    expect(result?.provider).toBe("composite");
    expect(peril(result, "flood")).toMatchObject({
      score: 85,
      provider: "jba-flood",
    });
    expect(peril(result, "hail")).toMatchObject({
      score: 70,
      provider: "swissre-catnet",
    });
    // Specialist extras travel with the peril it was chosen for.
    expect(peril(result, "heavyRain")).toMatchObject({
      score: 60,
      provider: "jba-flood",
    });
    expect(result?.evidence.confidence).toBe(0.8);
    expect(result?.evidence.limitations).toEqual([
      "swissre-catnet limitation",
      "jba-flood limitation",
    ]);
  });

  it("prefers the location's import over the primary source", () => {
    const result = composeNatCat({
      routing: routing({ primary: "swissre-catnet" }),
      imported: zuers,
      results: { "swissre-catnet": catnet },
      now: NOW,
    });
    expect(peril(result, "flood")).toMatchObject({
      score: 50,
      provider: "zuers-geo",
    });
    expect(peril(result, "heavyRain")?.provider).toBe("zuers-geo");
    expect(result?.attributes).toEqual({ floodClass: 2 });
  });

  it("lets an explicit per-peril choice win over the import", () => {
    const result = composeNatCat({
      routing: routing({ perilSources: { flood: "jba-flood" } }),
      imported: zuers,
      results: { "jba-flood": jba },
      now: NOW,
    });
    expect(peril(result, "flood")?.provider).toBe("jba-flood");
  });

  it("falls back along the chain and records why", () => {
    const result = composeNatCat({
      routing: routing({
        primary: "swissre-catnet",
        perilSources: { flood: "jba-flood" },
      }),
      results: {
        "swissre-catnet": catnet,
        "jba-flood": new Error("JBA request failed (503)"),
      },
      now: NOW,
    });
    expect(peril(result, "flood")).toMatchObject({
      score: 30,
      provider: "swissre-catnet",
    });
    expect(result?.evidence.fallbackUsed).toBe(true);
    expect(result?.evidence.limitations).toContain(
      "flood: JBA Risk Management Flood Maps unavailable; Swiss Re CatNet used instead",
    );
  });

  it("records a fallback to screening when no source delivers", () => {
    const result = composeNatCat({
      routing: routing({ primary: "swissre-catnet" }),
      imported: zuers,
      results: { "swissre-catnet": new Error("timeout") },
      now: NOW,
    });
    // Flood still comes from the import; hail falls back to screening.
    expect(peril(result, "flood")?.provider).toBe("zuers-geo");
    expect(peril(result, "hail")).toBeUndefined();
    expect(result?.evidence.limitations).toContain(
      "hail: Swiss Re CatNet unavailable; screening model used instead",
    );
  });

  it("keeps a peril on screening when chosen explicitly", () => {
    const result = composeNatCat({
      routing: routing({
        primary: "swissre-catnet",
        perilSources: { hail: "screening" },
      }),
      imported: zuers,
      results: { "swissre-catnet": catnet },
      now: NOW,
    });
    expect(peril(result, "hail")).toBeUndefined();
    expect(peril(result, "wind")?.provider).toBe("swissre-catnet");
  });
});

describe("importedNatCat", () => {
  it("keeps only user-supplied data from stored assessments", () => {
    expect(importedNatCat({ natCatImport: zuers, natCat: catnet })).toBe(zuers);
    // Older sessions stored the ZÜRS import in `natCat` …
    expect(importedNatCat({ natCat: zuers })).toBe(zuers);
    // … but an API result there must not be re-used as if imported.
    expect(importedNatCat({ natCat: catnet })).toBeUndefined();
  });
});
