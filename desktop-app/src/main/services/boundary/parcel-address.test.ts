import { describe, expect, it } from "vitest";
import { addressKeys, sharesAddress } from "./parcel-address";

describe("addressKeys", () => {
  it("reads a street with one house number", () => {
    expect(addressKeys("Schmiedstraße 12")).toEqual(["schmiedstr|12"]);
  });

  it("treats Str., Straße and Strasse alike", () => {
    expect(addressKeys("Hattinger Str. 983")).toEqual(
      addressKeys("Hattinger Straße 983"),
    );
    expect(addressKeys("Hattinger Strasse 983")).toEqual(
      addressKeys("Hattinger Straße 983"),
    );
  });

  it("reads several numbers and number suffixes", () => {
    expect(addressKeys("Kölner Straße 260, 262, 264")).toEqual([
      "kölnerstr|260",
      "kölnerstr|262",
      "kölnerstr|264",
    ]);
    expect(addressKeys("Landstraße 36 a")).toEqual(["landstr|36a"]);
  });

  it("reads several streets of one parcel", () => {
    expect(addressKeys("An der Insel 2; Landstraße 36 a")).toEqual([
      "anderinsel|2",
      "landstr|36a",
    ]);
  });

  it("gives no key for a street name alone", () => {
    expect(addressKeys("Hauptstraße")).toEqual([]);
    expect(addressKeys("B 109; Stettiner Straße")).toEqual([]);
    expect(addressKeys(undefined)).toEqual([]);
  });

  it("expands a range and stops at the postcode", () => {
    expect(addressKeys("Schwarzwaldstraße 96-98, 68163 Mannheim")).toEqual([
      "schwarzwaldstr|96",
      "schwarzwaldstr|98",
      "schwarzwaldstr|97",
    ]);
    expect(addressKeys("Auerbacher Straße 28 - 30")).toContain(
      "auerbacherstr|30",
    );
  });

  it("continues the street for numbers after a semicolon", () => {
    expect(addressKeys("Wandsbeker Chaussee 195;197")).toEqual([
      "wandsbekerchaussee|195",
      "wandsbekerchaussee|197",
    ]);
  });

  it("ignores a district in brackets", () => {
    expect(addressKeys("Zeitzer Straße (Bornitz) 18")).toEqual([
      "zeitzerstr|18",
    ]);
  });
});

describe("sharesAddress", () => {
  it("matches a dealership's range against a parcel's numbers", () => {
    const site = new Set(addressKeys("Schwarzwaldstraße 92-100"));
    expect(sharesAddress(site, "Schwarzwaldstraße 98, 100")).toBe(true);
    expect(sharesAddress(site, "Schwarzwaldstraße 102")).toBe(false);
    expect(sharesAddress(site, "Schwarzwaldstraße")).toBe(false);
    expect(sharesAddress(new Set(), "Schwarzwaldstraße 98")).toBe(false);
  });
});
