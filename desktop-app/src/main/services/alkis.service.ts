import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import { point as turfPoint } from "@turf/helpers";
import type { SourceStatus } from "@shared/types";
import { cacheGet, cacheSet, TTL } from "./cache.service";
import { fetchWithResilience } from "./http.service";
import { checkRing, type LonLat } from "./boundary-geometry";
import { createCircuitBreaker } from "./boundary/circuit-breaker";
import { fromUtm, toUtm } from "./utm";
import { withBwAttributes } from "./bw-parcel-attributes";

/**
 * ALKIS cadastral parcels (official lot boundaries) via the open
 * WFS services of the German federal states.
 *
 * ENDPOINT AND FILTER FINDINGS (verified live, 14 Sep 2026)
 * --------------------------------------------------------
 * Two things were tested and did NOT work; both are recorded here so nobody
 * spends the afternoon rediscovering them.
 *
 * 1. A predecessor project carried a table of direct state ALKIS WFS endpoints
 *    covering all 16 states (`adv:AX_Flurstueck` and friends). Probed live,
 *    16 of 16 failed: HTTP 404 for Berlin, Hamburg, Bremen, Bayern, BW,
 *    Niedersachsen, Brandenburg, MV, Sachsen-Anhalt and RLP; 400 for NRW and
 *    Saarland; 403 for Sachsen; a service exception for Hessen; a dead
 *    connection for SH; and Thüringen answered but returned no geometry. The
 *    seven INSPIRE endpoints below were re-verified through the same harness
 *    and all returned parcels, so the harness was sound and that table is
 *    simply stale.
 *
 * 2. `CQL_FILTER=INTERSECTS(geom, POINT(...))` is **silently ignored** by these
 *    services. A point in the North Sea returns the same features as an
 *    unfiltered request. The filter appears to work — it answers 200 with
 *    plausible data — which makes it worse than an outright rejection. BBOX is
 *    the only spatial filter these endpoints honour, so "which parcel contains
 *    this point" is decided client-side, in `pickRingForPoint`.
 *
 * The state is determined **offline** via bounding box from the coordinate
 * (no reverse-geocoding call needed anymore, no single point of failure).
 *
 * Most states now provide the INSPIRE-harmonized feature type
 * `cp:CadastralParcel` (one unified schema instead of 16 ALKIS dialects).
 * NRW still uses `ave:Flurstueck` (ALKIS simplified) — the only
 * originally configured service, left unchanged.
 *
 * IMPORTANT — only live-verified endpoints are listed here. Of the
 * 16 German federal states, these 9 now confirmed return parcel
 * geometries for unauthenticated requests (NRW, Sachsen, Niedersachsen,
 * Schleswig-Holstein, Sachsen-Anhalt, Brandenburg, Berlin — Sept. 2026; Hessen
 * and Baden-Württemberg added 14 Sep 2026, see below). The remaining 7 have
 * open INSPIRE metadata but were still unreachable, dead, or
 * access-restricted the last time each was tried (Hamburg, Saarland, Bremen —
 * the `numberReturned` and non-geographic-CRS caveats below apply to any
 * future retest of these too; Thuringia, Mecklenburg-Western Pomerania,
 * Rhineland-Palatinate dead; Bavaria paid/access-restricted, Art. 13 INSPIRE
 * Directive). For these states, the chain automatically falls back to
 * OSM/Overture or the synthetic circle — not an error case, just no official
 * source (yet). Per the plan's own instruction not to carry forward a stale
 * negative finding unquestioned (docs/boundary-improvement-plan.de.md P8),
 * these are due for the same live retest that found Hessen and
 * Baden-Württemberg, not a permanent verdict.
 *
 * 4. Baden-Württemberg (added 14 Sep 2026, live-verified against Stuttgart and
 *    Freiburg, BBOX spatial filtering confirmed honoured): its default
 *    response CRS is a **projected** EPSG:25832 (UTM zone 32N) — plain metres,
 *    not the lat/lon this module parses. Rather than add UTM↔lat/lon
 *    projection math here, the request explicitly asks for the EPSG:4258
 *    (ETRS89 geographic) alternate its capabilities document also advertises,
 *    which the service honours and which needs no new parsing at all. Any
 *    other state whose `DefaultCRS` turns out to be projected is worth the
 *    same check before assuming it needs new code.
 *
 * 3. Hessen (added 14 Sep 2026, live-verified against Frankfurt and Kassel,
 *    BBOX spatial filtering confirmed honoured): its `numberReturned="0"` on
 *    every response is **not** an absence of data — the service's own inline
 *    XML comment documents it as a placeholder forced by a WFS 2.0 schema
 *    validation constraint (the real value would be "unknown", like
 *    `numberMatched`, but that fails schema validation). The actual features
 *    ride in `<wfs:member>` regardless. Its geometry is also encoded as
 *    `gml:Surface`/`gml:PolygonPatch`, not a bare `gml:Polygon` — a
 *    perfectly valid alternative GML3.2 surface encoding that the original
 *    16-state table's parser (and, it turns out, no code in this file until
 *    now) ever looked for, which is the more likely reason Hessen was
 *    recorded as returning nothing in the first place. Both gaps — reading
 *    `numberReturned` as an absence signal, and matching only bare
 *    `gml:Polygon` — are worth checking again on any state still marked
 *    unavailable above.
 */

const USER_AGENT = "DealershipRiskMapping-Desktop/0.1 (contact: internal)";

export interface AlkisEndpoint {
  url: string;
  typeName: string;
  /** EPSG code for BBOX filter and response geometry (states require different CRS). */
  crs: number;
  /**
   * Some services (Thüringen) ignore a geographic BBOX and only filter on
   * their native UTM zone 32 grid; the response still comes in `crs`.
   */
  bboxUtm32?: true;
  /**
   * The service answers in UTM only (EPSG:25832 or 25833): the search box is
   * sent and the geometry returned in that zone, then converted to
   * geographic coordinates. `crs` is ignored.
   */
  utmZone?: 32 | 33;
  /**
   * Parcels are only served through this stored bbox query (parameters
   * CRS, x1, y1, x2, y2; requires `utmZone`). Its answer holds every layer,
   * so only `featureElement` members are read.
   */
  storedQuery?: string;
  /** Element name of a parcel member, where the answer holds other layers. */
  featureElement?: string;
  /**
   * Queried when this endpoint fails. The simplified ALKIS services
   * (`ave:Flurstueck`) carry each parcel's address and land use; the INSPIRE
   * service they replaced stays as the fallback, with geometry only.
   */
  fallback?: AlkisEndpoint;
}

/**
 * Since November 2026 the simplified ALKIS product of the AdV
 * (`ave:Flurstueck`) is preferred wherever a state serves it in geographic
 * coordinates: besides the geometry it carries the parcel's address
 * (`lagebeztxt`) and its actual land use (`tntxt`), which the boundary
 * cascade uses (docs/boundary-model.md, "Cascade v9"). Probed live on
 * 13 November 2026: address and land use in NRW, Rheinland-Pfalz, Thüringen,
 * Sachsen, Niedersachsen, Sachsen-Anhalt and Hamburg; address only in Hessen
 * and Brandenburg. Since cascade v10 (14 November 2026): Mecklenburg-
 * Vorpommern (land use too) and Schleswig-Holstein (address only) in UTM
 * (`utmZone`), Baden-Württemberg from separate layers
 * (bw-parcel-attributes.ts). Berlin and Bremen publish neither field.
 */
const ALKIS_ENDPOINTS: Record<string, AlkisEndpoint> = {
  NRW: {
    url: "https://www.wfs.nrw.de/geobasis/wfs_nw_alkis_vereinfacht",
    typeName: "ave:Flurstueck",
    crs: 4326,
  },
  Sachsen: {
    url: "https://geodienste.sachsen.de/aaa/public_alkis/vereinf/wfs",
    typeName: "ave:Flurstueck",
    crs: 4258,
    fallback: {
      url: "https://geodienste.sachsen.de/aaa/public_inspire/alkis/cp/dls/wfs",
      typeName: "cp:CadastralParcel",
      crs: 4258,
    },
  },
  Niedersachsen: {
    url: "https://opendata.lgln.niedersachsen.de/doorman/noauth/alkis_wfs_einfach",
    typeName: "ave:Flurstueck",
    crs: 4258,
    fallback: {
      url: "https://www.inspire.niedersachsen.de/doorman/noauth/alkis-dls-cp",
      typeName: "cp:CadastralParcel",
      crs: 4258,
    },
  },
  // The simplified product in SH rejects plain GetFeature on
  // ave:Flurstueck; its bbox stored query works, in EPSG:25832 only, and
  // returns addresses without land use (probed 14 November 2026).
  "Schleswig-Holstein": {
    url: "https://service.gdi-sh.de/WFS_SH_ALKIS_vereinf_OpenGBD",
    typeName: "ave:Flurstueck",
    crs: 25832,
    utmZone: 32,
    storedQuery:
      "http://repository.gdi-de.org/query/adv/produkt/alkis-vereinfacht/2.0/ave-by-bbox",
    featureElement: "Flurstueck",
    fallback: {
      url: "https://service.gdi-sh.de/SH_INSPIREDOWNLOAD_AI_CP_ALKIS",
      typeName: "cp:CadastralParcel",
      crs: 4258,
    },
  },
  "Sachsen-Anhalt": {
    url: "https://www.geodatenportal.sachsen-anhalt.de/wss/service/ST_LVermGeo_ALKIS_WFS_OpenData/guest",
    typeName: "ave:Flurstueck",
    crs: 4258,
    fallback: {
      url: "https://geodatenportal.sachsen-anhalt.de/ows_INSPIRE_LVermGeo_ALKIS_CP_WFS",
      typeName: "cp:CadastralParcel",
      crs: 4258,
    },
  },
  Brandenburg: {
    url: "https://isk.geobasis-bb.de/ows/alkis_vereinf_wfs",
    typeName: "ave:Flurstueck",
    crs: 4258,
    fallback: {
      url: "https://inspire.brandenburg.de/services/cp_alkis_wfs",
      typeName: "cp:CadastralParcel",
      crs: 4258,
    },
  },
  Berlin: {
    url: "https://gdi.berlin.de/services/wfs/alkis_flurstuecke",
    typeName: "alkis_flurstuecke:flurstuecke",
    crs: 4326,
  },
  Hessen: {
    url: "https://www.gds.hessen.de/wfs2/aaa-suite/cgi-bin/alkis/vereinf/wfs",
    typeName: "ave:Flurstueck",
    crs: 4258,
    fallback: {
      url: "https://inspire-hessen.de/ows/services/org.2.07247d95-adc7-4c7d-9c7a-ed17af855317_wfs",
      typeName: "cp:CadastralParcel",
      crs: 4258,
    },
  },
  // Its default response CRS is a projected EPSG:25832 (UTM 32N), which this
  // module does not transform — but EPSG:4258 is offered as an alternate and
  // the service honours `srsName`, so requesting that directly needs no
  // projection math here at all.
  "Baden-Württemberg": {
    url: "https://owsproxy.lgl-bw.de/owsproxy/wfs/WFS_INSP_BW_Flst_ALKIS",
    typeName: "cp:CadastralParcel",
    crs: 4258,
  },
  // Saarland moved its INSPIRE parcel service; under the new name it
  // answers with parcels (geometry only, numberReturned="0" like Hessen).
  // Probed 14 November 2026.
  Saarland: {
    url: "https://geoportal.saarland.de/gdi-sl/inspirewfs_Flurstuecke_Grundstuecke_ALKIS",
    typeName: "cp:CadastralParcel",
    crs: 4258,
  },
  // Added November 2026 after probing GetCapabilities and a live GetFeature
  // (docs/boundary-model.md, "Cadastre coverage"). Bayern (login required)
  // is read from the parcel map instead (bavaria-parcels.service.ts).
  Hamburg: {
    url: "https://geodienste.hamburg.de/WFS_HH_ALKIS_vereinfacht",
    typeName: "ave:Flurstueck",
    crs: 4258,
    fallback: {
      url: "https://geodienste.hamburg.de/HH_WFS_INSPIRE_Flurstuecke",
      typeName: "cp:CadastralParcel",
      crs: 4258,
    },
  },
  Bremen: {
    url: "https://opendata.lgln.niedersachsen.de/doorman/noauth/alkishb_wfs_sf",
    typeName: "adv:AX_Flurstueck",
    crs: 4258,
  },
  // EPSG:25833 only; address and land use (probed 14 November 2026).
  "Mecklenburg-Vorpommern": {
    url: "https://www.geodaten-mv.de/dienste/alkis_wfs_einfach",
    typeName: "ave:Flurstueck",
    crs: 25833,
    utmZone: 33,
    fallback: {
      url: "https://www.geodaten-mv.de/dienste/inspire_cp_alkis_download",
      typeName: "cp:CadastralParcel",
      crs: 4258,
    },
  },
  Thüringen: {
    url: "https://www.geoproxy.geoportal-th.de/geoproxy/services/adv_alkis_wfs",
    typeName: "ave:Flurstueck",
    crs: 4326,
    bboxUtm32: true,
  },
  "Rheinland-Pfalz": {
    url: "https://geo5.service24.rlp.de/wfs/alkis_rp.fcgi",
    typeName: "ave:Flurstueck",
    crs: 4326,
  },
};

/** Rough state bounding boxes — only for the 7 states listed above, smallest (city-states) first. */
interface StateBbox {
  state: string;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

const STATE_BBOXES: StateBbox[] = [
  // City-states first: their boxes lie inside their neighbours' boxes.
  {
    state: "Hamburg",
    minLat: 53.39,
    maxLat: 53.75,
    minLon: 9.73,
    maxLon: 10.33,
  },
  // Bremen city and Bremerhaven.
  { state: "Bremen", minLat: 53.01, maxLat: 53.23, minLon: 8.48, maxLon: 8.99 },
  { state: "Bremen", minLat: 53.46, maxLat: 53.61, minLon: 8.48, maxLon: 8.65 },
  {
    state: "Berlin",
    minLat: 52.33,
    maxLat: 52.68,
    minLon: 13.09,
    maxLon: 13.76,
  },
  {
    state: "Brandenburg",
    minLat: 51.36,
    maxLat: 53.56,
    minLon: 11.27,
    maxLon: 14.77,
  },
  {
    state: "Sachsen-Anhalt",
    minLat: 50.94,
    maxLat: 53.06,
    minLon: 10.56,
    maxLon: 13.19,
  },
  {
    state: "Sachsen",
    minLat: 50.17,
    maxLat: 51.68,
    minLon: 11.87,
    maxLon: 15.04,
  },
  {
    state: "Schleswig-Holstein",
    minLat: 53.36,
    maxLat: 55.06,
    minLon: 7.86,
    maxLon: 11.32,
  },
  {
    state: "Niedersachsen",
    minLat: 51.29,
    maxLat: 53.89,
    minLon: 6.65,
    maxLon: 11.6,
  },
  { state: "NRW", minLat: 50.32, maxLat: 52.53, minLon: 5.87, maxLon: 9.46 },
  {
    state: "Hessen",
    minLat: 49.39,
    maxLat: 51.66,
    minLon: 7.77,
    maxLon: 10.24,
  },
  {
    state: "Baden-Württemberg",
    minLat: 47.53,
    maxLat: 49.79,
    minLon: 7.51,
    maxLon: 10.5,
  },
  {
    state: "Mecklenburg-Vorpommern",
    minLat: 53.11,
    maxLat: 54.69,
    minLon: 10.59,
    maxLon: 14.41,
  },
  {
    state: "Thüringen",
    minLat: 50.2,
    maxLat: 51.65,
    minLon: 9.87,
    maxLon: 12.65,
  },
  // Inside the Rheinland-Pfalz box, so before it.
  {
    state: "Saarland",
    minLat: 49.11,
    maxLat: 49.64,
    minLon: 6.35,
    maxLon: 7.41,
  },
  {
    state: "Rheinland-Pfalz",
    minLat: 48.97,
    maxLat: 50.94,
    minLon: 6.11,
    maxLon: 8.51,
  },
];

/** Candidate states for a coordinate, smallest (enclaves) first — bboxes deliberately overlap. */
export function statesForPoint(lat: number, lon: number): string[] {
  return STATE_BBOXES.filter(
    (b) =>
      lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon,
  ).map((b) => b.state);
}

// --- Circuit breaker (in-memory, per state) --------------------------
// Prevents a permanently unreachable state service from delaying every
// analysis. A valid empty result (service reachable, no parcel at this
// location) does NOT count as a failure — see boundary/circuit-breaker.ts.

const breaker = createCircuitBreaker();

/** Test seam: clears breaker state between cases. */
export function resetAlkisCircuits(): void {
  breaker.reset();
}

/**
 * Default search radius around the point.
 *
 * Was 60 m, which returns the containing parcel and little else. A dealership
 * routinely occupies several adjacent parcels, so the boundary engine needs
 * the neighbourhood, not just the hit.
 */
export const PARCEL_SEARCH_RADIUS_M = 250;

/** Upper bound on features requested per call (one page). */
const PARCEL_REQUEST_LIMIT = 250;

/**
 * Pages fetched per query at most: 4 × 250 = 1,000 parcels. A 250 m search
 * box in a dense town holds more than one page; a capped answer misses
 * arbitrary parcels, often the one at the point (docs/boundary-model.md,
 * "Complete cadastre").
 */
export const PARCEL_MAX_PAGES = 4;

/**
 * Radius of the second, smaller query when the first one stays capped. Some
 * services ignore `startIndex` (Niedersachsen answers every page with the
 * first), so paging alone cannot complete them.
 */
export const PARCEL_FALLBACK_RADIUS_M = 100;

/**
 * Land-use classes the cascade tells apart, reduced from the ALKIS
 * "Tatsächliche Nutzung" catalogue:
 *
 * - `traffic`: road, path, rail, air and ship traffic
 * - `commercial`: industry and trade (where a dealership is registered)
 * - `mixed`: mixed use (a business with flats above, a village core)
 * - `residential`: housing
 * - `open`: farmland, woodland, water, parks, sports grounds, cemeteries
 * - `other`: everything else (squares, public buildings, dumps, unknown)
 */
export type ParcelUse =
  "traffic" | "commercial" | "mixed" | "residential" | "open" | "other";

/** Share of a parcel's area per land-use class; the shares sum to 1. */
export type ParcelLandUse = Partial<Record<ParcelUse, number>>;

export interface ParcelFeature {
  ring: LonLat[];
  areaSqm: number;
  state: string;
  /**
   * Address text of the cadastre ("Schmiedstraße 12"; a street name alone
   * for plots without a house number), where the service publishes it.
   */
  address?: string;
  /** Actual land use by share of area, where the service publishes it. */
  landUse?: ParcelLandUse;
}

/** What a service says about a parcel besides its geometry. */
export interface ParcelAttributes {
  address?: string;
  landUse?: ParcelLandUse;
}

const USE_KEYWORDS: Array<[ParcelUse, RegExp]> = [
  // "Begleitfläche Straßenverkehr" (RLP) is the verge of a road.
  ["traffic", /strassenverkehr|^weg$|bahnverkehr|flugverkehr|schiffsverkehr/],
  ["mixed", /gemischte/],
  ["residential", /wohn/],
  // Rheinland-Pfalz names the function itself ("Handel", "Handwerk").
  [
    "commercial",
    /industrie|gewerbe|handel|handwerk|dienstleistung|lager|werkstatt|tankstelle/,
  ],
  [
    "open",
    /landwirtschaft|acker|gruenland|garten|reb|obst|wald|gehoelz|heide|moor|sumpf|unland|vegetationslos|gewaesser|hafenbecken|friedhof|gruenanlage|sport|erholung|brachland|forst/,
  ],
];

/** Lower case, umlauts spelled out (Thüringen writes "Strassenverkehr"). */
function normaliseUse(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .trim();
}

/** The cascade's class of one ALKIS land-use name. */
export function classifyLandUse(name: string): ParcelUse {
  // "Industrie- und Gewerbefläche(funktion:Handel und Dienstleistung)" and
  // "Fliessgewaesser/Kanal": the class is in the leading name.
  const base = normaliseUse(name.split("(")[0].split("/")[0]);
  for (const [use, pattern] of USE_KEYWORDS) {
    if (pattern.test(base)) return use;
  }
  return "other";
}

/**
 * Parses `tntxt` of the simplified ALKIS schema: sections separated by "|",
 * each "name;area in m²" ("Straßenverkehr;249|Weg;115"). Returns shares of
 * the summed area, or undefined when nothing is readable.
 */
export function parseLandUse(tntxt: string): ParcelLandUse | undefined {
  const areas = new Map<ParcelUse, number>();
  let total = 0;
  for (const section of tntxt.split("|")) {
    const cut = section.lastIndexOf(";");
    if (cut < 0) continue;
    const area = Number.parseFloat(section.slice(cut + 1).replace(",", "."));
    if (!Number.isFinite(area) || area <= 0) continue;
    const use = classifyLandUse(section.slice(0, cut));
    areas.set(use, (areas.get(use) ?? 0) + area);
    total += area;
  }
  if (total <= 0) return undefined;
  const shares: ParcelLandUse = {};
  for (const [use, area] of areas) shares[use] = area / total;
  return shares;
}

function decodeXmlText(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

const MEMBER_RE =
  /<(?:[\w.-]+:)?(?:member|featureMember)>([\s\S]*?)<\/(?:[\w.-]+:)?(?:member|featureMember)>/g;

function xmlField(body: string, name: string): string | undefined {
  const hit = body.match(
    new RegExp(`<(?:[\\w.-]+:)?${name}>([^<]*)</(?:[\\w.-]+:)?${name}>`),
  );
  const text = hit ? decodeXmlText(hit[1]) : "";
  return text.length > 0 ? text : undefined;
}

/**
 * Exterior rings with the attributes of the feature they belong to. A
 * feature with several polygons yields several rings with the same
 * attributes. Responses without `member` elements fall back to the rings
 * alone.
 */
export function parseParcelFeatures(
  xml: string,
): Array<{ ring: [number, number][] } & ParcelAttributes> {
  const members = [...xml.matchAll(MEMBER_RE)];
  if (members.length === 0) {
    return parseExteriorRings(xml).map((ring) => ({ ring }));
  }
  const features: Array<{ ring: [number, number][] } & ParcelAttributes> = [];
  for (const member of members) {
    const body = member[1];
    const lage = xmlField(body, "lagebeztxt");
    // Sachsen writes "ohne Lage" for plots without an address.
    const address = lage && !/^ohne lage$/i.test(lage) ? lage : undefined;
    const tntxt = xmlField(body, "tntxt");
    const landUse = tntxt ? parseLandUse(tntxt) : undefined;
    for (const ring of parseExteriorRings(body)) {
      features.push({
        ring,
        ...(address ? { address } : {}),
        ...(landUse ? { landUse } : {}),
      });
    }
  }
  return features;
}

export interface ParcelLookup {
  parcels: ParcelFeature[];
  state: string | null;
  /**
   * True when the service had more parcels than it returned. A truncated set
   * must not be used to assemble a multi-parcel site: the missing parcels are
   * arbitrary, so the union would be arbitrary too.
   */
  truncated: boolean;
  /**
   * Radius around the point within which the parcel set is complete: the
   * search radius when nothing was capped, the fallback radius when only the
   * smaller query fit, 0 when even that was capped.
   */
  completeRadiusM?: number;
  /** True when at least one state service answered, even if it had no parcels. */
  reachable: boolean;
  /**
   * True when the geocoded point falls inside one of the returned parcels.
   * False means the nearest parcel was taken instead, which is a weaker claim.
   */
  containsAnchor: boolean;
  /**
   * Distinguishes "no service covers this location", "asked, but the service
   * failed", "asked and got an empty answer" and "asked and got a capped
   * answer" — `reachable` alone collapses all but the first into one boolean.
   */
  status: SourceStatus;
}

/**
 * Reads the WFS response envelope's feature counts.
 *
 * `numberMatched` may legitimately be "unknown" — several state services do
 * not count before streaming — in which case a full page is the only signal
 * that there may be more.
 */
export function parseWfsCounts(xml: string): {
  matched: number | null;
  returned: number | null;
} {
  const matchedRaw = xml.match(/numberMatched="([^"]+)"/)?.[1];
  const returnedRaw = xml.match(/numberReturned="([^"]+)"/)?.[1];
  const toNumber = (value?: string): number | null => {
    if (value == null) return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  };
  return { matched: toNumber(matchedRaw), returned: toNumber(returnedRaw) };
}

export function isTruncated(xml: string, limit: number): boolean {
  const { matched, returned } = parseWfsCounts(xml);
  if (matched != null && returned != null) return matched > returned;
  if (returned != null) return returned >= limit;
  return false;
}

/** All cadastral parcels near a point, for multi-parcel site assembly. */
export async function fetchParcelsNear(
  lat: number,
  lon: number,
  radiusM: number = PARCEL_SEARCH_RADIUS_M,
): Promise<ParcelLookup> {
  const candidateStates = statesForPoint(lat, lon);
  if (candidateStates.length === 0) {
    return {
      parcels: [],
      state: null,
      truncated: false,
      reachable: false,
      containsAnchor: false,
      status: "unsupportedHere",
    };
  }

  let answeredAtLeastOnce = false;
  for (const state of candidateStates) {
    const endpoint = ALKIS_ENDPOINTS[state];
    if (!endpoint || breaker.isOpen(state)) continue;

    // Four decimals (~11 m) on purpose: neighbouring locations in the same
    // business park then share one cached cadastre response.
    const key = `alkis:v5:${state}:${radiusM}:${lat.toFixed(4)},${lon.toFixed(4)}`;
    const hit = cacheGet<ParcelLookup>(key);
    if (hit) {
      answeredAtLeastOnce = true;
      if (hit.parcels.length > 0) {
        // The cache key rounds to ~11 m, so a real anchor up to that far from
        // the one that populated this entry can sit on the other side of a
        // parcel line. The parcel geometry is safe to reuse; whether *this*
        // point falls inside it is not.
        return {
          ...hit,
          containsAnchor: parcelContainsPoint(hit.parcels, lat, lon),
        };
      }
      continue;
    }

    let source = endpoint;
    let fetched = await fetchParcelRings(source, lat, lon, radiusM);
    if (fetched === "error" && endpoint.fallback) {
      source = endpoint.fallback;
      fetched = await fetchParcelRings(source, lat, lon, radiusM);
    }
    if (fetched === "error") {
      breaker.recordFailure(state);
      // A transient service error is not a statement about this location.
      // Writing it through `cached()` would persist "no parcels here" for a
      // month, long after the service recovered.
      continue;
    }
    breaker.recordSuccess(state);
    answeredAtLeastOnce = true;

    const { truncated, attributes } = fetched;
    let { rings } = fetched;
    let completeRadiusM = truncated ? 0 : radiusM;
    if (truncated && radiusM > PARCEL_FALLBACK_RADIUS_M) {
      // The neighbourhood of the point matters most; a smaller box fits.
      const near = await fetchParcelRings(
        source,
        lat,
        lon,
        PARCEL_FALLBACK_RADIUS_M,
      );
      if (near !== "error") {
        rings = mergeRings(rings, near.rings);
        for (const [id, value] of near.attributes) attributes.set(id, value);
        if (!near.truncated) completeRadiusM = PARCEL_FALLBACK_RADIUS_M;
      }
    }

    let parcels: ParcelFeature[] = [];
    for (const ring of rings) {
      const check = checkRing(ring, {
        minAreaSqm: 25,
        maxAreaSqm: 2_000_000,
      });
      if (!check.valid) continue;
      parcels.push({
        ring,
        areaSqm: check.areaSqm,
        state,
        ...attributes.get(ringKey(ring)),
      });
    }
    // BW publishes address and land use as separate layers.
    if (state === "Baden-Württemberg") {
      parcels = await withBwAttributes(parcels, lat, lon, radiusM);
    }
    const result: ParcelLookup = {
      parcels,
      state,
      truncated,
      completeRadiusM,
      reachable: true,
      containsAnchor: parcelContainsPoint(parcels, lat, lon),
      status:
        parcels.length === 0
          ? "successEmpty"
          : truncated
            ? "partial"
            : "success",
    };
    cacheSet(key, result, TTL.cadastre);

    if (result.parcels.length > 0) return result;
    // Service answered but holds nothing here — try the next candidate state
    // (the bounding boxes overlap on purpose) before giving up.
  }
  return {
    parcels: [],
    state: null,
    truncated: false,
    reachable: answeredAtLeastOnce,
    containsAnchor: false,
    status: answeredAtLeastOnce ? "successEmpty" : "transientFailure",
  };
}

/**
 * Geographic (ETRS89) to UTM zone 32N (EPSG:25832), easting and northing in
 * metres. Krüger series to third order: millimetre accuracy within the zone,
 * far below what a search box needs.
 */
export function toUtm32(lat: number, lon: number): [number, number] {
  const a = 6_378_137;
  const f = 1 / 298.257222101;
  const k0 = 0.9996;
  const n = f / (2 - f);
  const bigA = (a / (1 + n)) * (1 + (n * n) / 4 + n ** 4 / 64);
  const phi = (lat * Math.PI) / 180;
  const dLam = ((lon - 9) * Math.PI) / 180;
  const c = (2 * Math.sqrt(n)) / (1 + n);
  const t = Math.sinh(
    Math.atanh(Math.sin(phi)) - c * Math.atanh(c * Math.sin(phi)),
  );
  const xi = Math.atan(t / Math.cos(dLam));
  const eta = Math.atanh(Math.sin(dLam) / Math.sqrt(1 + t * t));
  const alpha = [
    n / 2 - (2 * n * n) / 3 + (5 * n ** 3) / 16,
    (13 * n * n) / 48 - (3 * n ** 3) / 5,
    (61 * n ** 3) / 240,
  ];
  let e = eta;
  let nn = xi;
  alpha.forEach((al, j) => {
    const k = 2 * (j + 1);
    e += al * Math.cos(k * xi) * Math.sinh(k * eta);
    nn += al * Math.sin(k * xi) * Math.cosh(k * eta);
  });
  return [500_000 + k0 * bigA * e, k0 * bigA * nn];
}

/** Stable identity of a ring, for deduplicating pages and merged queries. */
function ringKey(ring: [number, number][]): string {
  return ring
    .slice(0, 3)
    .map(([lo, la]) => `${lo.toFixed(7)},${la.toFixed(7)}`)
    .concat(String(ring.length))
    .join(";");
}

/** `base` plus the rings of `extra` it does not already hold. */
export function mergeRings(
  base: [number, number][][],
  extra: [number, number][][],
): [number, number][][] {
  const seen = new Set(base.map(ringKey));
  return [...base, ...extra.filter((ring) => !seen.has(ringKey(ring)))];
}

/**
 * All parcel rings in the search box, paged with `startIndex` up to
 * `PARCEL_MAX_PAGES`. A page that adds nothing new means the service ignores
 * `startIndex`; paging stops there and the answer stays truncated. A failed
 * later page keeps what arrived and marks it truncated.
 */
export async function fetchParcelRings(
  endpoint: AlkisEndpoint,
  lat: number,
  lon: number,
  radiusM: number,
  fetchPage: typeof fetchAlkisXml = fetchAlkisXml,
): Promise<
  | {
      rings: [number, number][][];
      truncated: boolean;
      /** Address and land use per ring (`ringKey`), where published. */
      attributes: Map<string, ParcelAttributes>;
    }
  | "error"
> {
  let rings: [number, number][][] = [];
  let truncated = false;
  const attributes = new Map<string, ParcelAttributes>();
  for (let page = 0; page < PARCEL_MAX_PAGES; page += 1) {
    const xml = await fetchPage(
      endpoint,
      lat,
      lon,
      radiusM,
      page * PARCEL_REQUEST_LIMIT,
    );
    if (xml === "error") {
      if (page === 0) return "error";
      truncated = true;
      break;
    }
    if (!xml) break;
    const before = rings.length;
    const zone = endpoint.utmZone;
    const features = parseParcelFeatures(xml).map((feature) =>
      zone ? { ...feature, ring: ringsFromUtm(feature.ring, zone) } : feature,
    );
    for (const { ring, address, landUse } of features) {
      if (address || landUse) {
        attributes.set(ringKey(ring), {
          ...(address ? { address } : {}),
          ...(landUse ? { landUse } : {}),
        });
      }
    }
    rings = mergeRings(
      rings,
      features.map((feature) => feature.ring),
    );
    // `numberMatched` counts the whole answer, `numberReturned` this page.
    const { matched, returned } = parseWfsCounts(xml);
    // Some services (Hessen, Hamburg) always write numberReturned="0"; the
    // members of the page are then the only count there is.
    truncated =
      matched != null && returned != null && returned > 0
        ? matched > page * PARCEL_REQUEST_LIMIT + returned
        : returned != null && returned > 0
          ? returned >= PARCEL_REQUEST_LIMIT
          : memberCount(xml) >= PARCEL_REQUEST_LIMIT;
    if (!truncated || rings.length === before) break;
  }
  return { rings, truncated, attributes };
}

/** Features in a WFS page, counted by their `member` elements. */
function memberCount(xml: string): number {
  return (xml.match(/<(?:[\w.-]+:)?(?:member|featureMember)>/g) ?? []).length;
}

/** "error" = network/HTTP error (counts toward the circuit breaker); null = reachable, but no hit. */
async function fetchAlkisXml(
  endpoint: AlkisEndpoint,
  lat: number,
  lon: number,
  radiusM: number,
  startIndex = 0,
): Promise<string | null | "error"> {
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  const crsUrn = endpoint.utmZone
    ? `urn:ogc:def:crs:EPSG::258${endpoint.utmZone}`
    : `urn:ogc:def:crs:EPSG::${endpoint.crs}`;
  let bbox = `${lat - dLat},${lon - dLon},${lat + dLat},${lon + dLon},${crsUrn}`;
  if (endpoint.bboxUtm32) {
    const [east, north] = toUtm32(lat, lon);
    bbox = `${east - radiusM},${north - radiusM},${east + radiusM},${north + radiusM},urn:ogc:def:crs:EPSG::25832`;
  }
  let url: string;
  if (endpoint.utmZone && endpoint.storedQuery) {
    // One answer with every layer; it has no paging.
    if (startIndex > 0) return null;
    const [east, north] = toUtm(lat, lon, endpoint.utmZone);
    url =
      `${endpoint.url}?service=WFS&version=2.0.0&request=GetFeature` +
      `&STOREDQUERY_ID=${encodeURIComponent(endpoint.storedQuery)}` +
      `&CRS=${encodeURIComponent(crsUrn)}` +
      `&x1=${(east - radiusM).toFixed(1)}&y1=${(north - radiusM).toFixed(1)}` +
      `&x2=${(east + radiusM).toFixed(1)}&y2=${(north + radiusM).toFixed(1)}`;
  } else {
    if (endpoint.utmZone) {
      const [east, north] = toUtm(lat, lon, endpoint.utmZone);
      bbox = `${east - radiusM},${north - radiusM},${east + radiusM},${north + radiusM},${crsUrn}`;
    }
    url =
      `${endpoint.url}?service=WFS&version=2.0.0&request=GetFeature` +
      `&typeNames=${encodeURIComponent(endpoint.typeName)}&count=${PARCEL_REQUEST_LIMIT}` +
      (startIndex > 0 ? `&startIndex=${startIndex}` : "") +
      `&srsName=${crsUrn}&bbox=${encodeURIComponent(bbox)}`;
  }
  try {
    const res = await fetchWithResilience(url, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) return "error";
    const text = await res.text();
    if (text.includes("ExceptionReport")) return "error";
    return endpoint.featureElement
      ? onlyFeatureMembers(text, endpoint.featureElement)
      : text;
  } catch {
    return "error";
  }
}

/**
 * Keeps only the `element` features of an answer that holds several layers
 * (nested feature collections), each wrapped as one `wfs:member`, with the
 * answer's own counts. Other layers (buildings, land use, administrative
 * units) would otherwise be read as parcels.
 */
export function onlyFeatureMembers(xml: string, element: string): string {
  const pattern = new RegExp(
    `<(?:[\\w.-]+:)?${element}\\s+gml:id=[\\s\\S]*?</(?:[\\w.-]+:)?${element}>`,
    "g",
  );
  const head = /<wfs:FeatureCollection\b[^>]*>/.exec(xml)?.[0] ?? "";
  const features = [...xml.matchAll(pattern)].map(
    (m) => `<wfs:member>${m[0]}</wfs:member>`,
  );
  // The outer collection counts every layer; the parcels are what is left.
  const count = String(features.length);
  const opening = head
    ? head
        .replace(/numberReturned="[^"]*"/, `numberReturned="${count}"`)
        .replace(/numberMatched="[^"]*"/, `numberMatched="${count}"`)
    : "<wfs:FeatureCollection>";
  return `${opening}${features.join("")}</wfs:FeatureCollection>`;
}

/** Rings read from a UTM answer ([north, east] after the axis flip) to [lon, lat]. */
export function ringsFromUtm(
  rings: [number, number][],
  zone: number,
): [number, number][] {
  return rings.map(([north, east]) => fromUtm(east, north, zone));
}

/**
 * Extracts the exterior rings (`gml:exterior`) of all `gml:Polygon` and
 * `gml:PolygonPatch` elements in the GML. The latter appears wrapped in a
 * `gml:Surface`/`gml:patches` (e.g. Hesse's INSPIRE download service) rather
 * than a bare `gml:Polygon` — GML3.2's more general surface encoding of the
 * exact same exterior/interior ring structure, so no separate handling is
 * needed once the element name is matched too.
 *
 * Coordinates arrive as "lat lon lat lon …" (EPSG:4258/4326, both with
 * geographic axis order lat,lon) and are flipped to [lon, lat]
 * (GeoJSON convention). Works independently of the surrounding schema
 * (INSPIRE `cp:CadastralParcel`, NRW `ave:Flurstueck`, Berlin
 * `alkis_flurstuecke:flurstuecke`, …) — all use the same GML geometry.
 */
export function parseExteriorRings(xml: string): [number, number][][] {
  const rings: [number, number][][] = [];
  const polygonRe =
    /<(?:[\w.-]+:)?(?:PolygonPatch|Polygon)\b[\s\S]*?<\/(?:[\w.-]+:)?(?:PolygonPatch|Polygon)>/g;
  for (const match of xml.matchAll(polygonRe)) {
    const exterior = match[0].match(
      /<(?:[\w.-]+:)?exterior>([\s\S]*?)<\/(?:[\w.-]+:)?exterior>/,
    );
    if (!exterior) continue;
    // A LinearRing has one posList; a Ring (e.g. Hamburg) is a chain of
    // curve segments, each with its own posList, joined end to start.
    const ring: [number, number][] = [];
    for (const list of exterior[1].matchAll(
      /<(?:[\w.-]+:)?posList[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?posList>/g,
    )) {
      const nums = list[1].trim().split(/\s+/).map(Number);
      for (let i = 0; i + 1 < nums.length; i += 2) {
        const la = nums[i];
        const lo = nums[i + 1];
        if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;
        const prev = ring[ring.length - 1];
        if (prev && prev[0] === lo && prev[1] === la) continue;
        ring.push([lo, la]);
      }
    }
    if (ring.length < 3) continue;
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
    rings.push(ring);
  }
  return rings;
}

/**
 * Whether the geocoded point actually falls inside one of the parcels.
 *
 * This is a real confidence signal and the two cases must not be conflated: a
 * parcel *containing* the point identifies the property, whereas the *nearest*
 * parcel is a guess that happens to be close. The services will not make this
 * distinction for us (their spatial filter is ignored — see the header), so it
 * is made here.
 */
export function parcelContainsPoint(
  parcels: ParcelFeature[],
  lat: number,
  lon: number,
): boolean {
  const pt = turfPoint([lon, lat]);
  return parcels.some((parcel) =>
    booleanPointInPolygon(pt, { type: "Polygon", coordinates: [parcel.ring] }),
  );
}
