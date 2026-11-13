import sharp from "sharp";
import { cacheGet, cacheSet } from "./cache.service";
import { fetchWithResilience } from "./http.service";
import { ringAreaSqm, type LonLat } from "./boundary-geometry";
import { isInBavariaBox } from "./bavaria-lod2.service";
import type { ParcelFeature, ParcelLandUse, ParcelUse } from "./alkis.service";
import { area2D, maskToRings, simplifyRing } from "./boundary/vectorize";

/**
 * Parcels for Bayern, read from the open parcel map.
 *
 * Bayern sells its parcels as vector data (docs/boundary-model.md,
 * "Cadastre coverage"), but publishes the "Parzellarkarte" as a free map
 * service (WMS, CC BY 4.0): parcel and building outlines as black lines,
 * buildings filled grey, the ground coloured by actual land use. Rendered at
 * 0.25 m per pixel the lines are one pixel wide, so the areas between them
 * can be read back as polygons:
 *
 * 1. every area enclosed by lines is a region;
 * 2. regions filled in a building grey are buildings and merge into the
 *    neighbouring ground region they share the longest line with (a
 *    building is drawn inside its parcel);
 * 3. each merged region is traced as one parcel, with its land use taken
 *    from the fill colour of its ground.
 *
 * The result is an approximation of the cadastre, good to about half a
 * metre: a building that spans its parcel from side to side splits it, a
 * building on the parcel line may be assigned to the neighbour, and parcels
 * at the edge of the map are cut off. It carries no parcel numbers or
 * addresses. It is enough to tell which plots the vehicles stand on, which
 * is what the cascade needs it for.
 */

export const BAVARIA_PARCEL_WMS =
  "https://geoservices.bayern.de/od/wms/alkis/v1/parzellarkarte";
export const BAVARIA_PARCEL_LAYER = "by_alkis_parzellarkarte_farbe";
export const BAVARIA_PARCEL_ATTRIBUTION =
  "ALKIS-Parzellarkarte Bayern © Bayerische Vermessungsverwaltung – www.geodaten.bayern.de, CC BY 4.0";
/** `state` of the parcels read from the map. */
export const BAVARIA_PARCEL_STATE = "Bayern";

/** Pixel size of the requested map in metres. */
const PIXEL_M = 0.25;
/** Half the edge of the requested map; the service draws up to 1:5,000. */
export const BAVARIA_PARCEL_RADIUS_M = 200;
const TIMEOUT_MS = 25_000;
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CACHE_VERSION = 1;
const USER_AGENT = "DealershipRiskMapping-Desktop/0.1 (contact: internal)";

/** Smallest region kept as a parcel, as in `fetchParcelsNear`. */
const MIN_PARCEL_SQM = 25;
/** Share of building-grey pixels above which a region is a building. */
const BUILDING_SHARE = 0.6;
/** Distance in pixels across which two regions share a line. */
const LINE_REACH_PX = 2;
/** Douglas-Peucker tolerance for the traced outline, in metres. */
const SIMPLIFY_M = 0.4;

export interface MapBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

type PixelClass = "line" | "building" | ParcelUse;

/**
 * What a pixel of the coloured parcel map shows. Verified against the
 * land-use map of the same service on 13 November 2026: white is traffic
 * area (395,747 of 395,919 pixels), light grey industry and trade, pink
 * housing, green vegetation; buildings are a darker grey than any ground.
 */
export function classifyMapPixel(r: number, g: number, b: number): PixelClass {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max < 120) return "line";
  if (max - min <= 6) {
    if (min >= 250) return "traffic";
    if (min >= 238) return "commercial";
    return "building";
  }
  if (r > g + 12 && r > b + 12) return "residential";
  if (g >= r && g > b) return "open";
  if (b > r && b > g) return "open";
  return "other";
}

const USES: ParcelUse[] = [
  "traffic",
  "commercial",
  "mixed",
  "residential",
  "open",
  "other",
];

interface Region {
  pixels: number;
  building: number;
  use: number[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Parcels from the pixels of the coloured parcel map (RGBA, row-major from
 * the north-west corner of `box`).
 */
export function parcelsFromParcelMap(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  box: MapBox,
): ParcelFeature[] {
  const size = width * height;
  const cls = new Uint8Array(size); // 0 line, 1 building, 2.. = USES index + 2
  let lines = 0;
  for (let i = 0; i < size; i += 1) {
    const kind = classifyMapPixel(
      rgba[i * 4],
      rgba[i * 4 + 1],
      rgba[i * 4 + 2],
    );
    if (kind === "line") lines += 1;
    else cls[i] = kind === "building" ? 1 : USES.indexOf(kind) + 2;
  }
  // A blank map (outside Bayern, or the service drew nothing) has no lines.
  if (lines === 0) return [];

  // 1. Regions: 4-connected areas between the lines.
  const label = new Int32Array(size);
  const regions: Region[] = [];
  const stack: number[] = [];
  for (let start = 0; start < size; start += 1) {
    if (cls[start] === 0 || label[start] !== 0) continue;
    const id = regions.length + 1;
    const region: Region = {
      pixels: 0,
      building: 0,
      use: USES.map(() => 0),
      minX: width,
      minY: height,
      maxX: 0,
      maxY: 0,
    };
    label[start] = id;
    stack.push(start);
    while (stack.length > 0) {
      const index = stack.pop()!;
      const x = index % width;
      const y = (index - x) / width;
      region.pixels += 1;
      if (cls[index] === 1) region.building += 1;
      else region.use[cls[index] - 2] += 1;
      if (x < region.minX) region.minX = x;
      if (x > region.maxX) region.maxX = x;
      if (y < region.minY) region.minY = y;
      if (y > region.maxY) region.maxY = y;
      if (x > 0 && cls[index - 1] !== 0 && label[index - 1] === 0) {
        label[index - 1] = id;
        stack.push(index - 1);
      }
      if (x < width - 1 && cls[index + 1] !== 0 && label[index + 1] === 0) {
        label[index + 1] = id;
        stack.push(index + 1);
      }
      if (y > 0 && cls[index - width] !== 0 && label[index - width] === 0) {
        label[index - width] = id;
        stack.push(index - width);
      }
      if (
        y < height - 1 &&
        cls[index + width] !== 0 &&
        label[index + width] === 0
      ) {
        label[index + width] = id;
        stack.push(index + width);
      }
    }
    regions.push(region);
  }

  // 2. Lines shared between regions, counted per pair.
  const contact = new Map<number, Map<number, number>>();
  const touch = (a: number, b: number): void => {
    if (a === 0 || b === 0 || a === b) return;
    for (const [p, q] of [
      [a, b],
      [b, a],
    ]) {
      let row = contact.get(p);
      if (!row) {
        row = new Map();
        contact.set(p, row);
      }
      row.set(q, (row.get(q) ?? 0) + 1);
    }
  };
  const nearest = (index: number, step: number, limit: number): number => {
    for (let k = 1; k <= LINE_REACH_PX; k += 1) {
      if (k > limit) return 0;
      const id = label[index + k * step];
      if (id !== 0) return id;
    }
    return 0;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (cls[index] !== 0) continue;
      touch(nearest(index, -1, x), nearest(index, 1, width - 1 - x));
      touch(nearest(index, -width, y), nearest(index, width, height - 1 - y));
    }
  }

  // 3. Buildings merge into the ground region they share the longest line
  // with; a road is taken only when nothing else borders the building.
  const isBuilding = regions.map(
    (region) => region.building >= BUILDING_SHARE * region.pixels,
  );
  const owner = regions.map((_, i) => i + 1);
  const dominant = (region: Region): ParcelUse =>
    USES[region.use.indexOf(Math.max(...region.use))];
  for (let pass = 0; pass < 4; pass += 1) {
    let changed = false;
    regions.forEach((_, i) => {
      const id = i + 1;
      if (!isBuilding[i] || owner[i] !== id) return;
      let best = 0;
      let bestScore = 0;
      for (const [other, count] of contact.get(id) ?? []) {
        const ground = owner[other - 1];
        // Only ground, or a building that already found its ground.
        if (isBuilding[ground - 1]) continue;
        const road = dominant(regions[ground - 1]) === "traffic";
        const score = road ? count * 0.01 : count;
        if (score > bestScore) {
          bestScore = score;
          best = ground;
        }
      }
      if (best !== 0) {
        owner[i] = best;
        changed = true;
      }
    });
    if (!changed) break;
  }

  // 4. One parcel per ground region (and per building left on its own).
  const groups = new Map<number, number[]>();
  owner.forEach((ground, i) => {
    groups.set(ground, [...(groups.get(ground) ?? []), i + 1]);
  });
  const lonPerPx = (box.east - box.west) / width;
  const latPerPx = (box.north - box.south) / height;
  const minPixels = MIN_PARCEL_SQM / (PIXEL_M * PIXEL_M);
  const parcels: ParcelFeature[] = [];
  for (const [ground, ids] of groups) {
    const members = ids.map((id) => regions[id - 1]);
    const pixels = members.reduce((sum, region) => sum + region.pixels, 0);
    if (pixels < minPixels) continue;
    // Crop with a margin for the half line added on each side.
    const minX = Math.max(0, Math.min(...members.map((m) => m.minX)) - 2);
    const minY = Math.max(0, Math.min(...members.map((m) => m.minY)) - 2);
    const maxX = Math.min(
      width - 1,
      Math.max(...members.map((m) => m.maxX)) + 2,
    );
    const maxY = Math.min(
      height - 1,
      Math.max(...members.map((m) => m.maxY)) + 2,
    );
    const cols = maxX - minX + 1;
    const rows = maxY - minY + 1;
    const own = new Set(ids);
    const mask = new Uint8Array(cols * rows);
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const index = y * width + x;
        let hit = own.has(label[index]);
        // The line itself: half of it belongs to each side.
        if (!hit && cls[index] === 0) {
          hit =
            (x > 0 && own.has(label[index - 1])) ||
            (x < width - 1 && own.has(label[index + 1])) ||
            (y > 0 && own.has(label[index - width])) ||
            (y < height - 1 && own.has(label[index + width]));
        }
        if (hit) mask[(y - minY) * cols + (x - minX)] = 1;
      }
    }
    const traced = maskToRings(
      { origin: [0, 0], resolutionM: PIXEL_M, cols, rows },
      mask,
    );
    let outer = traced[0];
    for (const ring of traced) {
      if (Math.abs(area2D(ring)) > Math.abs(area2D(outer))) outer = ring;
    }
    if (!outer || outer.length < 4) continue;
    const ring: LonLat[] = simplifyRing(outer, SIMPLIFY_M / PIXEL_M).map(
      ([x, y]) => [
        box.west + (minX + x) * lonPerPx,
        box.north - (minY + y) * latPerPx,
      ],
    );
    const areaSqm = ringAreaSqm(ring);
    if (areaSqm < MIN_PARCEL_SQM) continue;
    const groundRegion = regions[ground - 1];
    const groundPixels = groundRegion.use.reduce((sum, n) => sum + n, 0);
    const landUse: ParcelLandUse = {};
    if (groundPixels > 0 && !isBuilding[ground - 1]) {
      groundRegion.use.forEach((count, i) => {
        if (count > 0) landUse[USES[i]] = count / groundPixels;
      });
    }
    parcels.push({
      ring,
      areaSqm,
      state: BAVARIA_PARCEL_STATE,
      ...(Object.keys(landUse).length > 0 ? { landUse } : {}),
    });
  }
  return parcels;
}

/** Bounding box of `radiusM` around the point, in degrees. */
function boxAround(lat: number, lon: number, radiusM: number): MapBox {
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  return {
    west: lon - dLon,
    south: lat - dLat,
    east: lon + dLon,
    north: lat + dLat,
  };
}

const inFlight = new Map<string, Promise<ParcelFeature[] | null>>();

/**
 * Parcels around a point in Bayern, read from the parcel map. Null outside
 * Bayern's rough outline and when the service fails; an empty list when the
 * map is blank there.
 */
export function bavariaParcelsNear(
  lat: number,
  lon: number,
  radiusM: number = BAVARIA_PARCEL_RADIUS_M,
): Promise<ParcelFeature[] | null> {
  if (!isInBavariaBox(lat, lon)) return Promise.resolve(null);
  const key = `byparcels:v${CACHE_VERSION}:${radiusM}:${lat.toFixed(4)},${lon.toFixed(4)}`;
  const hit = cacheGet<ParcelFeature[]>(key);
  if (hit) return Promise.resolve(hit);
  const pending = inFlight.get(key);
  if (pending) return pending;
  const request = (async (): Promise<ParcelFeature[] | null> => {
    const box = boxAround(lat, lon, radiusM);
    const size = Math.round((2 * radiusM) / PIXEL_M);
    const url =
      `${BAVARIA_PARCEL_WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap` +
      `&LAYERS=${BAVARIA_PARCEL_LAYER}&STYLES=&CRS=EPSG:4326` +
      // WMS 1.3.0 with EPSG:4326: latitude first.
      `&BBOX=${box.south},${box.west},${box.north},${box.east}` +
      `&WIDTH=${size}&HEIGHT=${size}&FORMAT=image/png&TRANSPARENT=FALSE`;
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
      const { data, info } = await sharp(Buffer.from(await res.arrayBuffer()))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const parcels = parcelsFromParcelMap(data, info.width, info.height, box);
      cacheSet(key, parcels, CACHE_TTL_MS);
      return parcels;
    } catch {
      // A failed request says nothing about the place: not cached.
      return null;
    }
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}
