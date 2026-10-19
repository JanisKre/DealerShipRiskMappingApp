import { describe, expect, it } from "vitest";
import {
  clusterCandidates,
  rankPlaces,
  type PlaceCandidate,
} from "./place-ranking";

function candidate(
  overrides: Partial<PlaceCandidate> & Pick<PlaceCandidate, "label">,
): PlaceCandidate {
  return {
    lat: 51.05,
    lon: 13.74,
    name: overrides.label.split(",")[0],
    osmKey: null,
    source: "osm",
    dealer: false,
    hasHouseNumber: false,
    sourceRank: 0,
    ...overrides,
  };
}

describe("clusterCandidates", () => {
  it("merges the same OSM object and the same business across sources", () => {
    const clusters = clusterCandidates([
      candidate({ label: "Autohaus Muster, Dresden", osmKey: "N1" }),
      candidate({
        label: "Autohaus Muster, Dresden",
        osmKey: "N1",
        sourceRank: 3,
      }),
      candidate({
        label: "Muster Automobile, Dresden",
        source: "overture",
        lat: 51.0505,
      }),
      candidate({ label: "Auto Schmidt, Dresden", source: "overture" }),
    ]);
    expect(clusters.map((c) => c.length)).toEqual([3, 1]);
  });
});

describe("rankPlaces", () => {
  const tokens = ["autohaus", "muster"];

  it("ranks the name match first, then the dealer, then the nearer one", () => {
    const ranked = rankPlaces(
      [
        candidate({ label: "Hauptstraße, Musterhausen", lat: 51.05 }),
        candidate({
          label: "Autohaus Muster, Leipzig",
          dealer: true,
          lat: 51.34,
          lon: 12.37,
        }),
        candidate({
          label: "Autohaus Muster, Dresden",
          dealer: true,
          sourceRank: 1,
        }),
        candidate({ label: "Autohaus Schmidt, Dresden", dealer: true }),
      ],
      { tokens, addressIntent: false, focus: { lat: 51.05, lon: 13.74 } },
    );
    expect(ranked.map((r) => r.label)).toEqual([
      "Autohaus Muster, Dresden",
      "Autohaus Muster, Leipzig",
      "Hauptstraße, Musterhausen",
      "Autohaus Schmidt, Dresden",
    ]);
  });

  it("prefers addresses with a house number for an address query", () => {
    const ranked = rankPlaces(
      [
        candidate({ label: "Autohaus Ringweg, Dresden", dealer: true }),
        candidate({
          label: "Ringweg 3, Dresden",
          name: null,
          hasHouseNumber: true,
          sourceRank: 2,
        }),
      ],
      { tokens: ["ringweg"], addressIntent: true },
    );
    expect(ranked[0].label).toBe("Ringweg 3, Dresden");
  });

  it("pushes hits outside a named city down", () => {
    const ranked = rankPlaces(
      [
        candidate({
          label: "Autohaus Muster, Hamburg",
          dealer: true,
          lat: 53.55,
          lon: 9.99,
        }),
        candidate({
          label: "Autohaus Muster, Dresden",
          dealer: true,
          sourceRank: 3,
        }),
      ],
      {
        tokens,
        addressIntent: false,
        locality: {
          kind: "city",
          name: "Dresden",
          lat: 51.05,
          lon: 13.74,
          radiusKm: 30,
        },
      },
    );
    expect(ranked[0].label).toBe("Autohaus Muster, Dresden");
  });

  it("shows the OSM label, lists both sources and adds the portfolio match", () => {
    const [place] = rankPlaces(
      [
        candidate({
          label: "Muster Automobile, Dresden",
          source: "overture",
          dealer: true,
        }),
        candidate({
          label: "Autohaus Muster, Hauptstr. 1, Dresden",
          name: "Autohaus Muster",
          dealer: true,
        }),
      ],
      {
        tokens,
        addressIntent: false,
        portfolio: () => [
          {
            sessionId: "s",
            sessionName: "P",
            dealershipId: "d",
            name: "Muster",
          },
        ],
      },
    );
    expect(place.label).toBe("Autohaus Muster, Hauptstr. 1, Dresden");
    expect(place.source).toBe("osm");
    expect(place.sources).toEqual(["osm", "overture"]);
    expect(place.portfolio).toHaveLength(1);
  });

  it("is deterministic: equal scores keep first-seen order", () => {
    const list = [
      candidate({
        label: "Autohaus Muster A, Dresden",
        dealer: true,
        lat: 51.06,
      }),
      candidate({
        label: "Autohaus Muster B, Dresden",
        dealer: true,
        lat: 51.07,
      }),
    ];
    const context = { tokens, addressIntent: false };
    expect(rankPlaces(list, context).map((r) => r.label)).toEqual(
      rankPlaces(list, context).map((r) => r.label),
    );
    expect(rankPlaces(list, context)[0].label).toBe(
      "Autohaus Muster A, Dresden",
    );
  });
});
