import { describe, expect, it } from "vitest";
import { checkNumbers, extractNumbers } from "./number-check";
import { keepSupportedSentences as keep } from "./number-check";

const values = (text: string): number[][] =>
  extractNumbers(text).map((n) => n.candidates);

describe("extractNumbers", () => {
  it("reads German, English and French notation", () => {
    expect(values("12.345,67 EUR")).toEqual([[12345.67]]);
    expect(values("12,345.67 EUR")).toEqual([[12345.67]]);
    expect(values("12 345 véhicules")).toEqual([[12345]]);
    expect(values("1.234.567")).toEqual([[1234567]]);
    expect(values("4,5 %")).toEqual([[4.5]]);
  });

  it("keeps both readings of an ambiguous separator", () => {
    expect(values("12.345")).toEqual([[12345, 12.345]]);
  });

  it("separates neighbouring numbers and skips list markers", () => {
    expect(values("Zone 5 2024")).toEqual([[5], [2024]]);
    expect(values("1. Erstens\n2) Zweitens mit 7 Autos")).toEqual([[7]]);
  });
});

describe("checkNumbers", () => {
  const facts = [120, 4, 0.1, 4812.4, 0.35, 2021];

  it("accepts figures the app computed, also rounded as written", () => {
    expect(
      checkNumbers(
        "120 Fahrzeuge in Hagelzone 4, EAL 4.812 EUR, Bild von 2021.",
        facts,
      ).ok,
    ).toBe(true);
    expect(checkNumbers("EAL rund 4.812,4 EUR", facts).ok).toBe(true);
    expect(checkNumbers("Konfidenz 35 %", facts).ok).toBe(true);
  });

  it("flags invented figures", () => {
    expect(checkNumbers("Empfohlener Selbstbehalt 2.500 EUR", facts)).toEqual({
      ok: false,
      unsupported: ["2.500"],
    });
    expect(checkNumbers("etwa 125 Fahrzeuge", facts).unsupported).toEqual([
      "125",
    ]);
  });

  it("has nothing to object to in text without numbers", () => {
    expect(checkNumbers("Die Grenze ist unsicher.", facts).ok).toBe(true);
  });
});

describe("keepSupportedSentences", () => {
  const facts =
    "Autohaus A: 120 vehicles, hail EAL 4812 EUR, event on 2026-11-14, share 35 %";

  it("keeps sentences that quote the facts, also a date written out", () => {
    const text =
      "Autohaus A hat 120 Fahrzeuge. Das Ereignis war am 14.11.2026. Die 3 größten Standorte tragen 35 % bei.";
    expect(keep(text, facts)).toEqual({ text, removed: 0 });
  });

  it("drops sentences with invented amounts, shares and number words", () => {
    const result = keep(
      [
        "Der Standort hat 120 Fahrzeuge.",
        "Ihr Schaden lag 2023 bei 480.000 Euro. Bitte zahlen Sie 10 % Selbstbehalt.",
        "- Der Großschaden liegt bei zwanzigtausend Euro je Fahrzeug.",
        "Ohne Zahl bleibt der Satz.",
      ].join("\n"),
      facts,
    );
    expect(result.removed).toBe(3);
    expect(result.text).toBe(
      "Der Standort hat 120 Fahrzeuge.\nOhne Zahl bleibt der Satz.",
    );
  });
});
