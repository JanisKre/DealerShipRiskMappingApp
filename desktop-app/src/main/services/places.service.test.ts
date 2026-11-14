import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const directory = vi.hoisted(() => ({
  search: vi.fn(() => []),
  locality: vi.fn(),
  portfolio: vi.fn(() => []),
}));
vi.mock("./dealer-directory.service", () => ({
  searchDealerDirectory: directory.search,
  resolveQueryLocality: directory.locality,
}));
vi.mock("./portfolio-index.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./portfolio-index.service")>()),
  portfolioEntries: directory.portfolio,
}));

import {
  normalisePlaceQuery,
  placesAutocomplete,
  resetPhotonState,
  similarBusinessNames,
} from "./places.service";

async function search(
  ...args: Parameters<typeof placesAutocomplete>
): Promise<Awaited<ReturnType<typeof placesAutocomplete>>["suggestions"]> {
  return (await placesAutocomplete(...args)).suggestions;
}

function noLocality(query: { nameTokens: string[] }): unknown {
  return { locality: null, nameTokens: query.nameTokens };
}

beforeEach(() => {
  directory.locality.mockImplementation(noLocality as never);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetPhotonState();
  directory.search.mockReset();
  directory.search.mockReturnValue([]);
  directory.portfolio.mockReset();
  directory.portfolio.mockReturnValue([]);
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

    const hits = await search("Autohaus Muster GmbH");

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

    const hits = await search("Ringweg 3");

    expect(hits[0].label).toBe("Ringweg 3, Musterstadt");
  });

  it("biases towards the map view, clamped to city level", async () => {
    const fetchMock = photonResponses({ dealers: [], general: [] });

    await search("Autohaus", { lat: 51.05, lon: 13.74, zoom: 17 });

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

    const hits = await search("Musterhof");

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

    const hits = await search("Autohaus Dresden");

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

    const hits = await search("Auto");

    expect(hits).toHaveLength(2);
  });
});

describe("ranking", () => {
  it("marks a place both sources know as confirmed", async () => {
    photonResponses({
      dealers: [feature(9, "Autohaus Beispiel", 51.0601, 13.7701)],
      general: [],
    });
    directory.search.mockReturnValue([
      {
        id: "o9",
        name: "Autohaus Beispiel",
        label: "Autohaus Beispiel, Dresden",
        street: null,
        lat: 51.0604,
        lon: 13.7704,
      },
    ] as never);

    const [hit] = await search("Autohaus Beispiel");

    expect(hit.source).toBe("osm");
    expect(hit.sources).toEqual(["osm", "overture"]);
  });

  it("puts an exact Overture dealer above a loose OSM match", async () => {
    photonResponses({
      dealers: [],
      general: [feature(10, "Herzogstraße", 48.1, 11.5)],
    });
    directory.search.mockReturnValue([
      {
        id: "o10",
        name: "Autohaus Bernd Herzog",
        label: "Autohaus Bernd Herzog, Ringweg 1, 01067 Dresden",
        street: "Ringweg 1",
        lat: 51.05,
        lon: 13.74,
      },
    ] as never);

    const hits = await search("Bernd Herzog");

    expect(hits[0].source).toBe("overture");
  });

  it("treats a postcode as a place, not as a house number", async () => {
    photonResponses({
      dealers: [feature(11, "Autohaus Muster", 51.05, 13.74)],
      general: [
        feature(12, "", 51.05, 13.74, {
          street: "Musterweg",
          housenumber: "7",
        }),
      ],
    });

    const hits = await search("Autohaus Muster 01067");

    expect(hits[0].label).toBe("Autohaus Muster, Musterstadt");
  });

  it("biases Photon towards a city named in the query", async () => {
    const fetchMock = photonResponses({ dealers: [], general: [] });
    directory.locality.mockReturnValue({
      locality: {
        kind: "city",
        name: "Leipzig",
        lat: 51.34,
        lon: 12.37,
        radiusKm: 30,
      },
      nameTokens: ["autohaus", "mueller"],
    });

    await search("Autohaus Müller Leipzig", {
      lat: 53.55,
      lon: 9.99,
      zoom: 12,
    });

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("lat")).toBe("51.34");
    expect(url.searchParams.get("zoom")).toBe("11");
    expect(directory.search).toHaveBeenCalledWith(
      expect.objectContaining({ nameTokens: ["autohaus", "mueller"] }),
    );
  });

  it("flags and lifts a place that already is a portfolio location", async () => {
    photonResponses({
      dealers: [
        feature(13, "Autohaus Muster Nord", 51.2, 13.7),
        feature(14, "Autohaus Muster Süd", 51.0, 13.7),
      ],
      general: [],
    });
    directory.portfolio.mockReturnValue([
      {
        sessionId: "s1",
        sessionName: "Sachsen 2026",
        dealershipId: "d1",
        name: "Autohaus Muster Süd",
        lat: 51.0001,
        lon: 13.7001,
        notes: "Besichtigung   im März,\nDach neu",
      },
    ] as never);

    const hits = await search("Autohaus Muster");

    expect(hits[0].label).toBe("Autohaus Muster Süd, Musterstadt");
    expect(hits[0].portfolio).toEqual([
      {
        sessionId: "s1",
        sessionName: "Sachsen 2026",
        dealershipId: "d1",
        name: "Autohaus Muster Süd",
        notesExcerpt: "Besichtigung im März, Dach neu",
      },
    ]);
    expect(hits[1].portfolio).toBeUndefined();
  });

  it("still answers when the portfolio lookup fails", async () => {
    photonResponses({
      dealers: [feature(15, "Autohaus Muster", 51, 13)],
      general: [],
    });
    directory.portfolio.mockImplementation(() => {
      throw new Error("db locked");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await search("Autohaus Muster")).toHaveLength(1);
  });
});

describe("Photon unavailable", () => {
  const overtureHit = {
    id: "ovt-1",
    name: "Autohaus Lokal",
    label: "Autohaus Lokal, Musterstadt",
    lat: 50.5,
    lon: 9.5,
    street: "Hauptstraße 1",
    category: "car",
  };

  it("answers from the local directory and says the online part is missing", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new TypeError("fetch failed: ECONNREFUSED"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    directory.search.mockReturnValue([overtureHit] as never);

    const result = await placesAutocomplete("Autohaus Lokal");

    expect(result.onlineUnavailable).toBe(true);
    expect(result.suggestions.map((s) => [s.label, s.source])).toEqual([
      ["Autohaus Lokal, Musterstadt", "overture"],
    ]);
    // Type-ahead does not retry: one attempt per query, two queries.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("leaves Photon alone during the cooldown and asks again afterwards", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new TypeError("fetch failed"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await placesAutocomplete("Autohaus A");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const paused = await placesAutocomplete("Autohaus B");
    expect(paused.onlineUnavailable).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.setSystemTime(Date.now() + 2 * 60_000 + 1);
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ features: [] }), { status: 200 }),
    );
    const back = await placesAutocomplete("Autohaus B");
    expect(back.onlineUnavailable).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("honours Retry-After on 429 and does not retry", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response("slow down", {
          status: 429,
          headers: { "Retry-After": "600" },
        }),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await placesAutocomplete("Autohaus A");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.setSystemTime(Date.now() + 5 * 60_000);
    await placesAutocomplete("Autohaus B");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not pause Photon for a rejected single query (400)", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response("bad", { status: 400 }));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await placesAutocomplete("Autohaus A");
    await placesAutocomplete("Autohaus B");

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe("Photon cache", () => {
  it("reuses an answer for the same query instead of asking again", async () => {
    const fetchMock = photonResponses({
      dealers: [feature(9, "Autohaus Cache", 50, 8)],
      general: [],
    });

    const first = await search("Autohaus Cache");
    const second = await search("Autohaus Cache");

    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
