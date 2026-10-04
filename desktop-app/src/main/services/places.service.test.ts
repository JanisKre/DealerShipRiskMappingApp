import { afterEach, describe, expect, it, vi } from "vitest";

const directory = vi.hoisted(() => ({ search: vi.fn(() => []) }));
vi.mock("./dealer-directory.service", () => ({
  searchDealerDirectory: directory.search,
}));

import {
  normalisePlaceQuery,
  placesAutocomplete,
  similarBusinessNames,
} from "./places.service";

afterEach(() => {
  vi.restoreAllMocks();
  directory.search.mockReset();
  directory.search.mockReturnValue([]);
});

function feature(
  osmId: number,
  name: string,
  lat: number,
  lon: number,
  extra: Record<string, unknown> = {},
): unknown {
  return {
    geometry: { coordinates: [lon, lat] },
    properties: {
      osm_type: "N",
      osm_id: osmId,
      name,
      city: "Musterstadt",
      ...extra,
    },
  };
}

function photonResponses(byTag: {
  dealers: unknown[];
  general: unknown[];
}): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input));
    const features =
      url.searchParams.get("osm_tag") === "shop:car"
        ? byTag.dealers
        : byTag.general;
    return new Response(JSON.stringify({ features }), { status: 200 });
  });
}

describe("normalisePlaceQuery", () => {
  it.each([
    ["Autohaus Muster GmbH & Co. KG", "Autohaus Muster"],
    ["Autohaus Muster GmbH", "Autohaus Muster"],
    ["Muster Automobile e.K. Dresden", "Muster Automobile Dresden"],
    ["Beispiel UG (haftungsbeschränkt)", "Beispiel"],
    ["Hauptstraße 12, Musterstadt", "Hauptstraße 12, Musterstadt"],
  ])("%s → %s", (query, expected) => {
    expect(normalisePlaceQuery(query)).toBe(expected);
  });

  it("keeps the query when it consists of a legal form only", () => {
    expect(normalisePlaceQuery("GmbH")).toBe("GmbH");
  });
});

describe("placesAutocomplete", () => {
  it("queries dealerships separately and lists them first for name searches", async () => {
    const fetchMock = photonResponses({
      dealers: [feature(2, "Autohaus Muster", 51.05, 13.74)],
      general: [
        feature(1, "Musterstraße", 48.1, 11.5),
        feature(2, "Autohaus Muster", 51.05, 13.74),
      ],
    });

    const hits = await placesAutocomplete("Autohaus Muster GmbH");

    expect(hits.map((h) => h.label)).toEqual([
      "Autohaus Muster, Musterstadt",
      "Musterstraße, Musterstadt",
    ]);
    const urls = fetchMock.mock.calls.map(([u]) => new URL(String(u)));
    expect(urls.map((u) => u.searchParams.get("q"))).toEqual([
      "Autohaus Muster",
      "Autohaus Muster",
    ]);
    expect(urls.map((u) => u.searchParams.get("osm_tag"))).toContain(
      "shop:car",
    );
  });

  it("keeps the address ranking first when a house number is typed", async () => {
    photonResponses({
      dealers: [feature(3, "Autohaus Weg", 50, 8)],
      general: [
        feature(4, "", 50.1, 8.1, { street: "Ringweg", housenumber: "3" }),
      ],
    });

    const hits = await placesAutocomplete("Ringweg 3");

    expect(hits[0].label).toBe("Ringweg 3, Musterstadt");
  });

  it("biases towards the map view, clamped to city level", async () => {
    const fetchMock = photonResponses({ dealers: [], general: [] });

    await placesAutocomplete("Autohaus", { lat: 51.05, lon: 13.74, zoom: 17 });

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("lat")).toBe("51.05");
    expect(url.searchParams.get("lon")).toBe("13.74");
    expect(url.searchParams.get("zoom")).toBe("12");
  });

  it("still answers when only one of the two queries fails", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.searchParams.get("osm_tag")) {
        return new Response("down", { status: 400 });
      }
      return new Response(
        JSON.stringify({ features: [feature(5, "Musterhof", 50, 9)] }),
        { status: 200 },
      );
    });

    const hits = await placesAutocomplete("Musterhof");

    expect(hits.map((h) => h.label)).toEqual(["Musterhof, Musterstadt"]);
  });
});

describe("OSM + Overture merge", () => {
  it("adds Overture-only dealers and lists a shared one once (OSM wins)", async () => {
    photonResponses({
      dealers: [feature(7, "Opel - Autohaus Dresden GmbH", 51.0601, 13.7701)],
      general: [],
    });
    directory.search.mockReturnValue([
      // Same business, 60 m away in Overture.
      {
        id: "o1",
        name: "Autohaus Dresden",
        label: "Autohaus Dresden, Dresden",
        lat: 51.0605,
        lon: 13.7706,
      },
      // Only in Overture.
      {
        id: "o2",
        name: "Autohaus Kleinschmidt",
        label: "Autohaus Kleinschmidt, Pirna",
        lat: 50.96,
        lon: 13.94,
      },
    ] as never);

    const hits = await placesAutocomplete("Autohaus Dresden");

    expect(hits.map((h) => [h.label, h.source])).toEqual([
      ["Opel - Autohaus Dresden GmbH, Musterstadt", "osm"],
      ["Autohaus Kleinschmidt, Pirna", "overture"],
    ]);
  });

  it("keeps two different dealers next to each other apart", async () => {
    photonResponses({
      dealers: [feature(8, "Auto Müller", 50.0, 8.0)],
      general: [],
    });
    directory.search.mockReturnValue([
      {
        id: "o3",
        name: "Auto Schmidt",
        label: "Auto Schmidt, Musterstadt",
        lat: 50.0003,
        lon: 8.0003,
      },
    ] as never);

    const hits = await placesAutocomplete("Auto");

    expect(hits).toHaveLength(2);
  });
});

describe("similarBusinessNames", () => {
  it.each([
    ["Opel - Autohaus Dresden GmbH", "Autohaus Dresden", true],
    ["Autohaus Bernd Herzog", "Bernd Herzog Automobile", true],
    ["Auto Müller", "Auto Schmidt", false],
    ["Autohaus", "Autohaus", true],
  ])("%s ≈ %s → %s", (a, b, expected) => {
    expect(similarBusinessNames(a, b)).toBe(expected);
  });
});
