import { haversineMeters } from "@shared/dedupe";
import { cached, TTL } from "./cache.service";
import { fetchWithResilience } from "./http.service";
import { statesForPoint } from "./alkis.service";

/**
 * Official house coordinates (Hauskoordinaten, from ALKIS) for refining a
 * geocoded anchor. Nominatim often lands on the street or interpolates a
 * house number; the cadastre has the address on its building.
 *
 * Endpoints verified live in November 2026 (docs/official-buildings.md):
 * the INSPIRE "Addresses" download services of seven states and Berlin's
 * address WFS. All of them honour a FES filter of BBOX plus house number, so
 * one request returns a handful of candidates instead of every address in
 * the box. INSPIRE addresses reference their street (ThoroughfareName) and
 * postcode (PostalDescriptor) by link; the postcode sits in the link itself,
 * the street name is resolved with a second request by feature id.
 *
 * Not covered: Hamburg (its INSPIRE WFS fails every spatial filter with a
 * server error), NRW, Hessen, Thüringen, Rheinland-Pfalz, Sachsen-Anhalt,
 * Bremen and Bayern (no open address WFS found or none with street names
 * that a client can match). There the Nominatim anchor stays as it is.
 */

const USER_AGENT = "DealershipRiskMapping-Desktop/0.1 (contact: internal)";

interface AddressEndpoint {
  url: string;
  kind: "inspire" | "berlin";
}

const ADDRESS_ENDPOINTS: Record<string, AddressEndpoint> = {
  Niedersachsen: {
    url: "https://www.inspire.niedersachsen.de/doorman/noauth/alkis-dls-ad",
    kind: "inspire",
  },
  Sachsen: {
    url: "https://geodienste.sachsen.de/aaa/public_inspire/alkis/ad/dls/wfs",
    kind: "inspire",
  },
  "Schleswig-Holstein": {
    url: "https://service.gdi-sh.de/SH_INSPIREDOWNLOAD_AI_AD",
    kind: "inspire",
  },
  Brandenburg: {
    url: "https://inspire.brandenburg.de/services/ad_alkis_wfs",
    kind: "inspire",
  },
  "Mecklenburg-Vorpommern": {
    url: "https://www.geodaten-mv.de/dienste/inspire_ad_alkis_download",
    kind: "inspire",
  },
  "Baden-Württemberg": {
    url: "https://owsproxy.lgl-bw.de/owsproxy/wfs/WFS_INSP_BW_Adr_Hauskoord_ALKIS",
    kind: "inspire",
  },
  Saarland: {
    url: "https://geoportal.saarland.de/gdi-sl/inspirewfs_Adressen_Hauskoordinaten",
    kind: "inspire",
  },
  Berlin: {
    url: "https://gdi.berlin.de/services/wfs/adressen_berlin",
    kind: "berlin",
  },
};

/** The parcel lookup's state boxes include Saarland since November 2026. */
function candidateStates(lat: number, lon: number): string[] {
  return statesForPoint(lat, lon);
}

/** Search radius around the geocoder's point. */
export const HOUSE_SEARCH_RADIUS_M = 400;

/** Two matches further apart than this are different buildings: no pick. */
const SAME_ADDRESS_M = 30;

const REQUEST_TIMEOUT_MS = 15_000;

const STREET_IDS_PER_REQUEST = 10;

export interface StreetAddress {
  street: string;
  /** Number without suffix, e.g. "12". */
  number: string;
  /** Lower-case suffix, e.g. "a" (empty when none). */
  suffix: string;
  postcode?: string;
}

/**
 * Street, house number and postcode from a German address line such as
 * "Reicker Str. 113a, 01237 Dresden". Null when no street with a number is
 * recognisable (a bare town, a PO box).
 */
export function parseStreetAddress(address: string): StreetAddress | null {
  const postcode = address.match(/\b(\d{5})\b/)?.[1];
  for (const part of address.split(",")) {
    const m = part
      .replace(/\b\d{5}\b.*$/, "")
      .trim()
      .match(/^(.*?\S)\s+(\d{1,4})\s*([a-zA-Z])?(?:\s*[-/].*)?$/);
    if (m && /[a-zäöüß]/i.test(m[1])) {
      return {
        street: m[1],
        number: m[2],
        suffix: (m[3] ?? "").toLowerCase(),
        ...(postcode ? { postcode } : {}),
      };
    }
  }
  return null;
}

/** Folds the spellings of one street name together ("Str." = "Straße"). */
export function normalizeStreet(street: string): string {
  return street
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/str\.?(?=\s|-|$)/g, "strasse")
    .replace(/[^a-z0-9]/g, "");
}

export interface AddressCandidate {
  lat: number;
  lon: number;
  /** House number with suffix, normalised ("12a"). */
  houseNumber: string;
  postcode?: string;
  /** Street name, or the id to resolve it by (INSPIRE). */
  street?: string;
  streetId?: string;
}

function xmlEscape(value: string): string {
  return value.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** FES 2.0 filter: within the box and one of the house-number spellings. */
export function addressFilter(
  kind: AddressEndpoint["kind"],
  lat: number,
  lon: number,
  radiusM: number,
  numbers: string[],
): string {
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  const [geom, numberPath, crs, ns] =
    kind === "inspire"
      ? [
          "ad:position/ad:GeographicPosition/ad:geometry",
          "ad:locator/ad:AddressLocator/ad:designator/ad:LocatorDesignator/ad:designator",
          "4258",
          'xmlns:ad="http://inspire.ec.europa.eu/schemas/ad/4.0"',
        ]
      : [
          "adressen_berlin:geom",
          "adressen_berlin:hnr",
          "4326",
          'xmlns:adressen_berlin="http://gdi.berlin.de/adressen_berlin"',
        ];
  const equals = numbers.map(
    (n) =>
      `<fes:PropertyIsEqualTo><fes:ValueReference>${numberPath}</fes:ValueReference><fes:Literal>${xmlEscape(n)}</fes:Literal></fes:PropertyIsEqualTo>`,
  );
  const numberFilter =
    equals.length > 1 ? `<fes:Or>${equals.join("")}</fes:Or>` : equals[0];
  return (
    `<fes:Filter xmlns:fes="http://www.opengis.net/fes/2.0" xmlns:gml="http://www.opengis.net/gml/3.2" ${ns}>` +
    `<fes:And><fes:BBOX><fes:ValueReference>${geom}</fes:ValueReference>` +
    `<gml:Envelope srsName="urn:ogc:def:crs:EPSG::${crs}">` +
    `<gml:lowerCorner>${lat - dLat} ${lon - dLon}</gml:lowerCorner>` +
    `<gml:upperCorner>${lat + dLat} ${lon + dLon}</gml:upperCorner>` +
    `</gml:Envelope></fes:BBOX>${numberFilter}</fes:And></fes:Filter>`
  );
}

function members(xml: string): string[] {
  return [...xml.matchAll(/<wfs:member\b[^>]*>([\s\S]*?)<\/wfs:member>/g)].map(
    (m) => m[1],
  );
}

function position(xml: string): { lat: number; lon: number } | null {
  const pos = xml.match(/<gml:pos\b[^>]*>\s*([-\d.]+)\s+([-\d.]+)/);
  if (!pos) return null;
  const lat = Number(pos[1]);
  const lon = Number(pos[2]);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

/** The feature id at the end of an INSPIRE component link. */
function linkedId(href: string, type: string): string | undefined {
  const re = new RegExp(`(${type}[._][\\w.-]+?)(?:$|[#&?])`);
  const fragment = href.includes("#") ? href.split("#").pop()! : href;
  return fragment.match(re)?.[1] ?? href.match(re)?.[1];
}

/** INSPIRE `ad:Address` members: position, number, postcode, street link. */
export function parseInspireAddresses(xml: string): AddressCandidate[] {
  const out: AddressCandidate[] = [];
  for (const member of members(xml)) {
    const pos = position(member);
    if (!pos) continue;
    const designators = [
      ...member.matchAll(
        /<(?:[\w-]+:)?designator>([^<]+)<\/(?:[\w-]+:)?designator>/g,
      ),
    ].map((m) => m[1].trim().toLowerCase());
    const links = [
      ...member.matchAll(/<(?:[\w-]+:)?component\b[^>]*xlink:href="([^"]+)"/g),
    ].map((m) => m[1].replace(/&amp;/g, "&"));
    const streetLink = links.find((l) => /ThoroughfareName/.test(l));
    const postcode = links
      .map((l) => l.match(/PostalDescriptor[._](\d{5})/)?.[1])
      .find(Boolean);
    out.push({
      ...pos,
      houseNumber: designators.join(""),
      ...(postcode ? { postcode } : {}),
      ...(streetLink
        ? { streetId: linkedId(streetLink, "ThoroughfareName") }
        : {}),
    });
  }
  return out;
}

/** Berlin's `adressen_berlin` members carry street and postcode inline. */
export function parseBerlinAddresses(xml: string): AddressCandidate[] {
  const out: AddressCandidate[] = [];
  for (const member of members(xml)) {
    const pos = position(member);
    const field = (name: string): string | undefined =>
      member
        .match(new RegExp(`<adressen_berlin:${name}>([^<]*)<`))?.[1]
        ?.trim();
    const street = field("str_name");
    const hnr = field("hnr");
    if (!pos || !street || !hnr) continue;
    const plz = field("plz");
    out.push({
      ...pos,
      houseNumber: hnr.toLowerCase().replace(/\s+/g, ""),
      street,
      ...(plz ? { postcode: plz } : {}),
    });
  }
  return out;
}

/** `gml:id` → street name of resolved INSPIRE ThoroughfareName features. */
export function parseThoroughfareNames(xml: string): Map<string, string> {
  const names = new Map<string, string>();
  for (const member of members(xml)) {
    const id = member.match(/gml:id="([^"]+)"/)?.[1];
    const localId = member.match(
      /<(?:[\w-]+:)?localId>([^<]+)<\/(?:[\w-]+:)?localId>/,
    )?.[1];
    const text = member.match(
      /<(?:[\w-]+:)?text>([^<]+)<\/(?:[\w-]+:)?text>/,
    )?.[1];
    if (!text) continue;
    for (const key of [id, localId]) if (key) names.set(key, text.trim());
  }
  return names;
}

/**
 * The single official position of `address` among the candidates, or null
 * when none matches or matches lie on different buildings.
 */
export function matchAddress(
  address: StreetAddress,
  candidates: AddressCandidate[],
): AddressCandidate | null {
  const wantedNumber = `${address.number}${address.suffix}`;
  const wantedStreet = normalizeStreet(address.street);
  const matches = candidates.filter(
    (c) =>
      c.houseNumber === wantedNumber &&
      c.street != null &&
      normalizeStreet(c.street) === wantedStreet &&
      (!address.postcode || !c.postcode || c.postcode === address.postcode),
  );
  if (matches.length === 0) return null;
  const [first] = matches;
  const spread = matches.some(
    (m) => haversineMeters(first.lat, first.lon, m.lat, m.lon) > SAME_ADDRESS_M,
  );
  return spread ? null : first;
}

async function getXml(url: string): Promise<string> {
  const res = await fetchWithResilience(
    url,
    { headers: { "User-Agent": USER_AGENT } },
    { timeoutMs: REQUEST_TIMEOUT_MS, retries: 0 },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  if (xml.includes("ExceptionReport")) throw new Error("WFS exception");
  return xml;
}

async function candidatesFrom(
  endpoint: AddressEndpoint,
  address: StreetAddress,
  lat: number,
  lon: number,
): Promise<AddressCandidate[]> {
  // "12a" may be stored as one designator or as "12" plus "a".
  const numbers = [
    address.number,
    ...(address.suffix
      ? [
          `${address.number}${address.suffix}`,
          `${address.number}${address.suffix.toUpperCase()}`,
        ]
      : []),
  ];
  const typeName =
    endpoint.kind === "inspire"
      ? "ad:Address"
      : "adressen_berlin:adressen_berlin";
  const crs = endpoint.kind === "inspire" ? "4258" : "4326";
  const filter = addressFilter(
    endpoint.kind,
    lat,
    lon,
    HOUSE_SEARCH_RADIUS_M,
    numbers,
  );
  const xml = await getXml(
    `${endpoint.url}?service=WFS&version=2.0.0&request=GetFeature` +
      `&typeNames=${encodeURIComponent(typeName)}&count=200` +
      `&srsName=urn:ogc:def:crs:EPSG::${crs}&FILTER=${encodeURIComponent(filter)}`,
  );
  if (endpoint.kind === "berlin") return parseBerlinAddresses(xml);

  const candidates = parseInspireAddresses(xml).filter(
    (c) => !address.postcode || !c.postcode || c.postcode === address.postcode,
  );
  const ids = [
    ...new Set(candidates.map((c) => c.streetId).filter(Boolean)),
  ] as string[];
  if (ids.length === 0) return [];
  // Lower Saxony's gateway rejects long id lists; ten per request pass.
  const names = new Map<string, string>();
  for (let i = 0; i < ids.length; i += STREET_IDS_PER_REQUEST) {
    const chunk = ids.slice(i, i + STREET_IDS_PER_REQUEST);
    for (const [id, name] of parseThoroughfareNames(
      await getXml(
        `${endpoint.url}?service=WFS&version=2.0.0&request=GetFeature` +
          `&typeNames=ad:ThoroughfareName&RESOURCEID=${encodeURIComponent(chunk.join(","))}`,
      ),
    )) {
      names.set(id, name);
    }
  }
  return candidates.map((c) => ({
    ...c,
    ...(c.streetId && names.has(c.streetId)
      ? { street: names.get(c.streetId) }
      : {}),
  }));
}

export interface HouseCoordinate {
  lat: number;
  lon: number;
  state: string;
}

/**
 * The official house coordinate of `address` near the geocoder's point, or
 * null when the state publishes none, nothing matches street, number and
 * postcode exactly, or the service fails. Cached per address.
 */
export async function officialHouseCoordinate(
  address: string,
  near: { lat: number; lon: number },
): Promise<HouseCoordinate | null> {
  const parsed = parseStreetAddress(address);
  if (!parsed) return null;
  const key = `house-coordinate:v1:${address.toLowerCase().trim()}:${near.lat.toFixed(3)},${near.lon.toFixed(3)}`;
  try {
    return await cached(key, TTL.cadastre, async () => {
      let failed = false;
      // Boxes of neighbouring states overlap: ask each candidate in turn.
      for (const state of candidateStates(near.lat, near.lon)) {
        const endpoint = ADDRESS_ENDPOINTS[state];
        if (!endpoint) continue;
        try {
          const match = matchAddress(
            parsed,
            await candidatesFrom(endpoint, parsed, near.lat, near.lon),
          );
          if (match) return { lat: match.lat, lon: match.lon, state };
        } catch {
          failed = true;
        }
      }
      // Only a clean "no match" is worth remembering.
      if (failed) throw new Error("address service unavailable");
      return null;
    });
  } catch {
    // A failed request says nothing about the address: not cached.
    return null;
  }
}
