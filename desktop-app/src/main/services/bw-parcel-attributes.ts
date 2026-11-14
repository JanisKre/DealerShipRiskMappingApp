import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import { point as turfPoint, polygon as turfPolygon } from "@turf/helpers";
import type { LonLat } from "./boundary-geometry";
import {
  classifyLandUse,
  parseExteriorRings,
  type ParcelFeature,
  type ParcelLandUse,
  type ParcelUse,
} from "./alkis.service";
import { fetchWithResilience } from "./http.service";

/**
 * Address and land use for Baden-Württemberg parcels. The INSPIRE parcels
 * of BW carry neither; the state's ALKIS WFS (`nora:`) publishes them as
 * separate layers: address points (`v_al_lagebezeichnung`, one per house
 * number, placed on the plot) and actual land use polygons
 * (`v_al_tatsaechliche_nutzung`). A parcel gets the addresses of the points
 * inside it and the land use shares sampled on a grid over it, the same
 * fields the simplified ALKIS product of other states carries
 * (docs/boundary-model.md, "Cascade v10").
 */

export const BW_NORA_WFS =
  "https://owsproxy.lgl-bw.de/owsproxy/wfs/WFS_LGL-BW_ALKIS";
const LAYER_LIMIT = 2_000;
const USER_AGENT = "DealershipRiskMapping/1.0 (desktop; cadastre)";

export interface BwAddressPoint {
  point: LonLat;
  street: string;
  number: string;
}

export interface BwLandUse {
  ring: LonLat[];
  use: ParcelUse;
}

const MEMBER = /<wfs:member>([\s\S]*?)<\/wfs:member>/g;

function field(body: string, name: string): string | undefined {
  const m = new RegExp(`<nora:${name}>([^<]*)</nora:${name}>`).exec(body);
  const text = m?.[1].trim();
  return text ? text : undefined;
}

/** Address points with a house number (lat lon order in EPSG:4258). */
export function parseBwAddressPoints(xml: string): BwAddressPoint[] {
  const points: BwAddressPoint[] = [];
  for (const m of xml.matchAll(MEMBER)) {
    const body = m[1];
    const street = field(body, "lagebezeichnung");
    const number = field(body, "hausnummer");
    const pos = /<gml:pos[^>]*>\s*([-\d.]+)\s+([-\d.]+)\s*<\/gml:pos>/.exec(
      body,
    );
    if (!street || !number || !pos) continue;
    const lat = Number(pos[1]);
    const lon = Number(pos[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    points.push({ point: [lon, lat], street, number });
  }
  return points;
}

/** Land use polygons with their class (from `objektname`). */
export function parseBwLandUse(xml: string): BwLandUse[] {
  const uses: BwLandUse[] = [];
  for (const m of xml.matchAll(MEMBER)) {
    const name = field(m[1], "objektname");
    if (!name) continue;
    const use = classifyLandUse(name);
    for (const ring of parseExteriorRings(m[1])) uses.push({ ring, use });
  }
  return uses;
}

/** "Hirschstraße 14, 16; Schulstraße 3", the form `addressKeys` reads. */
export function joinAddresses(points: BwAddressPoint[]): string | undefined {
  const byStreet = new Map<string, string[]>();
  for (const p of points) {
    const numbers = byStreet.get(p.street) ?? [];
    if (!numbers.includes(p.number)) numbers.push(p.number);
    byStreet.set(p.street, numbers);
  }
  const parts = [...byStreet].map(
    ([street, numbers]) =>
      `${street} ${numbers.sort((a, b) => parseInt(a) - parseInt(b) || a.localeCompare(b)).join(", ")}`,
  );
  return parts.length > 0 ? parts.join("; ") : undefined;
}

function bbox(ring: LonLat[]): [number, number, number, number] {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const [x, y] of ring) {
    w = Math.min(w, x);
    e = Math.max(e, x);
    s = Math.min(s, y);
    n = Math.max(n, y);
  }
  return [w, s, e, n];
}

const inBox = (b: number[], [x, y]: LonLat): boolean =>
  x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];

/** Grid points per axis when sampling land use over a parcel. */
const SAMPLES_PER_AXIS = 14;

/**
 * Land use shares of a parcel, sampled on a grid of up to 14 × 14 points
 * inside it. Points outside every land use polygon are left out.
 */
export function sampleLandUse(
  ring: LonLat[],
  uses: ReadonlyArray<BwLandUse & { box?: number[] }>,
): ParcelLandUse | undefined {
  const [w, s, e, n] = bbox(ring);
  const parcel = turfPolygon([ring]);
  const counts = new Map<ParcelUse, number>();
  let total = 0;
  const candidates = uses.filter((u) => {
    const b = u.box ?? bbox(u.ring);
    return !(b[2] < w || b[0] > e || b[3] < s || b[1] > n);
  });
  for (let i = 0; i < SAMPLES_PER_AXIS; i++) {
    for (let j = 0; j < SAMPLES_PER_AXIS; j++) {
      const p: LonLat = [
        w + ((i + 0.5) / SAMPLES_PER_AXIS) * (e - w),
        s + ((j + 0.5) / SAMPLES_PER_AXIS) * (n - s),
      ];
      const pt = turfPoint(p);
      if (!booleanPointInPolygon(pt, parcel)) continue;
      const hit = candidates.find(
        (u) =>
          inBox(u.box ?? bbox(u.ring), p) &&
          booleanPointInPolygon(pt, turfPolygon([u.ring])),
      );
      if (!hit) continue;
      counts.set(hit.use, (counts.get(hit.use) ?? 0) + 1);
      total++;
    }
  }
  if (total === 0) return undefined;
  const shares: ParcelLandUse = {};
  for (const [use, count] of counts) shares[use] = count / total;
  return shares;
}

/** Parcels with the addresses and land use of the BW layers. */
export function attachBwAttributes(
  parcels: ParcelFeature[],
  addresses: BwAddressPoint[],
  uses: BwLandUse[],
): ParcelFeature[] {
  const boxed = uses.map((u) => ({ ...u, box: bbox(u.ring) }));
  return parcels.map((parcel) => {
    const box = bbox(parcel.ring);
    const polygon = turfPolygon([parcel.ring]);
    const inside = addresses.filter(
      (a) =>
        inBox(box, a.point) &&
        booleanPointInPolygon(turfPoint(a.point), polygon),
    );
    const address = joinAddresses(inside);
    const landUse =
      boxed.length > 0 ? sampleLandUse(parcel.ring, boxed) : undefined;
    return {
      ...parcel,
      ...(address ? { address } : {}),
      ...(landUse ? { landUse } : {}),
    };
  });
}

async function fetchLayer(
  typeName: string,
  lat: number,
  lon: number,
  radiusM: number,
): Promise<string | null> {
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  const crs = "urn:ogc:def:crs:EPSG::4258";
  const box = `${lat - dLat},${lon - dLon},${lat + dLat},${lon + dLon},${crs}`;
  const url =
    `${BW_NORA_WFS}?service=WFS&version=2.0.0&request=GetFeature` +
    `&typeNames=${encodeURIComponent(typeName)}&count=${LAYER_LIMIT}` +
    `&srsName=${encodeURIComponent(crs)}&bbox=${encodeURIComponent(box)}`;
  try {
    const res = await fetchWithResilience(url, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.includes("ExceptionReport") ? null : text;
  } catch {
    return null;
  }
}

/**
 * Fetches both layers for the search box and attaches them. A failed layer
 * leaves its field out; the parcels themselves are never lost.
 */
export async function withBwAttributes(
  parcels: ParcelFeature[],
  lat: number,
  lon: number,
  radiusM: number,
): Promise<ParcelFeature[]> {
  if (parcels.length === 0) return parcels;
  const [addressXml, useXml] = await Promise.all([
    fetchLayer("nora:v_al_lagebezeichnung", lat, lon, radiusM),
    fetchLayer("nora:v_al_tatsaechliche_nutzung", lat, lon, radiusM),
  ]);
  const addresses = addressXml ? parseBwAddressPoints(addressXml) : [];
  const uses = useXml ? parseBwLandUse(useXml) : [];
  if (addresses.length === 0 && uses.length === 0) return parcels;
  return attachBwAttributes(parcels, addresses, uses);
}
