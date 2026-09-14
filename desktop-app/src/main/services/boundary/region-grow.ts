import type { BoundaryGrowthStop } from "@shared/types";
import {
  cellIndex,
  isInside,
  maskAreaSqm,
  type CellRef,
  type EvidenceGrid,
  type GridSpec,
} from "./grid";
import { dilate, erode } from "./rasterize";

/**
 * Seeded region growing over the evidence grid.
 *
 * This is the step that replaces "rank the candidates and take the best one".
 * Instead of choosing between a parcel, a parking polygon and a building, the
 * region grows outwards from the site anchor through whatever the evidence
 * supports, and stops where a fence, a road or an absence of evidence says to.
 *
 * **4-connected throughout, deliberately.** Barriers are rasterized as
 * one-cell-wide 4-connected chains; growing with 8-connectivity would step
 * diagonally through those chains and silently defeat every fence and road in
 * the model. The two must agree, and 4 is the safe pairing.
 */

export interface GrowOptions {
  /** A region must contain at least one cell this strong to be believed. */
  highThreshold: number;
  /** Growth continues through anything at least this strong. */
  lowThreshold: number;
  maxAreaSqm: number;
  maxRadiusM: number;
}

export interface GrowResult {
  mask: Uint8Array;
  seed: CellRef;
  areaSqm: number;
  /** Anything but "exhausted" means a cap truncated the site, not the evidence. */
  stoppedBy: BoundaryGrowthStop;
  /** False when nothing in the region rose above `highThreshold`. */
  confirmed: boolean;
}

const NEIGHBOURS_4: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Best starting cell within `anchorRadiusM` of the grid centre.
 *
 * The geocoded point often lands on the street or on a neighbouring roof, so
 * the seed is allowed to move — but only the seed. The grid origin stays put,
 * because moving it would change every downstream cache key.
 */
export function pickSeed(
  grid: EvidenceGrid,
  anchorRadiusM: number,
  options: Pick<GrowOptions, "highThreshold" | "lowThreshold">,
): CellRef | null {
  const { spec, score, blocked } = grid;
  const centreCol = Math.floor(spec.cols / 2);
  const centreRow = Math.floor(spec.rows / 2);
  const radiusCells = Math.max(1, Math.round(anchorRadiusM / spec.resolutionM));

  let best: CellRef | null = null;
  let bestScore = -Infinity;
  for (
    let row = Math.max(0, centreRow - radiusCells);
    row <= Math.min(spec.rows - 1, centreRow + radiusCells);
    row += 1
  ) {
    for (
      let col = Math.max(0, centreCol - radiusCells);
      col <= Math.min(spec.cols - 1, centreCol + radiusCells);
      col += 1
    ) {
      const dc = col - centreCol;
      const dr = row - centreRow;
      if (dc * dc + dr * dr > radiusCells * radiusCells) continue;
      const index = cellIndex(spec, col, row);
      if (blocked[index]) continue;
      if (score[index] < options.highThreshold) continue;
      // Ties break towards the anchor: a cell as good as another but nearer the
      // geocoded point is the more defensible place to start.
      const value = score[index] - (dc * dc + dr * dr) * 1e-6;
      if (value > bestScore) {
        bestScore = value;
        best = { col, row };
      }
    }
  }
  if (best) return best;

  // Nothing strong nearby: fall back to the anchor cell itself if it is at all
  // supported. `growRegion` will report the region as unconfirmed.
  const centreIndex = cellIndex(spec, centreCol, centreRow);
  if (!blocked[centreIndex] && score[centreIndex] >= options.lowThreshold) {
    return { col: centreCol, row: centreRow };
  }
  return null;
}

export function growRegion(
  grid: EvidenceGrid,
  seed: CellRef,
  options: GrowOptions,
): GrowResult {
  const { spec, score, blocked } = grid;
  const mask = new Uint8Array(spec.cols * spec.rows);
  const seedIndex = cellIndex(spec, seed.col, seed.row);

  if (blocked[seedIndex] || score[seedIndex] < options.lowThreshold) {
    return { mask, seed, areaSqm: 0, stoppedBy: "exhausted", confirmed: false };
  }

  const cellAreaSqm = spec.resolutionM * spec.resolutionM;
  const maxCells = Math.max(1, Math.floor(options.maxAreaSqm / cellAreaSqm));
  const maxRadiusCells = options.maxRadiusM / spec.resolutionM;
  const maxRadiusSq = maxRadiusCells * maxRadiusCells;

  let confirmed = score[seedIndex] >= options.highThreshold;
  let stoppedBy: BoundaryGrowthStop = "exhausted";
  let count = 1;
  mask[seedIndex] = 1;

  // Index-based queue with a read head: an array shift() would make this
  // quadratic on a 640k-cell grid.
  const queue = new Int32Array(spec.cols * spec.rows);
  queue[0] = seedIndex;
  let head = 0;
  let tail = 1;

  while (head < tail) {
    const index = queue[head++];
    const col = index % spec.cols;
    const row = (index - col) / spec.cols;

    for (const [dc, dr] of NEIGHBOURS_4) {
      const nextCol = col + dc;
      const nextRow = row + dr;
      if (!isInside(spec, nextCol, nextRow)) continue;
      const nextIndex = cellIndex(spec, nextCol, nextRow);
      if (mask[nextIndex] || blocked[nextIndex]) continue;
      if (score[nextIndex] < options.lowThreshold) continue;

      const rc = nextCol - seed.col;
      const rr = nextRow - seed.row;
      if (rc * rc + rr * rr > maxRadiusSq) {
        stoppedBy = "radiusCap";
        continue;
      }

      mask[nextIndex] = 1;
      count += 1;
      if (score[nextIndex] >= options.highThreshold) confirmed = true;
      if (count >= maxCells) {
        return {
          mask,
          seed,
          areaSqm: count * cellAreaSqm,
          stoppedBy: "areaCap",
          confirmed,
        };
      }
      queue[tail++] = nextIndex;
    }
  }

  return { mask, seed, areaSqm: count * cellAreaSqm, stoppedBy, confirmed };
}

/**
 * Morphological closing: bridges the gaps that split one lot into fragments —
 * shadow lines between parked rows, kerbs, planting strips.
 */
export function closeMask(
  spec: GridSpec,
  mask: Uint8Array,
  radiusCells: number,
): Uint8Array {
  return erode(spec, dilate(spec, mask, radiusCells), radiusCells);
}

/**
 * Fills enclosed voids up to `maxHoleSqm` — a showroom, a planting island and a
 * covered bay are all part of the lot.
 *
 * Larger voids are left open. The polygon that is eventually produced carries
 * only an outer ring, so callers must take the site area from the **mask**, not
 * from the ring, or an unfilled void would be silently counted as lot.
 */
export function fillHoles(
  spec: GridSpec,
  mask: Uint8Array,
  maxHoleSqm: number,
): Uint8Array {
  const { cols, rows } = spec;
  const total = cols * rows;
  const out = Uint8Array.from(mask);
  const visited = new Uint8Array(total);
  const cellAreaSqm = spec.resolutionM * spec.resolutionM;
  const queue = new Int32Array(total);

  for (let start = 0; start < total; start += 1) {
    if (mask[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    let touchesBorder = false;
    const component: number[] = [];

    while (head < tail) {
      const index = queue[head++];
      component.push(index);
      const col = index % cols;
      const row = (index - col) / cols;
      if (col === 0 || row === 0 || col === cols - 1 || row === rows - 1) {
        touchesBorder = true;
      }
      for (const [dc, dr] of NEIGHBOURS_4) {
        const nextCol = col + dc;
        const nextRow = row + dr;
        if (!isInside(spec, nextCol, nextRow)) continue;
        const nextIndex = cellIndex(spec, nextCol, nextRow);
        if (visited[nextIndex] || mask[nextIndex]) continue;
        visited[nextIndex] = 1;
        queue[tail++] = nextIndex;
      }
    }

    if (touchesBorder) continue;
    if (component.length * cellAreaSqm > maxHoleSqm) continue;
    for (const index of component) out[index] = 1;
  }
  return out;
}

/**
 * Extends the mask onto the barrier cells that bound it, so the polygon runs
 * *on* the fence rather than half a cell inside it.
 */
export function reclaimBarrierCells(
  spec: GridSpec,
  mask: Uint8Array,
  blocked: Uint8Array,
): Uint8Array {
  const out = Uint8Array.from(mask);
  const { cols, rows } = spec;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const index = cellIndex(spec, col, row);
      if (mask[index] || !blocked[index]) continue;
      for (const [dc, dr] of NEIGHBOURS_4) {
        const nextCol = col + dc;
        const nextRow = row + dr;
        if (!isInside(spec, nextCol, nextRow)) continue;
        if (mask[cellIndex(spec, nextCol, nextRow)]) {
          out[index] = 1;
          break;
        }
      }
    }
  }
  return out;
}

/** Keeps only the largest 4-connected component. Defensive, after closing. */
export function largestComponent(
  spec: GridSpec,
  mask: Uint8Array,
): Uint8Array {
  const total = spec.cols * spec.rows;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let best: number[] = [];

  for (let start = 0; start < total; start += 1) {
    if (!mask[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    const component: number[] = [];
    while (head < tail) {
      const index = queue[head++];
      component.push(index);
      const col = index % spec.cols;
      const row = (index - col) / spec.cols;
      for (const [dc, dr] of NEIGHBOURS_4) {
        const nextCol = col + dc;
        const nextRow = row + dr;
        if (!isInside(spec, nextCol, nextRow)) continue;
        const nextIndex = cellIndex(spec, nextCol, nextRow);
        if (visited[nextIndex] || !mask[nextIndex]) continue;
        visited[nextIndex] = 1;
        queue[tail++] = nextIndex;
      }
    }
    if (component.length > best.length) best = component;
  }

  const out = new Uint8Array(total);
  for (const index of best) out[index] = 1;
  return out;
}

/** Convenience: mask area in m², for callers that only have the mask. */
export function areaOf(spec: GridSpec, mask: Uint8Array): number {
  return maskAreaSqm(spec, mask);
}
