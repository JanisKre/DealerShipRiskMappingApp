import { describe, expect, it } from "vitest";
import {
  foldText,
  parsePlaceQuery,
  textMatchScore,
  tokenMatch,
} from "./place-query";

describe("foldText", () => {
  it.each([
    ["Müller", "mueller"],
    ["MUELLER", "mueller"],
    ["Straße", "strasse"],
    ["Škoda Citroën", "skoda citroen"],
  ])("%s → %s", (text, expected) => {
    expect(foldText(text)).toBe(expected);
  });
});

describe("parsePlaceQuery", () => {
  it("separates name, postcode and legal form", () => {
    expect(parsePlaceQuery("Autohaus Müller GmbH 01067")).toEqual({
      text: "Autohaus Müller 01067",
      tokens: ["autohaus", "mueller", "01067"],
      nameTokens: ["autohaus", "mueller"],
      postcode: "01067",
      addressIntent: false,
      categories: [],
    });
  });

  it("reads a house number as an address", () => {
    const parsed = parsePlaceQuery("Ringweg 3a");
    expect(parsed.addressIntent).toBe(true);
    expect(parsed.nameTokens).toEqual(["ringweg"]);
  });

  it("turns kind words into Overture categories", () => {
    const parsed = parsePlaceQuery("Wohnmobilhändler Dresden");
    expect(parsed.categories).toEqual(["recreational_vehicle_dealer"]);
    expect(parsed.nameTokens).toEqual(["dresden"]);
    expect(parsePlaceQuery("Gebrauchtwagen Müller").categories).toContain(
      "used_auto_dealer",
    );
  });
});

describe("tokenMatch", () => {
  it("accepts prefixes, brand aliases and typos, not other words", () => {
    expect(tokenMatch("herz", "herzog")).toBe(1);
    expect(tokenMatch("vw", "volkswagen")).toBe(1);
    expect(tokenMatch("mueler", "mueller")).toBeGreaterThan(0.6);
    expect(tokenMatch("mueller", "schmidt")).toBe(0);
    // Too short to guess a typo.
    expect(tokenMatch("bwm", "bmw")).toBe(0);
  });
});

describe("textMatchScore", () => {
  it("ignores generic words when the query names more", () => {
    expect(
      textMatchScore(["autohaus", "herzog"], "Herzog Automobile, Dresden"),
    ).toBe(1);
    expect(textMatchScore(["autohaus", "herzog"], "Autohaus Schmidt")).toBe(0);
  });

  it("uses generic words when they are all there is", () => {
    expect(textMatchScore(["autohaus"], "Autohaus Schmidt")).toBe(1);
    expect(textMatchScore([], "Autohaus Schmidt")).toBe(0);
  });
});
