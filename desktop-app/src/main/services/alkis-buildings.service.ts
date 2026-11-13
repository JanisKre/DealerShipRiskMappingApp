import { cacheGet, cacheSet, TTL } from "./cache.service";
import { fetchWithResilience } from "./http.service";
import type { LonLat } from "./boundary-geometry";
import { createCircuitBreaker } from "./boundary/circuit-breaker";
import { parseExteriorRings, statesForPoint, toUtm32 } from "./alkis.service";
import {
  bavariaLod2Buildings,
  isInBavariaBox,
  LOD2_ATTRIBUTION,
} from "./bavaria-lod2.service";

/**
 * Official building footprints (ALKIS) from the open WFS of the German
 * states, for the roof mask (detection/roof-mask.ts). OpenStreetMap misses
 * buildings, above all on industrial estates where dealerships sit; the
 * cadastre records every one.
 *
 * Endpoints verified live in November 2026 with a 150 m BBOX request over a
 * city centre (docs/official-buildings.md). Four schemas occur:
 * - `ave:GebaeudeBauwerk` (ALKIS simplified: NRW, Thüringen, RLP) with the
 *   function as text (`funktion`) and code (`gfkzshh`, "31001_2461"),
 * - `adv:AX_Gebaeude` (full ALKIS: Niedersachsen, Bremen, Hessen) with the function
 *   code (`gebaeudefunktion`),
 * - Berlin's `alkis_gebaeude:gebaeude` with `gfk`/`bezgfk` and `ofl`,
 * - INSPIRE `bu-core2d:Building` (the rest), which carries only a coarse
 *   `currentUse` and cannot tell a car park from an office.
 *
 * Bayern publishes no open building WFS; its footprints come from the open
 * LoD2 model, read by 2 km tile (bavaria-lod2.service.ts).
 *
 * Not covered: Hamburg (its INSPIRE WFS fails every BBOX request with a
 * mixed-SRID server error) and Saarland (no open building WFS found). There
 * the mask uses OSM alone, as before.
 */

const USER_AGENT = "DealershipRiskMapping-Desktop/0.1 (contact: internal)";

interface BuildingEndpoint {
  url: string;
  typeName: string;
  /** EPSG code of the response geometry (lat,lon axis order). */
  crs: 4258 | 4326;
  /** The service only filters on a UTM 32N box (Thüringen). */
  bboxUtm32?: true;
}

const BUILDING_ENDPOINTS: Record<string, BuildingEndpoint> = {
  NRW: {
    url: "https://www.wfs.nrw.de/geobasis/wfs_nw_alkis_vereinfacht",
    typeName: "ave:GebaeudeBauwerk",
    crs: 4326,
  },
  Thüringen: {
    url: "https://www.geoproxy.geoportal-th.de/geoproxy/services/adv_alkis_wfs",
    typeName: "ave:GebaeudeBauwerk",
    crs: 4326,
    bboxUtm32: true,
  },
  "Rheinland-Pfalz": {
    url: "https://geo5.service24.rlp.de/wfs/alkis_rp.fcgi",
    typeName: "ave:GebaeudeBauwerk",
    crs: 4326,
  },
  // The full-ALKIS service carries the function code; the INSPIRE one does
  // not and took 20 s per request in the probe.
  Niedersachsen: {
    url: "https://opendata.lgln.niedersachsen.de/doorman/noauth/alkis_wfs_sf",
    typeName: "adv:AX_Gebaeude",
    crs: 4258,
  },
  // Hessen's full-ALKIS NAS service (open, no conditions).
  Hessen: {
    url: "https://www.gds.hessen.de/wfs2/aaa-suite/cgi-bin/alkis/nas/wfs",
    typeName: "adv:AX_Gebaeude",
    crs: 4258,
  },
  Bremen: {
    url: "https://opendata.lgln.niedersachsen.de/doorman/noauth/alkishb_wfs_sf",
    typeName: "adv:AX_Gebaeude",
    crs: 4258,
  },
  Berlin: {
    url: "https://gdi.berlin.de/services/wfs/alkis_gebaeude",
    typeName: "alkis_gebaeude:gebaeude",
    crs: 4326,
  },
  Sachsen: {
    url: "https://geodienste.sachsen.de/aaa/public_inspire/alkis/bu-core2d/dls/wfs",
    typeName: "bu-core2d:Building",
    crs: 4258,
  },
  "Mecklenburg-Vorpommern": {
    url: "https://www.geodaten-mv.de/dienste/inspire_bu_core2d_alkis_download",
    typeName: "bu-core2d:Building",
    crs: 4258,
  },
  "Schleswig-Holstein": {
    url: "https://service.gdi-sh.de/SH_INSPIREDOWNLOAD_AIII_BU",
    typeName: "bu-core2d:Building",
    crs: 4258,
  },
  "Sachsen-Anhalt": {
    url: "https://geodatenportal.sachsen-anhalt.de/ows_INSPIRE_LVermGeo_ALKIS_BU_WFS",
    typeName: "bu-core2d:Building",
    crs: 4258,
  },
  Brandenburg: {
    url: "https://inspire.brandenburg.de/services/bu_alkis_wfs",
    typeName: "bu-core2d:Building",
    crs: 4258,
  },
  "Baden-Württemberg": {
    url: "https://owsproxy.lgl-bw.de/owsproxy/wfs/WFS_INSP_BW_Gebaeude_ALKIS",
    typeName: "bu-core2d:Building",
    crs: 4258,
  },
};

/**
 * Covers the 250 m context image (125 m to each side, corners at ~177 m) the
 * detector runs on, with a small margin.
 */
export const BUILDING_SEARCH_RADIUS_M = 190;

/** Features per request; a dense city block within the radius stays below. */
const BUILDING_REQUEST_LIMIT = 1000;

/**
 * Per request. The analysis itself only waits until its OSM deadline; a
 * slower answer (Schleswig-Holstein took 14–20 s in the probe) still lands
 * in the cache for the next analysis of the site.
 */
const BUILDING_TIMEOUT_MS = 45_000;

export interface OfficialBuilding {
  ring: LonLat[];
  /**
   * The cadastre records a car park (Parkhaus, Parkdeck, Gebäude zum Parken)
   * or an underground garage (Tiefgarage), whose roof or covering ground
   * legitimately carries parked vehicles.
   */
  parkingRoof: boolean;
  /** The schema records the building function (false for INSPIRE). */
  functionKnown: boolean;
}

export interface OfficialBuildingLookup {
  buildings: OfficialBuilding[];
  /** Cadastre the footprints came from (`null` when none answered). */
  state: string | null;
  /** More buildings in range than the service returned. */
  truncated: boolean;
}

const EMPTY: OfficialBuildingLookup = {
  buildings: [],
  state: null,
  truncated: false,
};

/**
 * ALKIS building function codes (Gebäudefunktion) of structures that carry
 * parked vehicles on their roof or above them: 2460 Gebäude zum Parken,
 * 2461 Parkhaus, 2462 Parkdeck, 2465 Tiefgarage. Plain garages (2463) and
 * vehicle halls (2464) keep their cars inside, so their roofs are masked.
 */
const PARKING_FUNCTION_CODES = new Set(["2460", "2461", "2462", "2465"]);

const PARKING_FUNCTION_TEXT = /parkhaus|parkdeck|tiefgarage|zum parken/i;

/** ALKIS "Lage zur Erdoberfläche": 1200 = unter der Erdoberfläche. */
const UNDERGROUND_CODE = "1200";

function tagValues(xml: string, names: string): string[] {
  const re = new RegExp(`<(?:[\\w.-]+:)?(?:${names})\\b[^>]*>([^<]*)<`, "gi");
  return [...xml.matchAll(re)].map((m) => m[1].trim()).filter(Boolean);
}

/** Reads one feature's function attributes, whichever schema it uses. */
export function classifyBuilding(featureXml: string): {
  parkingRoof: boolean;
  underground: boolean;
  functionKnown: boolean;
} {
  const codes = tagValues(featureXml, "gebaeudefunktion|gfkzshh|gfk").map(
    (v) => v.split("_").pop() ?? v,
  );
  const texts = tagValues(featureXml, "funktion|bezgfk");
  const position = tagValues(
    featureXml,
    "lageZurErdoberflaeche|ofl|bezofl|rellage",
  );
  return {
    parkingRoof:
      codes.some((c) => PARKING_FUNCTION_CODES.has(c)) ||
      texts.some((t) => PARKING_FUNCTION_TEXT.test(t)),
    underground: position.some(
      (v) => v === UNDERGROUND_CODE || /unter der erdoberfl/i.test(v),
    ),
    functionKnown: codes.length > 0 || texts.length > 0,
  };
}

/** Splits a WFS 2.0 response into features and reads ring and function. */
export function parseOfficialBuildings(xml: string): OfficialBuilding[] {
  const buildings: OfficialBuilding[] = [];
  for (const member of xml.matchAll(
    /<wfs:member\b[^>]*>([\s\S]*?)<\/wfs:member>/g,
  )) {
    const { parkingRoof, underground, functionKnown } = classifyBuilding(
      member[1],
    );
    // An underground structure has no roof in the image.
    if (underground) continue;
    for (const ring of parseExteriorRings(member[1])) {
      if (ring.length >= 4)
        buildings.push({ ring, parkingRoof, functionKnown });
    }
  }
  return buildings;
}

const breaker = createCircuitBreaker();

/** Test seam: clears breaker state between cases. */
export function resetBuildingCircuits(): void {
  breaker.reset();
}

function requestUrl(
  endpoint: BuildingEndpoint,
  lat: number,
  lon: number,
  radiusM: number,
): string {
  const crsUrn = `urn:ogc:def:crs:EPSG::${endpoint.crs}`;
  let bbox: string;
  if (endpoint.bboxUtm32) {
    const [east, north] = toUtm32(lat, lon);
    bbox = `${east - radiusM},${north - radiusM},${east + radiusM},${north + radiusM},urn:ogc:def:crs:EPSG::25832`;
  } else {
    const dLat = radiusM / 111_320;
    const dLon = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
    bbox = `${lat - dLat},${lon - dLon},${lat + dLat},${lon + dLon},${crsUrn}`;
  }
  return (
    `${endpoint.url}?service=WFS&version=2.0.0&request=GetFeature` +
    `&typeNames=${encodeURIComponent(endpoint.typeName)}&count=${BUILDING_REQUEST_LIMIT}` +
    `&srsName=${crsUrn}&bbox=${encodeURIComponent(bbox)}`
  );
}

const inFlight = new Map<string, Promise<OfficialBuildingLookup>>();

/**
 * Official building footprints around a point. Never throws: an unreachable
 * or slow service yields no buildings, and the roof mask falls back to OSM.
 * Concurrent calls for the same point share one request, so the analysis can
 * start it early and the roof mask joins it later.
 */
export function fetchOfficialBuildings(
  lat: number,
  lon: number,
  radiusM: number = BUILDING_SEARCH_RADIUS_M,
): Promise<OfficialBuildingLookup> {
  const key = `${radiusM}:${lat.toFixed(5)},${lon.toFixed(5)}`;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const request = lookup(lat, lon, radiusM)
    .catch(() => EMPTY)
    .finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

async function lookup(
  lat: number,
  lon: number,
  radiusM: number,
): Promise<OfficialBuildingLookup> {
  for (const state of statesForPoint(lat, lon)) {
    const endpoint = BUILDING_ENDPOINTS[state];
    if (!endpoint || breaker.isOpen(state)) continue;

    const key = `alkis-buildings:v1:${state}:${radiusM}:${lat.toFixed(4)},${lon.toFixed(4)}`;
    const hit = cacheGet<OfficialBuildingLookup>(key);
    if (hit) {
      if (hit.buildings.length > 0) return hit;
      continue;
    }

    let xml: string;
    try {
      const res = await fetchWithResilience(
        requestUrl(endpoint, lat, lon, radiusM),
        { headers: { "User-Agent": USER_AGENT } },
        { timeoutMs: BUILDING_TIMEOUT_MS, retries: 0 },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      xml = await res.text();
      if (xml.includes("ExceptionReport")) throw new Error("WFS exception");
    } catch {
      // A failed request says nothing about the location: not cached.
      breaker.recordFailure(state);
      continue;
    }
    breaker.recordSuccess(state);

    const buildings = parseOfficialBuildings(xml);
    const matched = xml.match(/numberMatched="(\d+)"/)?.[1];
    const returned = (xml.match(/<wfs:member\b/g) ?? []).length;
    const result: OfficialBuildingLookup = {
      buildings,
      state,
      truncated:
        matched != null
          ? Number(matched) > returned
          : returned >= BUILDING_REQUEST_LIMIT,
    };
    cacheSet(key, result, TTL.cadastre);
    // Bounding boxes of neighbouring states overlap; an empty answer may
    // just mean the point lies in the next state.
    if (buildings.length > 0) return result;
  }
  // Bayern has no open building WFS; its open LoD2 model is read by tile.
  if (isInBavariaBox(lat, lon)) {
    const buildings = await bavariaLod2Buildings(lat, lon, radiusM);
    if (buildings && buildings.length > 0) {
      return { buildings, state: BAVARIA_LOD2_STATE, truncated: false };
    }
  }
  return EMPTY;
}

/** Source name in provenance lines; carries the required attribution. */
export const BAVARIA_LOD2_STATE = `Bayern (${LOD2_ATTRIBUTION})`;
