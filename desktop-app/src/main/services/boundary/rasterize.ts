import type { Polygon } from "@shared/types";
import type { LonLat } from "../boundary-geometry";
import {
  cellIndex,
  createGridSpec,
  halfSpanM,
  isInside,
  lonLatToCellF,
  type GridSpec,
} from "./grid";

/**
 * Rasterization primitives for the evidence grid.
 *
 * All of these work in *cell* space after a single projection pass, so they are
 * isotropic and free of the latitude distortion that makes lon/lat comparisons
 * unreliable. Each returns the number of cells it touched, which the fusion
 * layer records per source so a reviewer can tell "queried and contributed
 * nothing" from "never queried".
 */

type CellXY = { col: number; row: number };

function toCells(spec: GridSpec, ring: readonly LonLat[]): CellXY[] {
  return ring.map((point) => lonLatToCellF(spec, point));
}

/**
 * Even-odd scanline fill. Samples each row at its centre and uses the
 * half-open rule `(y0 <= y) !== (y1 <= y)` so a vertex lying exactly on a
 * scanline is counted once rather than twice.
 */
function scanlineFill(
  spec: GridSpec,
  ring: readonly LonLat[],
  visit: (index: number) => void,
): number {
  if (ring.length < 3) return 0;
  const points = toCells(spec, ring);
  // Tolerate an unclosed ring; the fill is defined by the implied closing edge.
  if (
    points.length > 1 &&
    (points[0].col !== points[points.length - 1].col ||
      points[0].row !== points[points.length - 1].row)
  ) {
    points.push(points[0]);
  }

  let minRow = Infinity;
  let maxRow = -Infinity;
  for (const p of points) {
    if (p.row < minRow) minRow = p.row;
    if (p.row > maxRow) maxRow = p.row;
  }
  const rowStart = Math.max(0, Math.floor(minRow));
  const rowEnd = Math.min(spec.rows - 1, Math.ceil(maxRow));

  let touched = 0;
  const crossings: number[] = [];
  for (let row = rowStart; row <= rowEnd; row += 1) {
    const y = row + 0.5;
    crossings.length = 0;
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      if (a.row <= y === b.row <= y) continue;
      const t = (y - a.row) / (b.row - a.row);
      crossings.push(a.col + t * (b.col - a.col));
    }
    if (crossings.length < 2) continue;
    crossings.sort((p, q) => p - q);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const from = Math.max(0, Math.ceil(crossings[i] - 0.5));
      const to = Math.min(spec.cols - 1, Math.floor(crossings[i + 1] - 0.5));
      for (let col = from; col <= to; col += 1) {
        visit(cellIndex(spec, col, row));
        touched += 1;
      }
    }
  }
  return touched;
}

/** Adds `weight` to every cell inside `ring`. */
export function rasterizePolygon(
  spec: GridSpec,
  ring: readonly LonLat[],
  out: Float32Array,
  weight: number,
): number {
  return scanlineFill(spec, ring, (index) => {
    out[index] += weight;
  });
}

/**
 * Adds `weight` only to cells that already carry positive evidence.
 *
 * For priors that may *corroborate* a site but must never *create* one. A
 * cadastral parcel is the motivating case: it is legal context, and it is
 * routinely larger or smaller than the operational lot. Rasterized as a plain
 * positive it would flood the region out to the parcel edges on its own
 * authority — which is precisely how cadastre-only detection over-shoots.
 *
 * Must be applied after the layers it reinforces.
 */
export function rasterizeReinforcement(
  spec: GridSpec,
  ring: readonly LonLat[],
  out: Float32Array,
  weight: number,
): number {
  let touched = 0;
  scanlineFill(spec, ring, (index) => {
    if (out[index] <= 0) return;
    out[index] += weight;
    touched += 1;
  });
  return touched;
}

/** Sets every cell inside `ring`. Used for parcel masks and benchmark IoU. */
export function rasterizeMaskPolygon(
  spec: GridSpec,
  ring: readonly LonLat[],
  out: Uint8Array,
): number {
  return scanlineFill(spec, ring, (index) => {
    out[index] = 1;
  });
}

function forEachCellNearSegment(
  spec: GridSpec,
  a: CellXY,
  b: CellXY,
  radiusCells: number,
  visit: (col: number, row: number) => void,
): void {
  const minCol = Math.max(0, Math.floor(Math.min(a.col, b.col) - radiusCells - 1));
  const maxCol = Math.min(
    spec.cols - 1,
    Math.ceil(Math.max(a.col, b.col) + radiusCells + 1),
  );
  const minRow = Math.max(0, Math.floor(Math.min(a.row, b.row) - radiusCells - 1));
  const maxRow = Math.min(
    spec.rows - 1,
    Math.ceil(Math.max(a.row, b.row) + radiusCells + 1),
  );
  const dx = b.col - a.col;
  const dy = b.row - a.row;
  const lenSq = dx * dx + dy * dy;
  const radiusSq = radiusCells * radiusCells;
  for (let row = minRow; row <= maxRow; row += 1) {
    for (let col = minCol; col <= maxCol; col += 1) {
      const px = col + 0.5 - a.col;
      const py = row + 0.5 - a.row;
      const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / lenSq));
      const ox = px - t * dx;
      const oy = py - t * dy;
      if (ox * ox + oy * oy <= radiusSq) visit(col, row);
    }
  }
}

/**
 * Buffers a polyline by `halfWidthM` and adds `weight`. Cells covered by more
 * than one segment are written once, so a zig-zag road does not double-score
 * its own corners.
 */
export function rasterizePolyline(
  spec: GridSpec,
  line: readonly LonLat[],
  halfWidthM: number,
  out: Float32Array,
  weight: number,
): number {
  if (line.length < 2) return 0;
  const points = toCells(spec, line);
  const radiusCells = halfWidthM / spec.resolutionM;
  const seen = new Set<number>();
  for (let i = 0; i < points.length - 1; i += 1) {
    forEachCellNearSegment(spec, points[i], points[i + 1], radiusCells, (col, row) => {
      seen.add(cellIndex(spec, col, row));
    });
  }
  for (const index of seen) out[index] += weight;
  return seen.size;
}

export type DiskFalloff = "flat" | "gauss";

/**
 * Stamps a disk of evidence. `gauss` tapers to zero at the rim, which is what
 * a detected vehicle deserves: the car is certainly lot, the metre beyond it
 * only probably is.
 */
export function rasterizeDisk(
  spec: GridSpec,
  centre: LonLat,
  radiusM: number,
  out: Float32Array,
  weight: number,
  falloff: DiskFalloff = "flat",
): number {
  const c = lonLatToCellF(spec, centre);
  const radiusCells = radiusM / spec.resolutionM;
  if (radiusCells <= 0) return 0;
  const minCol = Math.max(0, Math.floor(c.col - radiusCells));
  const maxCol = Math.min(spec.cols - 1, Math.ceil(c.col + radiusCells));
  const minRow = Math.max(0, Math.floor(c.row - radiusCells));
  const maxRow = Math.min(spec.rows - 1, Math.ceil(c.row + radiusCells));
  const radiusSq = radiusCells * radiusCells;
  let touched = 0;
  for (let row = minRow; row <= maxRow; row += 1) {
    for (let col = minCol; col <= maxCol; col += 1) {
      const dx = col + 0.5 - c.col;
      const dy = row + 0.5 - c.row;
      const distSq = dx * dx + dy * dy;
      if (distSq > radiusSq) continue;
      const scale =
        falloff === "flat"
          ? 1
          : Math.exp(-2 * (distSq / radiusSq));
      out[cellIndex(spec, col, row)] += weight * scale;
      touched += 1;
    }
  }
  return touched;
}

/**
 * Marks a polyline's cells impassable.
 *
 * Uses an Amanatides–Woo grid traversal, which crosses one cell edge at a time
 * and therefore produces a **4-connected** chain of cells. That property is the
 * whole point: region growing is 4-connected too, so a one-cell-wide barrier is
 * watertight. A Bresenham line would step diagonally and leak.
 */
export function rasterizeBarrier(
  spec: GridSpec,
  line: readonly LonLat[],
  blocked: Uint8Array,
): number {
  if (line.length < 2) return 0;
  const points = toCells(spec, line);
  let touched = 0;
  const mark = (col: number, row: number): void => {
    if (!isInside(spec, col, row)) return;
    const index = cellIndex(spec, col, row);
    if (blocked[index]) return;
    blocked[index] = 1;
    touched += 1;
  };

  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    let col = Math.floor(a.col);
    let row = Math.floor(a.row);
    const endCol = Math.floor(b.col);
    const endRow = Math.floor(b.row);
    mark(col, row);

    const dCol = b.col - a.col;
    const dRow = b.row - a.row;
    const stepCol = Math.sign(dCol);
    const stepRow = Math.sign(dRow);
    // Parametric distance to the next cell boundary on each axis.
    let tMaxCol =
      stepCol === 0
        ? Infinity
        : ((stepCol > 0 ? col + 1 - a.col : a.col - col) || 1e-12) / Math.abs(dCol);
    let tMaxRow =
      stepRow === 0
        ? Infinity
        : ((stepRow > 0 ? row + 1 - a.row : a.row - row) || 1e-12) / Math.abs(dRow);
    const tDeltaCol = stepCol === 0 ? Infinity : 1 / Math.abs(dCol);
    const tDeltaRow = stepRow === 0 ? Infinity : 1 / Math.abs(dRow);

    // Bounded by the Manhattan distance between start and end cells.
    const maxSteps = Math.abs(endCol - col) + Math.abs(endRow - row);
    for (let step = 0; step < maxSteps; step += 1) {
      if (tMaxCol < tMaxRow) {
        col += stepCol;
        tMaxCol += tDeltaCol;
      } else {
        row += stepRow;
        tMaxRow += tDeltaRow;
      }
      mark(col, row);
    }
  }
  return touched;
}

/** Separable max filter — a square structuring element of radius `radiusCells`. */
export function dilate(
  spec: GridSpec,
  mask: Uint8Array,
  radiusCells: number,
): Uint8Array {
  return separableMorph(spec, mask, radiusCells, "max");
}

/** Separable min filter — the inverse of `dilate` with the same element. */
export function erode(
  spec: GridSpec,
  mask: Uint8Array,
  radiusCells: number,
): Uint8Array {
  return separableMorph(spec, mask, radiusCells, "min");
}

function separableMorph(
  spec: GridSpec,
  mask: Uint8Array,
  radiusCells: number,
  mode: "max" | "min",
): Uint8Array {
  const radius = Math.max(0, Math.round(radiusCells));
  if (radius === 0) return Uint8Array.from(mask);
  const { cols, rows } = spec;
  const horizontal = new Uint8Array(mask.length);
  const wanted = mode === "max" ? 1 : 0;
  const otherwise = mode === "max" ? 0 : 1;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      let value = otherwise;
      const from = Math.max(0, col - radius);
      const to = Math.min(cols - 1, col + radius);
      for (let k = from; k <= to; k += 1) {
        if ((mask[row * cols + k] !== 0 ? 1 : 0) === wanted) {
          value = wanted;
          break;
        }
      }
      // Erosion must treat the area outside the grid as empty, otherwise the
      // border would erode inwards from nothing.
      if (mode === "min" && (col - radius < 0 || col + radius > cols - 1)) {
        value = 0;
      }
      horizontal[row * cols + col] = value;
    }
  }

  const out = new Uint8Array(mask.length);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      let value = otherwise;
      const from = Math.max(0, row - radius);
      const to = Math.min(rows - 1, row + radius);
      for (let k = from; k <= to; k += 1) {
        if ((horizontal[k * cols + col] !== 0 ? 1 : 0) === wanted) {
          value = wanted;
          break;
        }
      }
      if (mode === "min" && (row - radius < 0 || row + radius > rows - 1)) {
        value = 0;
      }
      out[row * cols + col] = value;
    }
  }
  return out;
}

/** Upper bound on grid cells, so a pathological bbox cannot exhaust memory. */
const MAX_IOU_CELLS = 4_000_000;

/**
 * Raster IoU of two polygons at a metric resolution, on a grid sized to cover
 * both. This is the benchmark's metric: `approximatePolygonIoU` clamps to a
 * 200x200 sample grid, which over a 400 m site means 2 m cells — the same
 * magnitude as the boundary tolerance it is meant to score.
 */
export function polygonRasterIoU(
  a: Polygon,
  b: Polygon,
  resolutionM = 0.5,
): number {
  const ringA = a.coordinates[0] as LonLat[];
  const ringB = b.coordinates[0] as LonLat[];
  if (ringA.length < 4 || ringB.length < 4) return 0;
  const { spec } = coveringGrid([ringA, ringB], resolutionM);
  const maskA = new Uint8Array(spec.cols * spec.rows);
  const maskB = new Uint8Array(spec.cols * spec.rows);
  rasterizeMaskPolygon(spec, ringA, maskA);
  rasterizeMaskPolygon(spec, ringB, maskB);
  let intersection = 0;
  let union = 0;
  for (let i = 0; i < maskA.length; i += 1) {
    const inA = maskA[i] !== 0;
    const inB = maskB[i] !== 0;
    if (inA && inB) intersection += 1;
    if (inA || inB) union += 1;
  }
  return union === 0 ? 0 : intersection / union;
}

/**
 * A grid centred on the combined extent of `rings`, coarsened if the requested
 * resolution would exceed the cell budget.
 */
export function coveringGrid(
  rings: ReadonlyArray<readonly LonLat[]>,
  resolutionM: number,
  paddingM = 5,
): { spec: GridSpec } {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  const origin: LonLat = [(minLon + maxLon) / 2, (minLat + maxLat) / 2];
  const cosLat = Math.cos((origin[1] * Math.PI) / 180);
  const widthM = (maxLon - minLon) * 111_320 * cosLat;
  const heightM = (maxLat - minLat) * 111_320;
  const extentM = Math.max(widthM, heightM) + 2 * paddingM;

  let resolution = resolutionM;
  while ((extentM / resolution) ** 2 > MAX_IOU_CELLS) resolution *= 2;
  return { spec: createGridSpec(origin, resolution, extentM) };
}

export { halfSpanM };
