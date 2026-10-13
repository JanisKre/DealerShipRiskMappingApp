import { describe, expect, it } from "vitest";
import {
  DEFAULT_NAT_CAT_ROUTING,
  composeNatCat,
  effectiveNatCatRouting,
  isDefaultRouting,
  sourcesToQuery,
  type NatCatRouting,
} from "./natcat-routing";
import {
  NatCatSettingsSchema,
  type NatCatApiProvider,
  type NatCatAssessment,
  type NatCatSettings,
} from "./types";

const NOW = new Date("2026-10-04T12:00:00.000Z");

function assessment(
  provider: NatCatApiProvider,
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
      confidence: 0.8,
      fallbackUsed: false,
      limitations: [`${provider} limitation`],
    },
  };
}

const catnet = assessment(
  "swissre-catnet",
  [
    ["hail", 70],
    ["wind", 40],
    ["flood", 30],
  ],
  { hailZone: "H3" },
);

const connectors: NatCatRouting["connectors"] = {
  "swissre-catnet": { endpoint: "https://catnet.example/lookup" },
};

function routing(partial: Partial<NatCatRouting>): NatCatRouting {
  return { primary: "screening", connectors, ...partial };
}

describe("NatCat routing settings", () => {
  it("defaults to screening", () => {
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
      connectors,
    };
    const r = effectiveNatCatRouting({
      ...configured,
      ...DEFAULT_NAT_CAT_ROUTING,
    });
    expect(isDefaultRouting(r)).toBe(true);
    expect(r.connectors).toEqual(connectors);
  });

  it("queries the hail source only when it is connected", () => {
    expect(sourcesToQuery(routing({ primary: "swissre-catnet" }))).toEqual([
      "swissre-catnet",
    ]);
    expect(sourcesToQuery(routing({ primary: "munichre-lri" }))).toEqual([]);
  });
});

describe("legacy NatCat settings", () => {
  it("turns the per-peril hail choice into the hail source", () => {
    const parsed = NatCatSettingsSchema.parse({
      provider: "screening",
      primary: "swissre-catnet",
      perilSources: { hail: "screening", flood: "jba-flood" },
    });
    expect(parsed.primary).toBe("screening");
    expect(parsed).not.toHaveProperty("perilSources");

    const fromOverride = NatCatSettingsSchema.parse({
      provider: "screening",
      perilSources: { hail: "munichre-lri" },
    });
    expect(fromOverride.primary).toBe("munichre-lri");
  });

  it("drops retired flood sources instead of failing to parse", () => {
    const parsed = NatCatSettingsSchema.parse({
      provider: "screening",
      primary: "jba-flood",
      connectors: {
        "jba-flood": { endpoint: "https://jba.example/lookup" },
        "fathom-flood": { endpoint: "https://fathom.example/lookup" },
        "swissre-catnet": { endpoint: "https://catnet.example/lookup" },
      },
    });
    expect(parsed.primary).toBe("screening");
    expect(Object.keys(parsed.connectors ?? {})).toEqual(["swissre-catnet"]);
  });
});

describe("composeNatCat", () => {
  it("leaves hail to screening by default", () => {
    expect(
      composeNatCat({ routing: routing({}), results: {} }),
    ).toBeUndefined();
  });

  it("takes only the hail value from the provider", () => {
    const result = composeNatCat({
      routing: routing({ primary: "swissre-catnet" }),
      results: { "swissre-catnet": catnet },
    });
    expect(result?.provider).toBe("swissre-catnet");
    expect(result?.hazards.map((h) => [h.peril, h.score, h.provider])).toEqual([
      ["hail", 70, "swissre-catnet"],
    ]);
    expect(result?.attributes).toEqual({ hailZone: "H3" });
    expect(result?.evidence).toEqual(catnet.evidence);
  });

  it("falls back to screening when the provider fails", () => {
    expect(
      composeNatCat({
        routing: routing({ primary: "swissre-catnet" }),
        results: { "swissre-catnet": new Error("timeout") },
      }),
    ).toBeUndefined();
  });

  it("falls back to screening when the provider has no hail value", () => {
    expect(
      composeNatCat({
        routing: routing({ primary: "swissre-catnet" }),
        results: {
          "swissre-catnet": assessment("swissre-catnet", [["flood", 30]]),
        },
      }),
    ).toBeUndefined();
  });
});
