import { cacheGet, cacheSet } from "./cache.service";
import { fetchWithResilience } from "./http.service";
import type { LonLat } from "./boundary-geometry";
import { toUtm32 } from "./alkis.service";
import type { OfficialBuilding } from "./alkis-buildings.service";

/**
 * Official building footprints for Bayern from the open LoD2 building model
 * of the Bayerische Vermessungsverwaltung (CC BY 4.0, "Bayerische
 * Vermessungsverwaltung – www.geodaten.bayern.de").
 *
 * Bayern publishes no open building or parcel WFS (docs/official-buildings.md);
 * its open data offers the LoD2 model as CityGML files of 2 × 2 km, named by
 * the south-west corner in UTM 32 kilometres ("700_5578.gml"). A tile is
 * 1–160 MB (Munich centre around 60 MB), so it is streamed, only the ground
 * surfaces (the footprints) and the building function are kept, and those are
 * cached per tile. A large tile may not arrive within one analysis; it then
 * helps from the next analysis of any site in the same tile.
 */

export const LOD2_HOSTS = [
  "https://download1.bayernwolke.de/a/lod2/citygml/",
  "https://download2.bayernwolke.de/a/lod2/citygml/",
];

export const LOD2_ATTRIBUTION =
  "LoD2 Bayern © Bayerische Vermessungsverwaltung – www.geodaten.bayern.de, CC BY 4.0";

/** Tile edge in metres; tiles start at even kilometres. */
const TILE_M = 2_000;

/** A tile is read for this long at most; a slower one is abandoned. */
const TILE_TIMEOUT_MS = 180_000;

/** Cache lifetime of a parsed tile: the model is updated municipality by municipality. */
const TILE_TTL_MS = 180 * 24 * 60 * 60 * 1000;

const CACHE_VERSION = 1;

const USER_AGENT = "DealershipRiskMapping-Desktop/0.1 (contact: internal)";

/**
 * Rough outline of Bayern. Neighbouring states inside it are asked first
 * (their services answer with nothing for a point in Bayern); a point
 * outside it never reaches this service.
 */
const BAVARIA_BBOX = {
  minLat: 47.27,
  maxLat: 50.57,
  minLon: 8.97,
  maxLon: 13.84,
};

export function isInBavariaBox(lat: number, lon: number): boolean {
  return (
    lat >= BAVARIA_BBOX.minLat &&
    lat <= BAVARIA_BBOX.maxLat &&
    lon >= BAVARIA_BBOX.minLon &&
    lon <= BAVARIA_BBOX.maxLon
  );
}

/** ALKIS function codes whose roofs carry parked vehicles (as in alkis-buildings). */
const PARKING_FUNCTION_CODES = new Set(["2460", "2461", "2462", "2465"]);

/** One footprint in UTM 32, decimetres, flattened [e0, n0, e1, n1, …]. */
interface CompactFootprint {
  /** Ring as integer decimetres. */
  r: number[];
  /** 1 = car park (roof carries vehicles). */
  p: 0 | 1;
}

/** Tile names ("east_north" in km) whose area meets the box around the point. */
export function lod2TilesFor(
  lat: number,
  lon: number,
  radiusM: number,
): string[] {
  const [east, north] = toUtm32(lat, lon);
  const names: string[] = [];
  const first = (v: number): number => Math.floor(v / TILE_M) * TILE_M;
  for (let e = first(east - radiusM); e <= east + radiusM; e += TILE_M) {
    for (let n = first(north - radiusM); n <= north + radiusM; n += TILE_M) {
      names.push(`${e / 1000}_${n / 1000}`);
    }
  }
  return names;
}

/**
 * Footprints of the buildings in a chunk of CityGML: every complete
 * `bldg:Building`, its ground surfaces and whether it is a car park.
 * Returns the parsed buildings and the unconsumed rest of the text.
 */
export function parseLod2Chunk(text: string): {
  footprints: CompactFootprint[];
  rest: string;
} {
  const footprints: CompactFootprint[] = [];
  const end = "</bldg:Building>";
  let cursor = 0;
  for (;;) {
    const start = text.indexOf("<bldg:Building ", cursor);
    if (start < 0) break;
    const stop = text.indexOf(end, start);
    if (stop < 0) {
      cursor = start;
      return { footprints, rest: text.slice(cursor) };
    }
    footprints.push(...parseBuilding(text.slice(start, stop)));
    cursor = stop + end.length;
  }
  // No open building: keep a short tail in case a start tag was split.
  return { footprints, rest: text.slice(Math.max(cursor, text.length - 64)) };
}

function parseBuilding(xml: string): CompactFootprint[] {
  const code = xml.match(/<bldg:function>(?:\d+_)?(\d+)</)?.[1];
  const parking: 0 | 1 = code && PARKING_FUNCTION_CODES.has(code) ? 1 : 0;
  const out: CompactFootprint[] = [];
  for (const ground of xml.matchAll(
    /<bldg:GroundSurface\b[\s\S]*?<\/bldg:GroundSurface>/g,
  )) {
    for (const list of ground[0].matchAll(
      /<gml:exterior>[\s\S]*?<gml:posList[^>]*>([^<]+)<\/gml:posList>/g,
    )) {
      const nums = list[1].trim().split(/\s+/).map(Number);
      // 3D coordinates: east north height.
      const ring: number[] = [];
      for (let i = 0; i + 2 < nums.length; i += 3) {
        if (!Number.isFinite(nums[i]) || !Number.isFinite(nums[i + 1]))
          continue;
        ring.push(Math.round(nums[i] * 10), Math.round(nums[i + 1] * 10));
      }
      if (ring.length >= 8) out.push({ r: ring, p: parking });
    }
  }
  return out;
}

/**
 * UTM zone 32N (EPSG:25832) to geographic ETRS89. Inverse Krüger series to
 * third order, the counterpart of `toUtm32`: millimetre accuracy in the zone.
 */
export function fromUtm32(east: number, north: number): LonLat {
  const a = 6_378_137;
  const f = 1 / 298.257222101;
  const k0 = 0.9996;
  const n = f / (2 - f);
  const bigA = (a / (1 + n)) * (1 + (n * n) / 4 + n ** 4 / 64);
  const xi = north / (k0 * bigA);
  const eta = (east - 500_000) / (k0 * bigA);
  const beta = [
    n / 2 - (2 * n * n) / 3 + (37 * n ** 3) / 96,
    (n * n) / 48 + n ** 3 / 15,
    (17 * n ** 3) / 480,
  ];
  let xiP = xi;
  let etaP = eta;
  beta.forEach((b, j) => {
    const k = 2 * (j + 1);
    xiP -= b * Math.sin(k * xi) * Math.cosh(k * eta);
    etaP -= b * Math.cos(k * xi) * Math.sinh(k * eta);
  });
  const chi = Math.asin(Math.sin(xiP) / Math.cosh(etaP));
  const delta = [
    2 * n - (2 * n * n) / 3 - 2 * n ** 3,
    (7 * n * n) / 3 - (8 * n ** 3) / 5,
    (56 * n ** 3) / 15,
  ];
  let phi = chi;
  delta.forEach((d, j) => {
    phi += d * Math.sin(2 * (j + 1) * chi);
  });
  const lam = Math.atan2(Math.sinh(etaP), Math.cos(xiP));
  return [9 + (lam * 180) / Math.PI, (phi * 180) / Math.PI];
}

const inFlight = new Map<string, Promise<CompactFootprint[] | null>>();

function cacheKey(tile: string): string {
  return `bylod2:v${CACHE_VERSION}:${tile}`;
}

/** Streams one tile and keeps its footprints; null when no host delivered it. */
async function downloadTile(tile: string): Promise<CompactFootprint[] | null> {
  for (const host of LOD2_HOSTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TILE_TIMEOUT_MS);
    try {
      const res = await fetchWithResilience(
        `${host}${tile}.gml`,
        { headers: { "User-Agent": USER_AGENT }, signal: controller.signal },
        { timeoutMs: 30_000, retries: 0 },
      );
      // 404: no tile there (outside Bayern, or no buildings).
      if (res.status === 404) return [];
      if (!res.ok || !res.body) continue;
      const footprints: CompactFootprint[] = [];
      const decoder = new TextDecoder();
      const reader = res.body.getReader();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseLod2Chunk(buffer);
        footprints.push(...parsed.footprints);
        buffer = parsed.rest;
      }
      footprints.push(...parseLod2Chunk(buffer + decoder.decode()).footprints);
      return footprints;
    } catch {
      // Try the mirror.
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/** A tile's footprints from the cache or the download (shared while in flight). */
function tileFootprints(tile: string): Promise<CompactFootprint[] | null> {
  const hit = cacheGet<CompactFootprint[]>(cacheKey(tile));
  if (hit) return Promise.resolve(hit);
  const pending = inFlight.get(tile);
  if (pending) return pending;
  const request = downloadTile(tile)
    .then((footprints) => {
      // A failed download is not a statement about the tile: not cached.
      if (footprints) cacheSet(cacheKey(tile), footprints, TILE_TTL_MS);
      return footprints;
    })
    .catch(() => null)
    .finally(() => inFlight.delete(tile));
  inFlight.set(tile, request);
  return request;
}

/**
 * Official footprints within `radiusM` of the point from the LoD2 tiles of
 * Bayern; null when a tile could not be read (service down), an empty list
 * where there are no buildings.
 */
export async function bavariaLod2Buildings(
  lat: number,
  lon: number,
  radiusM: number,
): Promise<OfficialBuilding[] | null> {
  const tiles = lod2TilesFor(lat, lon, radiusM);
  const results = await Promise.all(tiles.map(tileFootprints));
  if (results.some((r) => r === null)) {
    const usable = results.filter((r): r is CompactFootprint[] => r !== null);
    if (usable.length === 0) return null;
  }
  const [east, north] = toUtm32(lat, lon);
  const minE = (east - radiusM) * 10;
  const maxE = (east + radiusM) * 10;
  const minN = (north - radiusM) * 10;
  const maxN = (north + radiusM) * 10;
  const buildings: OfficialBuilding[] = [];
  for (const footprints of results) {
    for (const footprint of footprints ?? []) {
      const r = footprint.r;
      let near = false;
      for (let i = 0; i + 1 < r.length; i += 2) {
        if (
          r[i] >= minE &&
          r[i] <= maxE &&
          r[i + 1] >= minN &&
          r[i + 1] <= maxN
        ) {
          near = true;
          break;
        }
      }
      if (!near) continue;
      const ring: LonLat[] = [];
      for (let i = 0; i + 1 < r.length; i += 2) {
        ring.push(fromUtm32(r[i] / 10, r[i + 1] / 10));
      }
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
      buildings.push({
        ring,
        parkingRoof: footprint.p === 1,
        functionKnown: true,
      });
    }
  }
  return buildings;
}
