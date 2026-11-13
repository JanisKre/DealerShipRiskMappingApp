import sharp from "sharp";
import { cacheGet, cacheSet } from "./cache.service";
import { fetchWithResilience } from "./http.service";
import type { LonLat } from "./boundary-geometry";
import { isInBavariaBox } from "./bavaria-lod2.service";

/**
 * Traffic areas (streets, paths, squares, rail) for Bayern from the open
 * ALKIS "Tatsächliche Nutzung" map service of the Bayerische
 * Vermessungsverwaltung (WMS, free of charge, CC BY 4.0).
 *
 * Bayern publishes no open parcels, so the vehicle outline there cannot
 * remove street parcels and runs across roads (docs/boundary-model.md). The
 * WMS layer `by_alkis_tn_verkehr` draws exactly the traffic areas, filled,
 * on a transparent background; rendered at 1 m per pixel it is a street
 * raster that the outline subtracts like street parcels elsewhere.
 */

export const BAVARIA_LANDUSE_WMS =
  "https://geoservices.bayern.de/od/wms/alkis/v1/tn";
export const BAVARIA_LANDUSE_LAYER = "by_alkis_tn_verkehr";
export const BAVARIA_LANDUSE_ATTRIBUTION =
  "ALKIS Tatsächliche Nutzung Bayern © Bayerische Vermessungsverwaltung – www.geodaten.bayern.de, CC BY 4.0";

/** Pixel size of the requested map in metres. */
const PIXEL_M = 1;
/** Largest radius requested; the outline reaches about 180 m from the point. */
export const STREET_MASK_RADIUS_M = 220;
const TIMEOUT_MS = 20_000;
const CACHE_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const CACHE_VERSION = 1;
const USER_AGENT = "DealershipRiskMapping-Desktop/0.1 (contact: internal)";

/** A raster in geographic coordinates: 1 = traffic area. */
export interface StreetMask {
  west: number;
  south: number;
  east: number;
  north: number;
  width: number;
  height: number;
  /** Row-major from the north-west corner, one byte per pixel. */
  cells: Uint8Array;
}

/** True when the point falls on a traffic area of the mask. */
export function onStreet(mask: StreetMask, [lon, lat]: LonLat): boolean {
  if (
    lon < mask.west ||
    lon >= mask.east ||
    lat <= mask.south ||
    lat > mask.north
  ) {
    return false;
  }
  const col = Math.floor(
    ((lon - mask.west) / (mask.east - mask.west)) * mask.width,
  );
  const row = Math.floor(
    ((mask.north - lat) / (mask.north - mask.south)) * mask.height,
  );
  return mask.cells[row * mask.width + col] === 1;
}

/** Bounding box of `radiusM` around the point, in degrees. */
function boxAround(
  lat: number,
  lon: number,
  radiusM: number,
): {
  west: number;
  south: number;
  east: number;
  north: number;
} {
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  return {
    west: lon - dLon,
    south: lat - dLat,
    east: lon + dLon,
    north: lat + dLat,
  };
}

/** Packs a 0/1 byte raster into bits, base64-encoded, for the cache. */
function pack(cells: Uint8Array): string {
  const bits = new Uint8Array(Math.ceil(cells.length / 8));
  cells.forEach((v, i) => {
    if (v) bits[i >> 3] |= 1 << (i & 7);
  });
  return Buffer.from(bits).toString("base64");
}

function unpack(packed: string, length: number): Uint8Array {
  const bits = Buffer.from(packed, "base64");
  const cells = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) cells[i] = (bits[i >> 3] >> (i & 7)) & 1;
  return cells;
}

interface CachedMask {
  west: number;
  south: number;
  east: number;
  north: number;
  width: number;
  height: number;
  packed: string;
}

/** Decodes the WMS PNG: every opaque pixel is a traffic area. */
export async function maskFromPng(
  png: Buffer,
  box: { west: number; south: number; east: number; north: number },
): Promise<StreetMask> {
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const cells = new Uint8Array(info.width * info.height);
  for (let i = 0; i < cells.length; i += 1) {
    cells[i] = data[i * info.channels + 3] > 128 ? 1 : 0;
  }
  return { ...box, width: info.width, height: info.height, cells };
}

const inFlight = new Map<string, Promise<StreetMask | null>>();

/**
 * The traffic-area raster around a point in Bayern; null outside Bayern's
 * rough outline, when the service fails or when the map is empty (a point
 * outside Bayern returns a blank map).
 */
export function bavariaStreetMask(
  lat: number,
  lon: number,
  radiusM: number = STREET_MASK_RADIUS_M,
): Promise<StreetMask | null> {
  if (!isInBavariaBox(lat, lon)) return Promise.resolve(null);
  const key = `bytn:v${CACHE_VERSION}:${radiusM}:${lat.toFixed(4)},${lon.toFixed(4)}`;
  const hit = cacheGet<CachedMask | { empty: true }>(key);
  if (hit) {
    if ("empty" in hit) return Promise.resolve(null);
    return Promise.resolve({
      ...hit,
      cells: unpack(hit.packed, hit.width * hit.height),
    });
  }
  const pending = inFlight.get(key);
  if (pending) return pending;
  const request = (async (): Promise<StreetMask | null> => {
    const box = boxAround(lat, lon, radiusM);
    const size = Math.round((2 * radiusM) / PIXEL_M);
    const url =
      `${BAVARIA_LANDUSE_WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap` +
      `&LAYERS=${BAVARIA_LANDUSE_LAYER}&STYLES=&CRS=EPSG:4326` +
      // WMS 1.3.0 with EPSG:4326: latitude first.
      `&BBOX=${box.south},${box.west},${box.north},${box.east}` +
      `&WIDTH=${size}&HEIGHT=${size}&FORMAT=image/png&TRANSPARENT=TRUE`;
    try {
      const res = await fetchWithResilience(
        url,
        { headers: { "User-Agent": USER_AGENT } },
        { timeoutMs: TIMEOUT_MS, retries: 1 },
      );
      if (
        !res.ok ||
        !(res.headers.get("content-type") ?? "").includes("image/png")
      ) {
        return null;
      }
      const mask = await maskFromPng(Buffer.from(await res.arrayBuffer()), box);
      const empty = !mask.cells.some((v) => v === 1);
      cacheSet(
        key,
        empty
          ? { empty: true }
          : {
              west: mask.west,
              south: mask.south,
              east: mask.east,
              north: mask.north,
              width: mask.width,
              height: mask.height,
              packed: pack(mask.cells),
            },
        CACHE_TTL_MS,
      );
      return empty ? null : mask;
    } catch {
      // A failed request says nothing about the place: not cached.
      return null;
    }
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}
