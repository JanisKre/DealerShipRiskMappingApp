import { describe, expect, it, vi } from "vitest";

vi.mock("./cache.service", () => ({
  cached: async <T>(_key: string, _ttl: number, fetcher: () => Promise<T>) =>
    fetcher(),
  TTL: { geocode: 1 },
}));
vi.mock("./http.service", () => ({ fetchWithResilience: vi.fn() }));

import { pickGeocodeHit, type GeocodeCandidate } from "./geocoding.service";

const ADDRESS = "Industriestraße 12, 01159 Dresden";
const NAME = "Autohaus Brinkmann GmbH";

function hit(patch: Partial<GeocodeCandidate>): GeocodeCandidate {
  return { label: "hit", lat: 51.05, lon: 13.7, ...patch };
}

describe("pickGeocodeHit", () => {
  it("returns null without hits", () => {
    expect(pickGeocodeHit([], { name: NAME, address: ADDRESS })).toBeNull();
  });

  it("prefers the dealership POI over the street Nominatim lists first", () => {
    const street = hit({
      label: "Industriestraße",
      category: "highway",
      type: "residential",
      postcode: "01159",
    });
    const dealer = hit({
      label: "Autohaus Brinkmann",
      lat: 51.0505,
      name: "Autohaus Brinkmann",
      category: "shop",
      type: "car",
      postcode: "01159",
      houseNumber: "12",
    });
    const pick = pickGeocodeHit([street, dealer], {
      name: NAME,
      address: ADDRESS,
    });
    expect(pick?.hit).toBe(dealer);
    expect(pick?.ambiguity).toBeUndefined();
  });

  it("never picks a same-named branch in another postcode", () => {
    const address = hit({ label: "Industriestraße 12", postcode: "01159" });
    const branch = hit({
      label: "Autohaus Brinkmann Leipzig",
      lat: 51.34,
      lon: 12.37,
      name: "Autohaus Brinkmann",
      category: "shop",
      type: "car",
      postcode: "04109",
    });
    const pick = pickGeocodeHit([address, branch], {
      name: NAME,
      address: ADDRESS,
    });
    expect(pick?.hit).toBe(address);
  });

  it("keeps Nominatim's order on a tie", () => {
    const a = hit({ label: "a" });
    const b = hit({ label: "b", lat: 51.0501 });
    expect(pickGeocodeHit([a, b], { address: ADDRESS })?.hit).toBe(a);
  });

  it("flags distant hits that score alike as ambiguous", () => {
    const a = hit({ label: "a", postcode: "01159" });
    const b = hit({ label: "b", lat: 51.06, postcode: "01159" });
    const pick = pickGeocodeHit([a, b], { address: ADDRESS });
    expect(pick?.hit).toBe(a);
    expect(pick?.ambiguity).toMatch(/geocoding ambiguous: 'b'/);
  });

  it("does not flag near-identical hits of the same place", () => {
    const a = hit({ label: "a" });
    const b = hit({ label: "b", lat: 51.0502 });
    expect(pickGeocodeHit([a, b], { address: ADDRESS })?.ambiguity).toBe(
      undefined,
    );
  });
});
