import { describe, expect, it } from "vitest";
import { matchesLocationSearch, normalizeSearchText } from "./tableSearch";

const site = {
  name: "Autohaus Müller GmbH",
  address: "Augsburger Straße 12, 89312 Günzburg",
};

describe("matchesLocationSearch", () => {
  it("finds the town and street in the address", () => {
    expect(matchesLocationSearch(site, "Günzburg")).toBe(true);
    expect(matchesLocationSearch(site, "augsburger strasse")).toBe(true);
    expect(matchesLocationSearch(site, "89312")).toBe(true);
  });

  it("ignores case and accents", () => {
    expect(matchesLocationSearch(site, "MULLER")).toBe(true);
    expect(matchesLocationSearch(site, "gunzburg")).toBe(true);
  });

  it("needs every word, in any order", () => {
    expect(matchesLocationSearch(site, "günzburg müller")).toBe(true);
    expect(matchesLocationSearch(site, "müller berlin")).toBe(false);
  });

  it("does not match figures that aren't in the name or address", () => {
    expect(matchesLocationSearch(site, "2896")).toBe(false);
    expect(matchesLocationSearch({ name: "X" }, "6")).toBe(false);
  });

  it("matches everything for an empty query", () => {
    expect(matchesLocationSearch({ name: "X" }, "  ")).toBe(true);
  });
});

describe("normalizeSearchText", () => {
  it("folds umlauts and ß", () => {
    expect(normalizeSearchText("Groß Äpfel")).toBe("gross apfel");
  });
});
