/**
 * The OSM lookup feeds the stored dealership website, so it must pick the
 * dealership rather than the nearest shop, and never cache an Overpass
 * outage as "no details".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cacheSet: vi.fn(),
  fetchOverpass: vi.fn(),
}));

vi.mock("./cache.service", () => ({
  cached: async <T>(key: string, ttl: number, fetcher: () => Promise<T>) => {
    const value = await fetcher();
    mocks.cacheSet(key, value, ttl);
    return value;
  },
  TTL: { osmDetails: 1 },
}));
vi.mock("./boundary.service", () => ({ fetchOverpass: mocks.fetchOverpass }));

import { getOsmDetails, pickDealershipPoi } from "./osmDetails.service";

const lat = 48.1374;
const lon = 11.5755;
const near = { lat: lat + 0.0002, lon };
const far = { lat: lat + 0.003, lon };

const pharmacy = {
  ...near,
  tags: {
    amenity: "pharmacy",
    name: "Rathaus-Apotheke",
    website: "https://rathausapotheke.de",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("pickDealershipPoi", () => {
  it("ignores unrelated POIs even when they are closest", () => {
    expect(
      pickDealershipPoi([pharmacy], lat, lon, "Autohaus Müller GmbH"),
    ).toBeNull();
  });

  it("prefers a car dealer over a closer unrelated shop", () => {
    const dealer = { ...far, tags: { shop: "car", name: "BMW Niederlassung" } };
    expect(
      pickDealershipPoi([pharmacy, dealer], lat, lon, "Autohaus Test"),
    ).toBe(dealer);
  });

  it("matches the name on distinctive words, not generic ones", () => {
    const other = { ...near, tags: { shop: "car", name: "Autohaus Schmidt" } };
    const mueller = {
      ...far,
      tags: { shop: "car", name: "Mueller Automobile" },
    };
    const muller = { ...far, tags: { shop: "car", name: "Müller Automobile" } };
    expect(
      pickDealershipPoi([other, muller], lat, lon, "Autohaus Müller GmbH"),
    ).toBe(muller);
    // Generic tokens alone ("Autohaus") never count as a name match.
    expect(pickDealershipPoi([other, mueller], lat, lon, "Autohaus GmbH")).toBe(
      other,
    );
  });

  it("accepts a name match outside the car categories", () => {
    const office = { ...near, tags: { office: "company", name: "Huber Kfz" } };
    expect(pickDealershipPoi([office], lat, lon, "Huber Kfz-Handel")).toBe(
      office,
    );
  });

  it("uses the street to break ties between car dealers", () => {
    const a = {
      ...near,
      tags: { shop: "car", "addr:street": "Lindwurmstraße" },
    };
    const b = { ...near, tags: { shop: "car", "addr:street": "Musterstraße" } };
    expect(
      pickDealershipPoi([a, b], lat, lon, "Autohaus", "Musterstr. 5, München"),
    ).toBe(b);
  });
});

describe("getOsmDetails", () => {
  it("returns the matched dealership's normalised website", async () => {
    mocks.fetchOverpass.mockResolvedValue({
      elements: [
        pharmacy,
        {
          ...far,
          tags: { shop: "car", name: "Autohaus Test", website: "autohaus.de" },
        },
      ],
    });

    const details = await getOsmDetails(lat, lon, "Autohaus Test");

    expect(details.website).toBe("https://autohaus.de/");
    expect(details.category).toBe("car");
  });

  it("returns no details when only unrelated POIs are nearby", async () => {
    mocks.fetchOverpass.mockResolvedValue({ elements: [pharmacy] });

    expect(await getOsmDetails(lat, lon, "Autohaus Test")).toEqual({});
  });

  it("throws on an Overpass outage instead of caching empty details", async () => {
    mocks.fetchOverpass.mockResolvedValue(null);

    await expect(getOsmDetails(lat, lon, "Autohaus Test")).rejects.toThrow();
    expect(mocks.cacheSet).not.toHaveBeenCalled();
  });
});
