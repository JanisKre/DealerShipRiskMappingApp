import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  cache: new Map<string, unknown>(),
}));
vi.mock("./http.service", () => ({ fetchWithResilience: mocks.fetch }));
vi.mock("./cache.service", () => ({
  cached: async (
    key: string,
    _ttl: number,
    fetcher: () => Promise<unknown>,
  ) => {
    if (mocks.cache.has(key)) return mocks.cache.get(key);
    const value = await fetcher();
    mocks.cache.set(key, value);
    return value;
  },
  TTL: { cadastre: 1 },
}));

import {
  addressFilter,
  matchAddress,
  normalizeStreet,
  officialHouseCoordinate,
  parseBerlinAddresses,
  parseInspireAddresses,
  parseStreetAddress,
  parseThoroughfareNames,
} from "./house-coordinates.service";

function collection(...members: string[]): string {
  return `<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0">${members
    .map((m) => `<wfs:member>${m}</wfs:member>`)
    .join("")}</wfs:FeatureCollection>`;
}

/** Real layout of Saxony's INSPIRE `ad:Address` (relative component links). */
function snAddress(
  lat: number,
  lon: number,
  number: string,
  street: string,
): string {
  return `<Address gml:id="Address_x"><position><GeographicPosition><geometry><gml:Point><gml:pos>${lat} ${lon}</gml:pos></gml:Point></geometry></GeographicPosition></position><locator><AddressLocator><designator><LocatorDesignator><designator>${number}</designator><type xlink:href="http://inspire.ec.europa.eu/codelist/LocatorDesignatorTypeValue/addressNumber"/></LocatorDesignator></designator></AddressLocator></locator><component xlink:href="DE.SN.AD/PostalDescriptor_01237_Dresden"/><component xlink:href="DE.SN.AD/${street}"/></Address>`;
}

/** Real layout of MV/BW/SL: components are GetFeatureById URLs. */
const BW_ADDRESS = `<ad:Address gml:id="Address.DEBWhx2210003zLa"><ad:position><ad:GeographicPosition><ad:geometry><gml:Point srsName="urn:ogc:def:crs:EPSG::4258"><gml:pos>48.775564 9.183613</gml:pos></gml:Point></ad:geometry></ad:GeographicPosition></ad:position><ad:locator><ad:AddressLocator><ad:designator><ad:LocatorDesignator><ad:designator>1</ad:designator><ad:type xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="https://inspire.ec.europa.eu/codelist/LocatorDesignatorTypeValue/addressNumber"/></ad:LocatorDesignator></ad:designator></ad:AddressLocator></ad:locator><ad:component xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="https://owsproxy.lgl-bw.de/owsproxy/wfs/WFS_INSP_BW_Adr_Hauskoord_ALKIS?SERVICE=WFS&amp;REQUEST=GetFeature&amp;STOREDQUERY_ID=urn:ogc:def:query:OGC-WFS::GetFeatureById&amp;ID=PostalDescriptor.70182#PostalDescriptor.70182"/><ad:component xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="https://owsproxy.lgl-bw.de/owsproxy/wfs/WFS_INSP_BW_Adr_Hauskoord_ALKIS?SERVICE=WFS&amp;REQUEST=GetFeature&amp;STOREDQUERY_ID=urn:ogc:def:query:OGC-WFS::GetFeatureById&amp;ID=ThoroughfareName.0811100009060#ThoroughfareName.0811100009060"/></ad:Address>`;

const BERLIN_ADDRESS = `<adressen_berlin:adressen_berlin gml:id="adressen_berlin.146340"><adressen_berlin:hnr>3</adressen_berlin:hnr><adressen_berlin:str_name>Spandauer Straße</adressen_berlin:str_name><adressen_berlin:plz>10178</adressen_berlin:plz><adressen_berlin:geom><gml:Point srsName="urn:ogc:def:crs:EPSG::4326"><gml:pos>52.52016737 13.40412701</gml:pos></gml:Point></adressen_berlin:geom></adressen_berlin:adressen_berlin>`;

function streetName(id: string, name: string): string {
  return `<ThoroughfareName gml:id="${id}"><name><GeographicalName><spelling><SpellingOfName><text>${name}</text></SpellingOfName></spelling></GeographicalName></name></ThoroughfareName>`;
}

describe("parseStreetAddress", () => {
  it.each([
    [
      "Reicker Str. 113, 01237 Dresden",
      { street: "Reicker Str.", number: "113", suffix: "", postcode: "01237" },
    ],
    [
      "Industriestraße 12a, 01159 Dresden",
      {
        street: "Industriestraße",
        number: "12",
        suffix: "a",
        postcode: "01159",
      },
    ],
    [
      "Am Hafen 4-6, 24116 Kiel",
      { street: "Am Hafen", number: "4", suffix: "", postcode: "24116" },
    ],
    [
      "01237 Dresden, Reicker Straße 113",
      {
        street: "Reicker Straße",
        number: "113",
        suffix: "",
        postcode: "01237",
      },
    ],
  ])("%s", (address, expected) => {
    expect(parseStreetAddress(address)).toEqual(expected);
  });

  it("returns null without a street and number", () => {
    expect(parseStreetAddress("01237 Dresden")).toBeNull();
  });
});

describe("normalizeStreet", () => {
  it("folds abbreviations, umlauts and punctuation", () => {
    expect(normalizeStreet("Reicker Str.")).toBe(
      normalizeStreet("Reicker Straße"),
    );
    expect(normalizeStreet("Bischofstr.")).toBe(
      normalizeStreet("Bischofstraße"),
    );
    expect(normalizeStreet("Stephan-Heinzel-Str.")).toBe(
      normalizeStreet("Stephan Heinzel Straße"),
    );
    expect(normalizeStreet("Mühlenweg")).toBe("muehlenweg");
  });
});

describe("parsers", () => {
  it("reads INSPIRE number, postcode and street link (relative links)", () => {
    expect(
      parseInspireAddresses(
        collection(
          snAddress(51.0132, 13.7929, "113", "ThoroughfareName_1461200010028"),
        ),
      ),
    ).toEqual([
      {
        lat: 51.0132,
        lon: 13.7929,
        houseNumber: "113",
        postcode: "01237",
        streetId: "ThoroughfareName_1461200010028",
      },
    ]);
  });

  it("reads INSPIRE links written as GetFeatureById URLs", () => {
    expect(parseInspireAddresses(collection(BW_ADDRESS))[0]).toMatchObject({
      houseNumber: "1",
      postcode: "70182",
      streetId: "ThoroughfareName.0811100009060",
    });
  });

  it("joins a number and its suffix designator", () => {
    const xml = collection(
      snAddress(51, 13, "4", "ThoroughfareName_1").replace(
        "</LocatorDesignator></designator>",
        "</LocatorDesignator></designator><designator><LocatorDesignator><designator>A</designator></LocatorDesignator></designator>",
      ),
    );
    expect(parseInspireAddresses(xml)[0].houseNumber).toBe("4a");
  });

  it("reads Berlin's inline street and postcode", () => {
    expect(parseBerlinAddresses(collection(BERLIN_ADDRESS))).toEqual([
      {
        lat: 52.52016737,
        lon: 13.40412701,
        houseNumber: "3",
        street: "Spandauer Straße",
        postcode: "10178",
      },
    ]);
  });

  it("maps resolved street names by gml:id", () => {
    expect(
      parseThoroughfareNames(
        collection(streetName("ThoroughfareName_1", "Reicker Straße")),
      ),
    ).toEqual(new Map([["ThoroughfareName_1", "Reicker Straße"]]));
  });
});

describe("addressFilter", () => {
  it("combines the box with every spelling of the number", () => {
    const filter = addressFilter("inspire", 51, 13, 400, ["12", "12a"]);
    expect(filter).toContain("<fes:BBOX>");
    expect(filter).toContain("<fes:Or>");
    expect(filter).toContain("<fes:Literal>12a</fes:Literal>");
    expect(filter).toContain("EPSG::4258");
  });

  it("escapes the literal", () => {
    expect(addressFilter("berlin", 52, 13, 400, ["1<2"])).toContain("1&#60;2");
  });
});

describe("matchAddress", () => {
  const wanted = parseStreetAddress("Reicker Str. 113, 01237 Dresden")!;
  const hit = {
    lat: 51.0132,
    lon: 13.7929,
    houseNumber: "113",
    postcode: "01237",
    street: "Reicker Straße",
  };

  it("matches street, number and postcode", () => {
    expect(matchAddress(wanted, [hit])).toBe(hit);
  });

  it("rejects another street, postcode or suffix", () => {
    expect(matchAddress(wanted, [{ ...hit, street: "Altreick" }])).toBeNull();
    expect(matchAddress(wanted, [{ ...hit, postcode: "01239" }])).toBeNull();
    expect(matchAddress(wanted, [{ ...hit, houseNumber: "113a" }])).toBeNull();
  });

  it("refuses to choose between two distant buildings", () => {
    expect(
      matchAddress(wanted, [hit, { ...hit, lat: hit.lat + 0.001 }]),
    ).toBeNull();
  });
});

describe("officialHouseCoordinate", () => {
  const ok = (body: string): Response =>
    ({ ok: true, status: 200, text: () => Promise.resolve(body) }) as Response;
  const DRESDEN = { lat: 51.013, lon: 13.793 };

  beforeEach(() => {
    mocks.fetch.mockReset();
    mocks.cache.clear();
  });

  it("finds the address and resolves its street in a second request", async () => {
    mocks.fetch.mockImplementation((url: string) =>
      Promise.resolve(
        ok(
          url.includes("ThoroughfareName&RESOURCEID")
            ? collection(
                streetName("ThoroughfareName_1", "Reicker Straße"),
                streetName("ThoroughfareName_2", "Altreick"),
              )
            : collection(
                snAddress(51.0132, 13.7929, "113", "ThoroughfareName_1"),
                snAddress(51.0101, 13.7951, "113", "ThoroughfareName_2"),
              ),
        ),
      ),
    );
    const result = await officialHouseCoordinate(
      "Reicker Str. 113, 01237 Dresden",
      DRESDEN,
    );
    expect(result).toEqual({ lat: 51.0132, lon: 13.7929, state: "Sachsen" });
    expect(String(mocks.fetch.mock.calls[0][0])).toContain("alkis/ad/dls/wfs");
  });

  it("asks for street names in batches of ten", async () => {
    const addresses = Array.from({ length: 12 }, (_, i) =>
      snAddress(51.01 + i * 0.0001, 13.79, "113", `ThoroughfareName_${i}`),
    );
    mocks.fetch.mockImplementation((url: string) =>
      Promise.resolve(
        ok(
          url.includes("RESOURCEID") ? collection() : collection(...addresses),
        ),
      ),
    );
    await officialHouseCoordinate("Reicker Str. 113, 01237 Dresden", DRESDEN);
    const lookups = mocks.fetch.mock.calls.filter((c) =>
      String(c[0]).includes("RESOURCEID"),
    );
    expect(lookups).toHaveLength(2);
  });

  it("does not cache a failure", async () => {
    mocks.fetch.mockRejectedValue(new Error("timeout"));
    expect(
      await officialHouseCoordinate("Reicker Str. 113, 01237 Dresden", DRESDEN),
    ).toBeNull();
    expect(mocks.cache.size).toBe(0);
  });

  it("asks nothing where no state publishes house coordinates (Munich)", async () => {
    expect(
      await officialHouseCoordinate("Marienplatz 8, 80331 München", {
        lat: 48.137,
        lon: 11.575,
      }),
    ).toBeNull();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
