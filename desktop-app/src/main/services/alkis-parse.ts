import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import { point as turfPoint } from "@turf/helpers";
import { type LonLat } from "./boundary-geometry";
import { fromUtm } from "./utm";
import { type LandUseSection } from "./parcel-sections";

/** Reading the cadastre services' WFS answers: parcels with their use and attributes, land-use sections, polygon rings in UTM and lon/lat. */

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

/**
 * Land-use sections of `ave:NutzungFlurstueck` (`nutzart`, one feature per
 * section, possibly several polygons each).
 */
export function parseLandUseSections(xml: string): LandUseSection[] {
  const sections: LandUseSection[] = [];
  for (const member of xml.matchAll(MEMBER_RE)) {
    const body = member[1];
    const name = xmlField(body, "nutzart");
    if (!name) continue;
    const use = classifyLandUse(name);
    for (const ring of parseExteriorRings(body)) sections.push({ ring, use });
  }
  return sections;
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
export function ringKey(ring: [number, number][]): string {
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

/** Features in a WFS page, counted by their `member` elements. */
export function memberCount(xml: string): number {
  return (xml.match(/<(?:[\w.-]+:)?(?:member|featureMember)>/g) ?? []).length;
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
  return parsePolygons(xml).map((polygon) => polygon.exterior);
}

/**
 * Polygons with their interior rings: courtyards of a building, parcels
 * enclosed by another. `parseExteriorRings` drops the holes.
 */
export function parsePolygons(
  xml: string,
): Array<{ exterior: [number, number][]; interiors: [number, number][][] }> {
  const polygons: Array<{
    exterior: [number, number][];
    interiors: [number, number][][];
  }> = [];
  const polygonRe =
    /<(?:[\w.-]+:)?(?:PolygonPatch|Polygon)\b[\s\S]*?<\/(?:[\w.-]+:)?(?:PolygonPatch|Polygon)>/g;
  for (const match of xml.matchAll(polygonRe)) {
    const exterior = match[0].match(
      /<(?:[\w.-]+:)?exterior>([\s\S]*?)<\/(?:[\w.-]+:)?exterior>/,
    );
    if (!exterior) continue;
    const ring = ringFromGml(exterior[1]);
    if (!ring) continue;
    const interiors: [number, number][][] = [];
    for (const interior of match[0].matchAll(
      /<(?:[\w.-]+:)?interior>([\s\S]*?)<\/(?:[\w.-]+:)?interior>/g,
    )) {
      const hole = ringFromGml(interior[1]);
      if (hole) interiors.push(hole);
    }
    polygons.push({ exterior: ring, interiors });
  }
  return polygons;
}

/**
 * One closed ring from a GML ring element. A LinearRing has one posList; a
 * Ring (e.g. Hamburg) is a chain of curve segments, each with its own
 * posList, joined end to start. Null for fewer than three points.
 */
function ringFromGml(gml: string): [number, number][] | null {
  const ring: [number, number][] = [];
  for (const list of gml.matchAll(
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
  if (ring.length < 3) return null;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
  return ring;
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
