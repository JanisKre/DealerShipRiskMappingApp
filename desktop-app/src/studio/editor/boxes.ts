import type { Pt } from "./geometry";

/**
 * Boxes as stored in the autolabel tile files (data/autolabel/<tile>.json) (training/tiles.py). The
 * rules here mirror tiles.accepted_boxes / open_questions, so the editor shows
 * exactly what make_dataset.py will turn into labels.
 */
export type Decision = "car" | "large_vehicle" | "no" | null;
export type Bucket = "sure" | "check" | "candidate" | "manual";
export type Origin = "model" | "manual" | "label";

export interface TileBox {
  id?: number;
  cls: 0 | 1;
  corners: Pt[];
  origin: Origin;
  bucket: Bucket;
  decision: Decision;
  score?: number;
  votes?: number;
  labelIndex?: number;
  claude?: string | null;
  [key: string]: unknown;
}

export interface TileData {
  image: string;
  done: boolean;
  weights?: string;
  boxes: TileBox[];
  /** Audit mode: your existing labels that are not in question. */
  existing?: { cls: 0 | 1; corners: Pt[] }[];
}

export type BoxState = "accepted" | "open" | "rejected";

export const CLASS_NAME: Record<0 | 1, "car" | "large_vehicle"> = {
  0: "car",
  1: "large_vehicle",
};

export function boxState(b: TileBox): BoxState {
  if (b.decision === "no") return "rejected";
  if (b.decision === "car" || b.decision === "large_vehicle") return "accepted";
  if (b.origin === "manual") return "accepted";
  return b.bucket === "sure" ? "accepted" : "open";
}

/** Class the box will be saved with. */
export function effectiveClass(b: TileBox): 0 | 1 {
  if (b.decision === "large_vehicle") return 1;
  if (b.decision === "car") return 0;
  return b.cls;
}

export function decide(b: TileBox, decision: Decision): TileBox {
  if (decision === "car") return { ...b, decision, cls: 0 };
  if (decision === "large_vehicle") return { ...b, decision, cls: 1 };
  return { ...b, decision };
}

export function manualBox(corners: Pt[], cls: 0 | 1): TileBox {
  // A box you draw is a yes by definition; review.py stores it the same way.
  return {
    cls,
    corners,
    origin: "manual",
    bucket: "manual",
    decision: CLASS_NAME[cls],
    score: 1,
    votes: 0,
  };
}

export function counts(boxes: TileBox[]): Record<BoxState, number> {
  const out = { accepted: 0, open: 0, rejected: 0 };
  for (const b of boxes) out[boxState(b)]++;
  return out;
}

/** Open questions in reading order (top to bottom, left to right). */
export function openIndices(boxes: TileBox[]): number[] {
  return boxes
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => boxState(b) === "open")
    .sort(
      (a, c) =>
        Math.round(a.b.corners[0][1] / 40) -
          Math.round(c.b.corners[0][1] / 40) ||
        a.b.corners[0][0] - c.b.corners[0][0],
    )
    .map(({ i }) => i);
}

/**
 * Finishing a tile: questions you did not answer count as "no", the same as
 * review.py (only answered or sure boxes become labels). Made explicit here so
 * the file says what happened.
 */
export function finalize(boxes: TileBox[]): TileBox[] {
  return boxes.map((b) =>
    boxState(b) === "open" ? { ...b, decision: "no" } : b,
  );
}
