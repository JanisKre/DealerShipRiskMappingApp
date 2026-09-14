import {
  projectPoint,
  unprojectPoint,
  type LonLat,
} from "../boundary-geometry";

/**
 * The metric evidence raster the boundary engine reasons in.
 *
 * Every source — cadastral parcels, OSM areas and lines, aerial masks, detected
 * vehicles — is rasterized into one shared grid so they can be *combined*
 * rather than ranked against each other. A dealership site is normally the
 * union of several parcels and paved bays bounded by roads and fences, which is
 * a shape no single source publishes.
 *
 * The grid is a local tangent plane about `origin`, using the same fixed
 * cos(lat) as `projectPoint`/`unprojectPoint`. Over a few hundred metres that
 * is accurate to centimetres, and it keeps the cells isotropic — distance and
 * angle comparisons stay meaningful, which they are not in raw lon/lat.
 *
 * Row 0 is the northern edge, matching image convention.
 */
export interface GridSpec {
  /** Geographic centre of the grid. */
  origin: LonLat;
  /** Edge length of one square cell, in metres. */
  resolutionM: number;
  cols: number;
  rows: number;
}

export interface EvidenceGrid {
  spec: GridSpec;
  /** Signed evidence per cell; positive pulls the boundary out, negative in. */
  score: Float32Array;
  /** 1 = impassable. Fences, walls, roads and water cut growth here. */
  blocked: Uint8Array;
}

export interface CellRef {
  col: number;
  row: number;
}

/** Half the grid's width in metres, derived from the cell count. */
export function halfSpanM(spec: GridSpec): number {
  return (spec.cols * spec.resolutionM) / 2;
}

export function createGridSpec(
  origin: LonLat,
  resolutionM: number,
  extentM: number,
): GridSpec {
  if (!(resolutionM > 0)) throw new Error("resolutionM must be positive");
  if (!(extentM > 0)) throw new Error("extentM must be positive");
  const cols = Math.max(1, Math.ceil(extentM / resolutionM));
  return { origin, resolutionM, cols, rows: cols };
}

export function createGrid(
  origin: LonLat,
  resolutionM: number,
  extentM: number,
): EvidenceGrid {
  const spec = createGridSpec(origin, resolutionM, extentM);
  const cells = spec.cols * spec.rows;
  return {
    spec,
    score: new Float32Array(cells),
    blocked: new Uint8Array(cells),
  };
}

export function cellCount(spec: GridSpec): number {
  return spec.cols * spec.rows;
}

export function cellIndex(spec: GridSpec, col: number, row: number): number {
  return row * spec.cols + col;
}

export function isInside(spec: GridSpec, col: number, row: number): boolean {
  return col >= 0 && row >= 0 && col < spec.cols && row < spec.rows;
}

/** Fractional cell coordinates; useful for rasterization, may fall outside. */
export function lonLatToCellF(
  spec: GridSpec,
  point: LonLat,
): { col: number; row: number } {
  const [x, y] = projectPoint(point, spec.origin);
  const half = halfSpanM(spec);
  return {
    col: (x + half) / spec.resolutionM,
    row: (half - y) / spec.resolutionM,
  };
}

/** Integer cell containing `point`, or null when it lies outside the grid. */
export function lonLatToCell(spec: GridSpec, point: LonLat): CellRef | null {
  const { col, row } = lonLatToCellF(spec, point);
  const c = Math.floor(col);
  const r = Math.floor(row);
  return isInside(spec, c, r) ? { col: c, row: r } : null;
}

/** Geographic position of a cell's centre. */
export function cellToLonLat(
  spec: GridSpec,
  col: number,
  row: number,
): LonLat {
  const half = halfSpanM(spec);
  return unprojectPoint(
    [
      (col + 0.5) * spec.resolutionM - half,
      half - (row + 0.5) * spec.resolutionM,
    ],
    spec.origin,
  );
}

/** Metric offset (east, north) of a cell centre from the grid origin. */
export function cellToOffset(
  spec: GridSpec,
  col: number,
  row: number,
): [number, number] {
  const half = halfSpanM(spec);
  return [
    (col + 0.5) * spec.resolutionM - half,
    half - (row + 0.5) * spec.resolutionM,
  ];
}

/**
 * Metric offset of a cell *corner*. Contours run along cell edges, so they are
 * expressed in corner coordinates: a `cols x rows` grid has
 * `(cols + 1) x (rows + 1)` corners.
 */
export function cornerToOffset(
  spec: GridSpec,
  cornerX: number,
  cornerY: number,
): [number, number] {
  const half = halfSpanM(spec);
  return [
    cornerX * spec.resolutionM - half,
    half - cornerY * spec.resolutionM,
  ];
}

export function maskAreaSqm(spec: GridSpec, mask: Uint8Array): number {
  let set = 0;
  for (let i = 0; i < mask.length; i += 1) if (mask[i]) set += 1;
  return set * spec.resolutionM * spec.resolutionM;
}

/**
 * Intersection over union of two masks on the same grid.
 *
 * Unlike `approximatePolygonIoU`, this does not clamp to a fixed 200x200 sample
 * grid, so it stays meaningful at the metre tolerances the boundary benchmark
 * reports against.
 */
export function rasterIoU(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) throw new Error("masks have different sizes");
  let intersection = 0;
  let union = 0;
  for (let i = 0; i < a.length; i += 1) {
    const inA = a[i] !== 0;
    const inB = b[i] !== 0;
    if (inA && inB) intersection += 1;
    if (inA || inB) union += 1;
  }
  return union === 0 ? 0 : intersection / union;
}

/** Share of `reference` covered by `predicted` — recall, not symmetric. */
export function rasterCoverage(
  reference: Uint8Array,
  predicted: Uint8Array,
): number {
  if (reference.length !== predicted.length) {
    throw new Error("masks have different sizes");
  }
  let referenceCells = 0;
  let covered = 0;
  for (let i = 0; i < reference.length; i += 1) {
    if (!reference[i]) continue;
    referenceCells += 1;
    if (predicted[i]) covered += 1;
  }
  return referenceCells === 0 ? 0 : covered / referenceCells;
}
