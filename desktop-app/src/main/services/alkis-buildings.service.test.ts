import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  cache: new Map<string, unknown>(),
}));
vi.mock("./http.service", () => ({ fetchWithResilience: mocks.fetch }));
vi.mock("./cache.service", () => ({
  cacheGet: (key: string) => mocks.cache.get(key),
  cacheSet: (key: string, value: unknown) => mocks.cache.set(key, value),
  TTL: { cadastre: 1 },
}));

import {
  classifyBuilding,
  fetchOfficialBuildings,
  parseOfficialBuildings,
  resetBuildingCircuits,
} from "./alkis-buildings.service";

const RING =
  "50.93680 6.95800 50.93680 6.95850 50.93700 6.95850 50.93700 6.95800 50.93680 6.95800";

function polygon(posList = RING): string {
  return `<gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>${posList}</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon>`;
}

function collection(...members: string[]): string {
  return `<?xml version="1.0"?><wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0" numberMatched="${members.length}" numberReturned="${members.length}">${members
    .map((m) => `<wfs:member>${m}</wfs:member>`)
    .join("")}</wfs:FeatureCollection>`;
}

/** Real attribute layout of NRW's `ave:GebaeudeBauwerk` (ALKIS simplified). */
const AVE_CAR_PARK = `<GebaeudeBauwerk><geometrie>${polygon()}</geometrie><gebnutzbez>Gebäude</gebnutzbez><funktion>Parkhaus</funktion><gfkzshh>31001_2461</gfkzshh></GebaeudeBauwerk>`;
const AVE_CANOPY = `<GebaeudeBauwerk><geometrie>${polygon()}</geometrie><funktion>Überdachung</funktion><gfkzshh>51009_1610</gfkzshh></GebaeudeBauwerk>`;
/** Real attribute layout of Lower Saxony's `adv:AX_Gebaeude`. */
const ADV_HALL = `<AX_Gebaeude><position>${polygon()}</position><gebaeudefunktion>2010</gebaeudefunktion></AX_Gebaeude>`;
const ADV_UNDERGROUND = `<AX_Gebaeude><position>${polygon()}</position><gebaeudefunktion>2465</gebaeudefunktion><lageZurErdoberflaeche>1200</lageZurErdoberflaeche></AX_Gebaeude>`;
/** Real attribute layout of Berlin's `alkis_gebaeude:gebaeude`. */
const BERLIN_DECK = `<alkis_gebaeude:gebaeude><alkis_gebaeude:gfk>2462</alkis_gebaeude:gfk><alkis_gebaeude:bezofl/><alkis_gebaeude:geom>${polygon()}</alkis_gebaeude:geom></alkis_gebaeude:gebaeude>`;
/** INSPIRE `bu-core2d:Building`: only a coarse use, no function. */
const INSPIRE = `<bu-core2d:Building><bu-base:currentUse><bu-base:CurrentUse><bu-base:currentUse xlink:href="http://inspire.ec.europa.eu/codelist/CurrentUseValue/residential"/></bu-base:CurrentUse></bu-base:currentUse><bu-core2d:geometry2D>${polygon()}</bu-core2d:geometry2D></bu-core2d:Building>`;

describe("classifyBuilding", () => {
  it.each([
    ["ave Parkhaus", AVE_CAR_PARK, true, true],
    ["ave Überdachung", AVE_CANOPY, false, true],
    ["adv hall", ADV_HALL, false, true],
    ["Berlin Parkdeck", BERLIN_DECK, true, true],
    ["INSPIRE", INSPIRE, false, false],
  ])("%s", (_, xml, parkingRoof, functionKnown) => {
    expect(classifyBuilding(xml)).toMatchObject({ parkingRoof, functionKnown });
  });

  it("recognises underground structures by code or text", () => {
    expect(classifyBuilding(ADV_UNDERGROUND).underground).toBe(true);
    expect(
      classifyBuilding("<bezofl>Unter der Erdoberfläche</bezofl>").underground,
    ).toBe(true);
    expect(classifyBuilding(ADV_HALL).underground).toBe(false);
  });
});

describe("parseOfficialBuildings", () => {
  it("reads one footprint per feature with its function, in [lon, lat]", () => {
    const buildings = parseOfficialBuildings(
      collection(AVE_CAR_PARK, ADV_HALL, INSPIRE),
    );
    expect(buildings).toHaveLength(3);
    expect(buildings[0].ring[0]).toEqual([6.958, 50.9368]);
    expect(buildings.map((b) => b.parkingRoof)).toEqual([true, false, false]);
    expect(buildings.map((b) => b.functionKnown)).toEqual([true, true, false]);
  });

  it("skips underground structures, which have no roof in the image", () => {
    expect(parseOfficialBuildings(collection(ADV_UNDERGROUND))).toEqual([]);
  });
});

describe("fetchOfficialBuildings", () => {
  const ok = (body: string): Response =>
    ({ ok: true, status: 200, text: () => Promise.resolve(body) }) as Response;

  beforeEach(() => {
    mocks.fetch.mockReset();
    mocks.cache.clear();
    resetBuildingCircuits();
  });

  it("asks the state's WFS with a BBOX and caches the answer", async () => {
    mocks.fetch.mockResolvedValue(ok(collection(ADV_HALL)));
    // Hannover: Lower Saxony's full-ALKIS service.
    const first = await fetchOfficialBuildings(52.3759, 9.732);
    expect(first.state).toBe("Niedersachsen");
    expect(first.buildings).toHaveLength(1);
    const url = String(mocks.fetch.mock.calls[0][0]);
    expect(url).toContain("alkis_wfs_sf");
    expect(url).toContain("typeNames=adv%3AAX_Gebaeude");
    expect(decodeURIComponent(url)).toMatch(/bbox=52\.37\d+,9\.72\d+,/);

    await fetchOfficialBuildings(52.3759, 9.732);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("filters Thüringen on its UTM 32N grid", async () => {
    // Erfurt also lies in Saxony-Anhalt's rough box; that service has
    // nothing there, so the next candidate state is asked.
    mocks.fetch.mockImplementation((url: string) =>
      Promise.resolve(
        ok(
          url.includes("adv_alkis_wfs") ? collection(AVE_CANOPY) : collection(),
        ),
      ),
    );
    const result = await fetchOfficialBuildings(50.9848, 11.0299);
    expect(result.state).toBe("Thüringen");
    const url = decodeURIComponent(String(mocks.fetch.mock.calls.at(-1)?.[0]));
    expect(url).toContain("adv_alkis_wfs");
    expect(url).toMatch(/bbox=6\d{5}\.\d+,5\d{6}\.\d+,.*EPSG::25832/);
  });

  it("shares one request between concurrent callers", async () => {
    mocks.fetch.mockResolvedValue(ok(collection(ADV_HALL)));
    await Promise.all([
      fetchOfficialBuildings(52.3759, 9.732),
      fetchOfficialBuildings(52.3759, 9.732),
    ]);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("returns nothing and caches nothing when the service fails", async () => {
    mocks.fetch.mockRejectedValue(new Error("timeout"));
    const result = await fetchOfficialBuildings(52.3759, 9.732);
    expect(result.buildings).toEqual([]);
    expect(mocks.cache.size).toBe(0);
  });

  it("treats a WFS exception as a failure", async () => {
    mocks.fetch.mockResolvedValue(
      ok("<ows:ExceptionReport><ows:Exception/></ows:ExceptionReport>"),
    );
    expect((await fetchOfficialBuildings(52.3759, 9.732)).buildings).toEqual(
      [],
    );
    expect(mocks.cache.size).toBe(0);
  });

  it("reads the open LoD2 tiles in Bayern, which has no building WFS (Munich)", async () => {
    mocks.fetch.mockResolvedValue(new Response("", { status: 404 }));
    const result = await fetchOfficialBuildings(48.137, 11.575);
    expect(result).toEqual({ buildings: [], state: null, truncated: false });
    expect(
      mocks.fetch.mock.calls.every((call) =>
        String(call[0]).includes("bayernwolke.de/a/lod2/citygml/"),
      ),
    ).toBe(true);
  });

  it("asks nothing outside every covered state and Bayern (Amsterdam)", async () => {
    const result = await fetchOfficialBuildings(52.37, 4.9);
    expect(result).toEqual({ buildings: [], state: null, truncated: false });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
