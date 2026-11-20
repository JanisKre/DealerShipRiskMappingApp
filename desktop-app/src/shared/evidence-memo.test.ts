import { describe, expect, it } from "vitest";
import type { AnalyzedDealership } from "./types";
import { memoFacts, memoFactsText, verifyMemo } from "./evidence-memo";

const d: AnalyzedDealership = {
  id: "a",
  name: "Autohaus A",
  lat: 48,
  lon: 11,
  deductibleEur: 1000,
  detection: { vehicleCount: 120, confidence: 0.8, model: "yolo" },
  risk: {
    overallScore: 60,
    perils: [],
    eal: 4812.4,
    exposureEur: 3_600_000,
    ealBreakdown: {
      hail: 4812.4,
      total: 4812.4,
      hailDetail: {
        vehicles: 120,
        exposedVehicles: 120,
        vehicleSource: "detected",
        zone: 4,
        zoneSource: "postcode",
        frequency: 0.1,
        meanSeverityEur: 401,
      },
    },
    computedAt: "2026-10-01T00:00:00Z",
  },
};

describe("memoFacts", () => {
  it("lists only what the location has, with stable ids", () => {
    const facts = memoFacts(d);
    expect(facts.map((f) => f.key)).toEqual([
      "vehicles",
      "vehicleSource",
      "hailZone",
      "hailZoneSource",
      "eventsPerYear",
      "lossPerVehicleEur",
      "hailEalEur",
      "exposureEur",
      "deductibleEur",
      "analyzedOn",
    ]);
    expect(facts[0]).toEqual({ id: "f1", key: "vehicles", value: 120 });
    expect(memoFactsText(d, facts)).toContain("[f7] Hail expected annual loss");
  });

  it("has no EAL fact without a vehicle count", () => {
    const none: AnalyzedDealership = structuredClone(d);
    none.detection = undefined;
    none.risk!.ealBreakdown!.hailDetail!.vehicleSource = "none";
    expect(memoFacts(none).some((f) => f.key === "hailEalEur")).toBe(false);
  });
});

describe("verifyMemo", () => {
  const facts = memoFacts(d);

  it("keeps supported sentences and attributes their facts", () => {
    const memo = verifyMemo(
      {
        sentences: [
          {
            text: "Auf dem Gelände wurden 120 Fahrzeuge gezählt.",
            facts: ["f99"],
          },
          {
            text: "Der Hagel-EAL beträgt 4.812 EUR (Screening-Schätzung).",
            facts: ["f7"],
          },
          { text: "Die Grenze sollte geprüft werden.", facts: ["f2"] },
        ],
      },
      facts,
    );
    expect(memo.removed).toEqual([]);
    expect(memo.sentences[0].facts).toEqual(["f1"]);
    expect(memo.sentences[1].facts).toEqual(["f7"]);
    expect(memo.sentences[2].facts).toEqual(["f2"]);
  });

  // Found with a real model: it explains the zone by naming the scale.
  it("lets a sentence name the hail zone scale", () => {
    const memo = verifyMemo(
      {
        sentences: [
          { text: "Hagelzone 4 auf einer Skala von 1 bis 6.", facts: [] },
        ],
      },
      facts,
    );
    expect(memo.removed).toEqual([]);
    expect(memo.sentences).toHaveLength(1);
  });

  it("removes sentences with figures the app did not compute", () => {
    const memo = verifyMemo(
      {
        sentences: [
          {
            text: "Empfohlen wird ein Selbstbehalt von 2.500 EUR.",
            facts: ["f9"],
          },
          { text: "Zuschlag 15 % wegen Hagelzone 4.", facts: [] },
          { text: "Hagelzone 4 laut Postleitzahlentabelle.", facts: ["f3"] },
        ],
      },
      facts,
    );
    expect(memo.sentences.map((s) => s.text)).toEqual([
      "Hagelzone 4 laut Postleitzahlentabelle.",
    ]);
    expect(memo.removed.map((r) => r.unsupported)).toEqual([["2.500"], ["15"]]);
  });
});

describe("verifyMemo: invented figures (November test run)", () => {
  const dated: AnalyzedDealership = {
    ...d,
    risk: {
      ...d.risk!,
      modelVersion: "screening-0.5.3",
      computedAt: "2026-11-14T00:00:00Z",
      ealBreakdown: {
        ...d.risk!.ealBreakdown!,
        hailDetail: {
          ...d.risk!.ealBreakdown!.hailDetail!,
          zone: 6,
          frequency: 0.12,
        },
      },
    },
  };
  const facts = memoFacts(dated);
  const check = (text: string): boolean =>
    verifyMemo({ sentences: [{ text, facts: [] }] }, facts).sentences.length ===
    1;

  it("removes figures that only resemble a digit group of a fact", () => {
    expect(check("Ein Prämienzuschlag von 14 % ist angemessen.")).toBe(false);
    expect(
      check("Rund 12 Prozent der Fahrzeuge werden jedes Jahr beschädigt."),
    ).toBe(false);
    expect(check("Das Risiko steigt jährlich um 6 %.")).toBe(false);
    expect(check("Im Jahr 2026 wurden 11 Hagelschäden gemeldet.")).toBe(false);
    expect(
      check("Der Großschaden liegt bei zwanzigtausend Euro je Fahrzeug."),
    ).toBe(false);
    expect(check("Version 50 des Modells nennt 3 Zonen.")).toBe(false);
  });

  it("keeps the facts, also a date and the model version written out", () => {
    expect(check("Auf dem Gelände stehen 120 Fahrzeuge in Hagelzone 6.")).toBe(
      true,
    );
    expect(check("Die Hagel-EAL beträgt 4.812 EUR.")).toBe(true);
    const memo = verifyMemo(
      {
        sentences: [
          {
            text: "Analysiert am 14.11.2026 mit dem Modell screening-0.5.3.",
            facts: [],
          },
        ],
      },
      facts,
    );
    expect(memo.sentences).toHaveLength(1);
    expect(
      memo.sentences[0].facts.map((id) => facts.find((f) => f.id === id)?.key),
    ).toEqual(expect.arrayContaining(["analyzedOn", "modelVersion"]));
  });
});
