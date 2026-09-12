import type { BoundaryResult, Polygon } from "@shared/types";
import type { RiskParameters } from "@shared/types";
import { cached, TTL } from "./cache.service";
import { polygonAreaSqm } from "./geo-math";
import { checkRing, type LonLat } from "./boundary-geometry";
import { aerialImageForBbox } from "./tiles.service";

/**
 * Low-confidence, deterministic aerial-surface baseline. It identifies large
 * connected, grey paved regions and returns them as a reviewable candidate.
 * A trained segmentation model can replace this adapter without changing the
 * boundary contract; the provider is intentionally never treated as proof.
 */
export async function fromAerialSurface(
  lat: number,
  lon: number,
  context?: { parameters?: RiskParameters },
): Promise<BoundaryResult | null> {
  const searchRadiusM = Math.max(
    220,
    (context?.parameters?.syntheticBoundaryRadiusM ?? 100) * 2.2,
  );
  // Version the cache key whenever segmentation/search logic changes so old
  // clipped hulls cannot silently survive a new application build.
  const key = `aerial-surface:v2:${Math.round(searchRadiusM)}:${lat.toFixed(5)},${lon.toFixed(5)}`;
  return cached(key, TTL.buildings, async () => {
    // Search beyond the current parcel candidate. Dealership operations often
    // span multiple cadastral parcels and multiple paved bays separated by
    // narrow lanes/green strips. A one-tile/one-parcel crop systematically
    // clips those areas.
    const halfLat = searchRadiusM / 111_320;
    const halfLon = searchRadiusM /
      (111_320 * Math.cos((lat * Math.PI) / 180));
    const bbox: [number, number, number, number] = [
      lon - halfLon,
      lat - halfLat,
      lon + halfLon,
      lat + halfLat,
    ];
    const image = await aerialImageForBbox(bbox);
    if (!image.rgba || image.validTileCount === 0) return null;
    const component = aggregatePavedSite(
      image.rgba,
      image.width,
      image.height,
      image.width / 2,
      image.height / 2,
      (image.lonSpan * 111_320 * Math.cos((lat * Math.PI) / 180)) / image.width,
    );
    if (component.length < 120) return null;
    const ring = convexHull(
      component.map(([x, y]) => pixelToLonLat(x, y, image)),
    );
    const check = checkRing(ring, { minAreaSqm: 250, maxAreaSqm: 250_000 });
    if (!check.valid) return null;
    const confidence = Math.min(
      0.62,
      0.32 + Math.min(0.3, component.length / 8_000),
    );
    return {
      source: "aerial",
      role: "parkingSurface",
      provider: "aerial:paved-surface-baseline",
      polygon: { type: "Polygon", coordinates: [ring] } as Polygon,
      areaSqm: polygonAreaSqm(ring),
      confidence,
      label: "Aerial paved-surface candidate",
      evidence: {
        source: "Esri/WMS aerial imagery",
        retrievedAt: new Date().toISOString(),
        method:
          "connected-component paved-surface baseline; replace with trained segmentation model",
        confidence,
        fallbackUsed: true,
        limitations: [
          "Colour heuristic can include roads, roofs and other grey surfaces",
          "Requires visual review before underwriting",
        ],
      },
    };
  });
}

interface PixelComponent {
  points: Array<[number, number]>;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  centerX: number;
  centerY: number;
}

/**
 * Returns the site footprint rather than only one connected component.
 * Orthophotos commonly split a dealership into several paved islands because
 * of shadows, planting strips, loading lanes or parked vehicles. Components
 * close to the reference point are therefore merged before the hull is built.
 */
function aggregatePavedSite(
  rgba: Uint8Array,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  metersPerPixel: number,
): Array<[number, number]> {
  const step = 4;
  const cols = Math.floor(width / step);
  const rows = Math.floor(height / step);
  const mask = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const px = (y * step * width + x * step) * 4;
      const r = rgba[px];
      const g = rgba[px + 1];
      const b = rgba[px + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const green = g > r * 1.12 && g > b * 1.05;
      // Use a wider neutral-colour range than the old fixed threshold. This
      // retains shaded asphalt and bright concrete while still rejecting
      // vegetation and strongly coloured roofs/cars.
      mask[y * cols + x] =
        max - min <= 48 && max >= 42 && max <= 238 && !green ? 1 : 0;
    }
  }
  const seen = new Uint8Array(mask.length);
  const components: PixelComponent[] = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const index = y * cols + x;
      if (!mask[index] || seen[index]) continue;
      const queue: Array<[number, number]> = [[x, y]];
      const component: Array<[number, number]> = [];
      seen[index] = 1;
      while (queue.length > 0) {
        const current = queue.pop()!;
        component.push([current[0] * step, current[1] * step]);
        for (const [dx, dy] of NEIGHBOURS) {
          const nx = current[0] + dx;
          const ny = current[1] + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const neighbour = ny * cols + nx;
          if (mask[neighbour] && !seen[neighbour]) {
            seen[neighbour] = 1;
            queue.push([nx, ny]);
          }
        }
      }
      const minX = Math.min(...component.map(([pointX]) => pointX));
      const minY = Math.min(...component.map(([, pointY]) => pointY));
      const maxX = Math.max(...component.map(([pointX]) => pointX));
      const maxY = Math.max(...component.map(([, pointY]) => pointY));
      const meanX =
        component.reduce((sum, [pointX]) => sum + pointX, 0) / component.length;
      const meanY =
        component.reduce((sum, [, pointY]) => sum + pointY, 0) /
        component.length;
      components.push({
        points: component,
        minX,
        minY,
        maxX,
        maxY,
        centerX: meanX,
        centerY: meanY,
      });
    }
  }
  if (components.length === 0) return [];

  const maxSiteDistancePx = 260 / metersPerPixel;
  const primary = components
    .map((component) => {
      const centerDistance = Math.hypot(
        component.centerX - centerX,
        component.centerY - centerY,
      );
      const edgeDistance = distanceToBoxPx(
        centerX,
        centerY,
        component.minX,
        component.minY,
        component.maxX,
        component.maxY,
      );
      return {
        component,
        score:
          (edgeDistance === 0 ? 2 : 1) *
          component.points.length /
          (1 + centerDistance / Math.max(1, 180 / metersPerPixel)),
      };
    })
    .sort((a, b) => b.score - a.score)[0]?.component;
  if (!primary) return [];

  const selected = components.filter((component) => {
    const centerDistance = Math.hypot(
      component.centerX - primary.centerX,
      component.centerY - primary.centerY,
    );
    const gap = boxGapPx(primary, component);
    const fromReference = distanceToBoxPx(
      centerX,
      centerY,
      component.minX,
      component.minY,
      component.maxX,
      component.maxY,
    );
    return (
      component === primary ||
      (component.points.length >= 12 &&
        fromReference <= maxSiteDistancePx &&
        (gap <= 55 / metersPerPixel || centerDistance <= 145 / metersPerPixel))
    );
  });
  return selected.flatMap((component) => component.points);
}

function distanceToBoxPx(
  x: number,
  y: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): number {
  const dx = x < minX ? minX - x : x > maxX ? x - maxX : 0;
  const dy = y < minY ? minY - y : y > maxY ? y - maxY : 0;
  return Math.hypot(dx, dy);
}

function boxGapPx(a: PixelComponent, b: PixelComponent): number {
  return distanceToBoxPx(
    Math.max(a.minX, Math.min(b.centerX, a.maxX)),
    Math.max(a.minY, Math.min(b.centerY, a.maxY)),
    b.minX,
    b.minY,
    b.maxX,
    b.maxY,
  );
}

const NEIGHBOURS: Array<[number, number]> = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

function pixelToLonLat(
  x: number,
  y: number,
  image: {
    originLon: number;
    originLat: number;
    lonSpan: number;
    latSpan: number;
    width: number;
    height: number;
  },
): LonLat {
  return [
    image.originLon + (x / image.width) * image.lonSpan,
    image.originLat - (y / image.height) * image.latSpan,
  ];
}

function convexHull(points: LonLat[]): LonLat[] {
  const unique = Array.from(
    new Map(
      points.map((point) => [
        `${point[0].toFixed(8)}:${point[1].toFixed(8)}`,
        point,
      ]),
    ).values(),
  ).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (unique.length < 3) return [...unique, unique[0]] as LonLat[];
  const cross = (o: LonLat, a: LonLat, b: LonLat): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: LonLat[] = [];
  for (const point of unique) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, point) <= 0)
      lower.pop();
    lower.push(point);
  }
  const upper: LonLat[] = [];
  for (const point of [...unique].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, point) <= 0)
      upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper, lower[0]];
}
