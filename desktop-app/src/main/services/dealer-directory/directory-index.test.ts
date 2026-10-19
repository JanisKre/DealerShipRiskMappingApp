import { describe, expect, it } from "vitest";
import type { DealerRecord } from "./overture-dealers";
import {
  CITY_RADIUS_KM,
  DirectoryIndex,
  POSTCODE_RADIUS_KM,
} from "./directory-index";

function dealer(
  id: string,
  name: string,
  city: string,
  lat: number,
  lon: number,
  extra: Partial<DealerRecord> = {},
): DealerRecord {
  return {
    id,
    name,
    category: "auto_dealer",
    brand: null,
    street: null,
    postcode: null,
    city,
    lat,
    lon,
    confidence: 0.9,
    ...extra,
  };
}

const records = [
  dealer("f1", "Autohaus Main", "Frankfurt am Main", 50.11, 8.68),
  dealer("f2", "Auto Main", "Frankfurt am Main", 50.12, 8.69),
  dealer("f3", "Autohaus Oder", "Frankfurt (Oder)", 52.34, 14.55),
  dealer("d1", "Autohaus Müller", "Dresden", 51.05, 13.74, {
    postcode: "01067",
  }),
  dealer("d2", "Volkswagen Zentrum", "Dresden", 51.06, 13.75, {
    brand: "Volkswagen",
    category: "auto_dealer",
  }),
  // A record with a wrong city must not drag the centre away.
  dealer("d3", "Autohaus Fern", "Dresden", 48.0, 11.0),
  dealer("d4", "Autohaus Nah", "Dresden", 51.04, 13.73),
];
const index = new DirectoryIndex(records);

describe("resolveLocality", () => {
  it("finds a city at the end of the query, at the dealers' median", () => {
    const { locality, nameTokens } = index.resolveLocality(
      ["autohaus", "mueller", "dresden"],
      null,
    );
    expect(locality).toMatchObject({
      kind: "city",
      name: "Dresden",
      radiusKm: CITY_RADIUS_KM,
    });
    expect(locality!.lat).toBeCloseTo(51.045, 2);
    expect(nameTokens).toEqual(["autohaus", "mueller"]);
  });

  it("matches multi-word cities and their short form", () => {
    expect(
      index.resolveLocality(["auto", "frankfurt", "am", "main"], null).locality
        ?.name,
    ).toBe("Frankfurt am Main");
    // The bigger Frankfurt wins the short form, without mixing the two.
    const short = index.resolveLocality(["auto", "frankfurt"], null).locality;
    expect(short?.name).toBe("Frankfurt am Main");
    expect(short!.lat).toBeLessThan(51);
  });

  it("needs something left to search for, unless a kind was asked for", () => {
    expect(index.resolveLocality(["dresden"], null).locality).toBeNull();
    expect(index.resolveLocality(["dresden"], null, true)).toMatchObject({
      locality: { name: "Dresden" },
      nameTokens: [],
    });
  });

  it("prefers a known postcode", () => {
    const { locality } = index.resolveLocality(["autohaus"], "01067");
    expect(locality).toMatchObject({
      kind: "postcode",
      name: "01067",
      radiusKm: POSTCODE_RADIUS_KM,
    });
    expect(index.resolveLocality(["autohaus"], "99999").locality).toBeNull();
  });
});

describe("fuzzySearch", () => {
  const all = (): boolean => true;

  it("finds typos of every specific token", () => {
    expect(
      index.fuzzySearch(["autohaus", "mueler"], all, 5).map((h) => h.record.id),
    ).toEqual(["d1"]);
    expect(index.fuzzySearch(["volkswagn"], all, 5)[0].record.id).toBe("d2");
  });

  it("does not guess on generic or short words", () => {
    expect(index.fuzzySearch(["autohaus"], all, 5)).toEqual([]);
    expect(index.fuzzySearch(["mai"], all, 5)).toEqual([]);
  });

  it("applies the filter", () => {
    expect(index.fuzzySearch(["mueler"], (r) => r.id !== "d1", 5)).toEqual([]);
  });
});

describe("nearby", () => {
  it("lists accepted dealers inside the radius, nearest first", () => {
    const locality = {
      kind: "city" as const,
      name: "Dresden",
      lat: 51.05,
      lon: 13.74,
      radiusKm: 10,
    };
    expect(
      index.nearby(locality, (r) => r.id !== "d2", 5).map((r) => r.id),
    ).toEqual(["d1", "d4"]);
  });
});
