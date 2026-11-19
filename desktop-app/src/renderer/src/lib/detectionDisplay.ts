import type { DetectionBox } from "@shared/types";

/**
 * How detected vehicles are drawn on the map. Display only: the vehicle
 * count, the exposure and the EAL never depend on these choices.
 */
export type DetectionShape = "dot" | "box" | "boxAndDot";
export type DetectionColorMode = "blue" | "green" | "confidence";
export type DetectionDotSize = "small" | "medium" | "large";

export interface DetectionDisplay {
  shape: DetectionShape;
  color: DetectionColorMode;
  dotSize: DetectionDotSize;
  /** Light fill inside boxes, as in the labeling editor. */
  boxFill: boolean;
  /** Draw only the selected location's vehicles, never its neighbours'. */
  onlySelected: boolean;
}

export const DETECTION_SHAPES: readonly DetectionShape[] = [
  "dot",
  "box",
  "boxAndDot",
];
export const DETECTION_COLOR_MODES: readonly DetectionColorMode[] = [
  "blue",
  "green",
  "confidence",
];
export const DETECTION_DOT_SIZES: readonly DetectionDotSize[] = [
  "small",
  "medium",
  "large",
];

/** The previous fixed look: small blue dots for every location in view. */
export const DEFAULT_DETECTION_DISPLAY: DetectionDisplay = {
  shape: "dot",
  color: "blue",
  dotSize: "small",
  boxFill: true,
  onlySelected: false,
};

/** Blue as before; green is the "car" box colour of the labeling editor. */
export const DETECTION_COLORS = {
  blue: "#2563eb",
  green: "#30d158",
} as const;

/**
 * Confidence bands, highest first. Fixed cut-offs so the same score always
 * gets the same colour; the legend lists them.
 */
export const CONFIDENCE_BANDS = [
  { key: "high", min: 0.6, color: "#30d158" },
  { key: "medium", min: 0.4, color: "#eab308" },
  { key: "low", min: 0, color: "#f97316" },
] as const;

export const DOT_RADIUS: Record<DetectionDotSize, number> = {
  small: 2.5,
  medium: 4,
  large: 6,
};

export function detectionColor(
  mode: DetectionColorMode,
  score: number,
): string {
  if (mode !== "confidence") return DETECTION_COLORS[mode];
  const band =
    CONFIDENCE_BANDS.find((b) => score >= b.min) ?? CONFIDENCE_BANDS[2];
  return band.color;
}

function oneOf<T extends string>(
  allowed: readonly T[],
  value: unknown,
  fallback: T,
): T {
  return (allowed as readonly unknown[]).includes(value)
    ? (value as T)
    : fallback;
}

/** Saved display options, with unknown or missing fields set to the defaults. */
export function normalizeDetectionDisplay(value: unknown): DetectionDisplay {
  const saved =
    value && typeof value === "object"
      ? (value as Partial<Record<keyof DetectionDisplay, unknown>>)
      : {};
  const d = DEFAULT_DETECTION_DISPLAY;
  return {
    shape: oneOf(DETECTION_SHAPES, saved.shape, d.shape),
    color: oneOf(DETECTION_COLOR_MODES, saved.color, d.color),
    dotSize: oneOf(DETECTION_DOT_SIZES, saved.dotSize, d.dotSize),
    boxFill: typeof saved.boxFill === "boolean" ? saved.boxFill : d.boxFill,
    onlySelected:
      typeof saved.onlySelected === "boolean"
        ? saved.onlySelected
        : d.onlySelected,
  };
}

/** Linear map from a normalized image axis to degrees: deg = origin + t * span. */
interface AxisFit {
  origin: number;
  span: number;
}

// About 1 cm. Stored centers are an exact linear function of the image
// coordinates, so anything larger means the boxes don't share one image.
const FIT_TOLERANCE_DEG = 1e-7;

function fitAxis(t: number[], deg: number[]): AxisFit | null {
  const n = t.length;
  const mt = t.reduce((a, b) => a + b, 0) / n;
  const md = deg.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (t[i] - mt) ** 2;
    sxy += (t[i] - mt) * (deg[i] - md);
  }
  if (sxx < 1e-12) return null;
  const span = sxy / sxx;
  const origin = md - span * mt;
  const fits = t.every(
    (ti, i) => Math.abs(origin + span * ti - deg[i]) <= FIT_TOLERANCE_DEG,
  );
  return fits && span !== 0 ? { origin, span } : null;
}

/**
 * The image frame of a detection, recovered from its boxes. Older detections
 * stored only the normalized axis-aligned box and its georeferenced center;
 * since every center is `origin + center * span` on the same image, two or
 * more boxes at different positions give the span back exactly.
 */
export function inferImageFrame(
  boxes: readonly DetectionBox[],
): { lon: AxisFit; lat: AxisFit } | null {
  const geo = boxes.filter(
    (b): b is DetectionBox & { lat: number; lon: number } =>
      b.lat != null && b.lon != null,
  );
  if (geo.length < 2) return null;
  const lon = fitAxis(
    geo.map((b) => b.x + b.w / 2),
    geo.map((b) => b.lon),
  );
  const lat = fitAxis(
    geo.map((b) => b.y + b.h / 2),
    geo.map((b) => b.lat),
  );
  return lon && lat ? { lon, lat } : null;
}

/** Leaflet ring as [lat, lon] pairs. */
export type Footprint = [number, number][];

/**
 * Map footprint of each box: the stored oriented corners when present,
 * otherwise the axis-aligned box placed on the inferred image frame, and
 * `null` when neither is available (the map then draws a dot).
 */
export function boxFootprints(
  boxes: readonly DetectionBox[],
): (Footprint | null)[] {
  const needsFrame = boxes.some((b) => !b.corners);
  const frame = needsFrame ? inferImageFrame(boxes) : null;
  return boxes.map((b) => {
    if (b.corners) return b.corners.map(([lon, lat]) => [lat, lon]);
    if (!frame || b.lat == null || b.lon == null) return null;
    const lon = (t: number): number => frame.lon.origin + t * frame.lon.span;
    const lat = (t: number): number => frame.lat.origin + t * frame.lat.span;
    return [
      [lat(b.y), lon(b.x)],
      [lat(b.y), lon(b.x + b.w)],
      [lat(b.y + b.h), lon(b.x + b.w)],
      [lat(b.y + b.h), lon(b.x)],
    ];
  });
}
