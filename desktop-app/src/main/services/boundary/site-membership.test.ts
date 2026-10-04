import { describe, expect, it } from "vitest";
import {
  businessIdentity,
  evaluateComponentMembership,
  isForeignBusiness,
  matchesSiteStrictly,
} from "./site-membership";

describe("businessIdentity", () => {
  it("does not treat a building number as a business", () => {
    expect(businessIdentity({ building: "office", name: "304" })).toBeNull();
  });

  it("does not treat a named business park as one business", () => {
    expect(
      businessIdentity({ landuse: "commercial", name: "Gewerbegebiet Nord" }),
    ).toBeNull();
  });

  it("ignores named site furniture such as a car park", () => {
    expect(
      businessIdentity({ amenity: "parking", name: "Kundenparkplatz" }),
    ).toBeNull();
  });

  it("recognises shops, named industrial plots and operators", () => {
    expect(businessIdentity({ amenity: "fuel", name: "LPG-Tankstelle" })).toBe(
      "LPG-Tankstelle",
    );
    expect(
      businessIdentity({ landuse: "industrial", name: "Fabmatics GmbH" }),
    ).toBe("Fabmatics GmbH");
    expect(businessIdentity({ building: "yes", operator: "Drewag" })).toBe(
      "Drewag",
    );
  });
});

describe("isForeignBusiness", () => {
  const site = "Autohaus Dresden GmbH";

  it("flags another tenant at the same address", () => {
    expect(
      isForeignBusiness(
        {
          amenity: "car_wash",
          name: "Astrein - Die Auto & Industriereinigung GmbH",
        },
        site,
      ),
    ).toBe(true);
  });

  it("does not flag the dealership itself", () => {
    expect(
      isForeignBusiness(
        { shop: "car", name: "Autohaus Dresden GmbH", brand: "Opel" },
        site,
      ),
    ).toBe(false);
  });

  it("declares nothing foreign when the site name has no distinctive token", () => {
    expect(
      isForeignBusiness(
        { shop: "bakery", name: "Bäckerei Krause" },
        "Autohaus GmbH",
      ),
    ).toBe(false);
  });
});

describe("evaluateComponentMembership", () => {
  it("rejects a component whose only support is an adjacent parcel", () => {
    const result = evaluateComponentMembership({ onAdjacentParcel: true });
    expect(result.accepted).toBe(false);
    expect(result.reasons[0]).toMatch(/adjacency alone/);
  });

  it("accepts an adjacent parcel with vehicle-trade use", () => {
    const result = evaluateComponentMembership({
      onAdjacentParcel: true,
      overlappingAreaTags: [{ kind: "dealerArea", tags: { shop: "car" } }],
    });
    expect(result.accepted).toBe(true);
  });

  it("rejects a component containing another business, even when adjacent", () => {
    const result = evaluateComponentMembership({
      onAdjacentParcel: true,
      overlappingAreaTags: [{ kind: "dealerArea", tags: { shop: "car" } }],
      foreignBusinesses: ["Fabmatics GmbH"],
    });
    expect(result.accepted).toBe(false);
    expect(result.reasons[0]).toMatch(/Fabmatics GmbH/);
  });

  it("still accepts a component that carries the site's own name", () => {
    const result = evaluateComponentMembership({
      name: "Autohaus Brinkmann",
      overlappingAreaTags: [
        { kind: "dealerArea", tags: { name: "Autohaus Brinkmann" } },
      ],
    });
    expect(result.accepted).toBe(true);
  });
});

describe("matchesSiteStrictly", () => {
  it("does not let a place name in the dealer's name claim other features", () => {
    expect(matchesSiteStrictly({ building: "retail", name: "Löbtau Passage" }, "Autocenter Löbtau")).toBe(false);
    expect(matchesSiteStrictly({ landuse: "commercial", name: "Gewerbehof Dresden" }, "Opel - Autohaus Dresden GmbH")).toBe(false);
  });

  it("matches when every distinctive token is present, brand included", () => {
    expect(
      matchesSiteStrictly({ name: "Autohaus Dresden GmbH", brand: "Opel" }, "Opel - Autohaus Dresden GmbH"),
    ).toBe(true);
  });

  it("needs the house number for an address match, not just the postcode", () => {
    const tags = { "addr:postcode": "01109", "addr:housenumber": "40" };
    expect(matchesSiteStrictly(tags, undefined, "01109 Dresden")).toBe(false);
    expect(matchesSiteStrictly(tags, undefined, "Zur Wetterwarte 40, 01109 Dresden")).toBe(true);
  });
});
