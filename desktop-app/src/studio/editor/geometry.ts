/**
 * Geometry of oriented vehicle boxes on a 640 px tile (0.10 m/px). Boxes are
 * stored as four corners, the format of the autolabel and X-AnyLabeling
 * files; editing goes through an oriented-box form (centre, size, angle).
 */

export type Pt = [number, number];

export interface Obb {
  cx: number;
  cy: number;
  /** Extent along `angle`. */
  w: number;
  /** Extent across `angle`. */
  h: number;
  /** Radians. */
  angle: number;
}

export const TILE_PX = 640;
/** Typical sizes at 0.10 m/px: a car is ~4.6 × 1.9 m, a van or truck ~8 × 2.6 m. */
export const DEFAULT_SIZE = {
  0: { w: 46, h: 19 },
  1: { w: 80, h: 26 },
} as const;

export function toCorners(o: Obb): Pt[] {
  const c = Math.cos(o.angle);
  const s = Math.sin(o.angle);
  const hw = o.w / 2;
  const hh = o.h / 2;
  return (
    [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ] as Pt[]
  ).map(([x, y]) => [o.cx + x * c - y * s, o.cy + x * s + y * c]);
}

export function fromCorners(corners: Pt[]): Obb {
  const [p0, p1, p2] = corners;
  const cx = corners.reduce((a, p) => a + p[0], 0) / corners.length;
  const cy = corners.reduce((a, p) => a + p[1], 0) / corners.length;
  const w = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  const h = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
  return { cx, cy, w, h, angle: Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) };
}

/** Angle of the long axis, in [0, π) — vehicles have no front in a top view. */
export function longAxis(o: Obb): number {
  const a = o.w >= o.h ? o.angle : o.angle + Math.PI / 2;
  return ((a % Math.PI) + Math.PI) % Math.PI;
}

export function area(corners: Pt[]): number {
  let sum = 0;
  for (let i = 0; i < corners.length; i++) {
    const [x1, y1] = corners[i];
    const [x2, y2] = corners[(i + 1) % corners.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

/** Point in a convex polygon, any winding. */
export function contains(corners: Pt[], [x, y]: Pt): boolean {
  let sign = 0;
  for (let i = 0; i < corners.length; i++) {
    const [x1, y1] = corners[i];
    const [x2, y2] = corners[(i + 1) % corners.length];
    const cross = (x2 - x1) * (y - y1) - (y2 - y1) * (x - x1);
    if (cross !== 0) {
      if (sign === 0) sign = Math.sign(cross);
      else if (Math.sign(cross) !== sign) return false;
    }
  }
  return true;
}

/**
 * Index of the box under a point; the smallest wins where boxes overlap, so a
 * car parked inside a large false box can still be picked.
 */
export function hitTest(boxes: { corners: Pt[] }[], p: Pt): number | null {
  let best: number | null = null;
  let bestArea = Infinity;
  boxes.forEach((b, i) => {
    if (contains(b.corners, p)) {
      const a = area(b.corners);
      if (a < bestArea) {
        bestArea = a;
        best = i;
      }
    }
  });
  return best;
}

export function moveBy(corners: Pt[], dx: number, dy: number): Pt[] {
  return corners.map(([x, y]) => [x + dx, y + dy]);
}

export function rotateBy(corners: Pt[], radians: number): Pt[] {
  const o = fromCorners(corners);
  return toCorners({ ...o, angle: o.angle + radians });
}

/** Rotation handle drag: the box turns so that its top edge faces the pointer. */
export function rotateTowards(corners: Pt[], pointer: Pt): Pt[] {
  const o = fromCorners(corners);
  const angle = Math.atan2(pointer[1] - o.cy, pointer[0] - o.cx) + Math.PI / 2;
  return toCorners({ ...o, angle });
}

/** Rotation handle position: above the middle of the top edge (p0–p1). */
export function rotationHandle(corners: Pt[], offset: number): Pt {
  const o = fromCorners(corners);
  const d = o.h / 2 + offset;
  return [o.cx + Math.sin(o.angle) * d, o.cy - Math.cos(o.angle) * d];
}

/**
 * Corner drag: the opposite corner stays where it is, the box keeps its angle.
 * Never smaller than 4 px in either direction.
 */
export function resizeCorner(corners: Pt[], index: number, pointer: Pt): Pt[] {
  const o = fromCorners(corners);
  const c = Math.cos(o.angle);
  const s = Math.sin(o.angle);
  const local = ([x, y]: Pt): Pt => [
    (x - o.cx) * c + (y - o.cy) * s,
    -(x - o.cx) * s + (y - o.cy) * c,
  ];
  const fixed = local(corners[(index + 2) % 4]);
  const moved = local(pointer);
  const w = Math.max(4, Math.abs(moved[0] - fixed[0]));
  const h = Math.max(4, Math.abs(moved[1] - fixed[1]));
  const mx = fixed[0] + Math.sign(moved[0] - fixed[0] || 1) * (w / 2);
  const my = fixed[1] + Math.sign(moved[1] - fixed[1] || 1) * (h / 2);
  const out = toCorners({
    cx: o.cx + mx * c - my * s,
    cy: o.cy + mx * s + my * c,
    w,
    h,
    angle: o.angle,
  });
  return out;
}

/** Axis-aligned box from a drag rectangle (the draw tool). */
export function boxFromDrag(a: Pt, b: Pt): Pt[] {
  const x0 = Math.min(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]);
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

/**
 * A vehicle-sized box at a click, oriented like the nearest boxes (cars on a
 * lot park in rows) and sized like the median box of that class on the tile.
 */
export function boxAtClick(
  p: Pt,
  cls: 0 | 1,
  neighbours: { corners: Pt[]; cls: number }[],
): Pt[] {
  const obbs = neighbours.map((n) => ({
    o: fromCorners(n.corners),
    cls: n.cls,
  }));
  const near = obbs
    .map((n) => ({ ...n, d: Math.hypot(n.o.cx - p[0], n.o.cy - p[1]) }))
    .filter((n) => n.d < 160)
    .sort((a, b) => a.d - b.d)
    .slice(0, 3);
  const angle = near.length
    ? circularMeanAxis(near.map((n) => longAxis(n.o)))
    : 0;
  const same = obbs.filter((n) => n.cls === cls);
  let w: number = DEFAULT_SIZE[cls].w;
  let h: number = DEFAULT_SIZE[cls].h;
  if (same.length >= 3) {
    w = median(same.map((n) => Math.max(n.o.w, n.o.h)));
    h = median(same.map((n) => Math.min(n.o.w, n.o.h)));
  }
  return toCorners({ cx: p[0], cy: p[1], w, h, angle });
}

/** Mean of axis directions (period π), so 5° and 175° average to 0°, not 90°. */
export function circularMeanAxis(angles: number[]): number {
  const x = angles.reduce((a, t) => a + Math.cos(2 * t), 0);
  const y = angles.reduce((a, t) => a + Math.sin(2 * t), 0);
  const mean = Math.atan2(y, x) / 2;
  return ((mean % Math.PI) + Math.PI) % Math.PI;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function centre(corners: Pt[]): Pt {
  return [
    corners.reduce((a, p) => a + p[0], 0) / corners.length,
    corners.reduce((a, p) => a + p[1], 0) / corners.length,
  ];
}

export function round2(corners: Pt[]): Pt[] {
  return corners.map(([x, y]) => [
    Math.round(x * 100) / 100,
    Math.round(y * 100) / 100,
  ]);
}
