import { geometryAreaSqm, outerRings } from "@shared/boundary-geometry-utils";
import {
  distanceToRingM,
  ringAreaSqm,
  type LonLat,
} from "../boundary-geometry";
import {
  cellCount,
  cellIndex,
  cellToLonLat,
  createGridSpec,
  lonLatToCell,
  type GridSpec,
} from "./grid";
import {
  dilate,
  erode,
  rasterizeDisk,
  rasterizeMaskPolygon,
} from "./rasterize";
import { masksToGeometry } from "./vectorize";
import { matchesSite } from "./site-membership";
import {
  CASCADE_LIMITS,
  CASCADE_CONFIDENCE,
  type CascadeInput,
  type StageOutcome,
} from "./cascade-config";
import { now, distanceM, validRing } from "./cascade-geometry";
import { vehicleLot, anchorBuildingOf } from "./cascade-anchors";
import { lotParcelRing, streetParcels } from "./cascade-parcels";

// --- Stage 2: outline of the vehicle lot ----------------------------------

const OUTLINE_CELL_M = 1;
/** Closing radius (cells) that joins an added building to the outline. */
const HULL_JOIN_CELLS = 6;

/** 4-connected components of a mask, one mask per component. */
function components(spec: GridSpec, mask: Uint8Array): Uint8Array[] {
  const label = new Int32Array(mask.length);
  const result: Uint8Array[] = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || label[start]) continue;
    const component = new Uint8Array(mask.length);
    const stack = [start];
    label[start] = result.length + 1;
    while (stack.length > 0) {
      const index = stack.pop()!;
      component[index] = 1;
      const col = index % spec.cols;
      const row = Math.floor(index / spec.cols);
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const c = col + dc;
        const r = row + dr;
        if (c < 0 || r < 0 || c >= spec.cols || r >= spec.rows) continue;
        const next = cellIndex(spec, c, r);
        if (mask[next] && !label[next]) {
          label[next] = result.length + 1;
          stack.push(next);
        }
      }
    }
    result.push(component);
  }
  return result;
}

/**
 * Outline of the vehicle lot: every vehicle stamped as a disk of `hullCloseM`,
 * then shrunk by `hullCloseM − hullMarginM`. That is a morphological closing:
 * aisles and empty bays between rows are filled, the outline follows an
 * L-shaped lot instead of cutting its corner, and it ends `hullMarginM`
 * beyond the outermost vehicles. The outline is squared up along the lot's
 * own axis.
 */
export function vehicleHullStage(input: CascadeInput): StageOutcome {
  if (!input.vehicles) {
    return { result: null, reason: "no vehicle detection", alternatives: [] };
  }
  const lot = vehicleLot(
    input.vehicles,
    input.anchor,
    lotParcelRing(input),
    anchorBuildingOf(input),
  );
  if (lot.length === 0) {
    return {
      result: null,
      reason: "no vehicle lot at the point",
      alternatives: [],
    };
  }
  if (lot.length < CASCADE_LIMITS.hullMinVehicles) {
    return {
      result: null,
      reason: `only ${lot.length} vehicles at the point, too few to outline a lot`,
      alternatives: [],
    };
  }
  const { hullCloseM, hullMarginM, maxReachM } = CASCADE_LIMITS;
  const spec = createGridSpec(
    input.anchor,
    OUTLINE_CELL_M,
    2 * (maxReachM + hullCloseM + 2),
  );
  const stamp = new Float32Array(cellCount(spec));
  for (const vehicle of lot) {
    rasterizeDisk(spec, vehicle, hullCloseM, stamp, 1);
  }
  const mask = erode(
    spec,
    Uint8Array.from(stamp, (value) => (value > 0 ? 1 : 0)),
    // +1: the stamped disks reach half a cell beyond their radius on each side.
    // −1: a stamped disk covers every cell whose centre lies inside it, so it
    // reaches about one cell further than its radius.
    Math.round((hullCloseM - hullMarginM) / OUTLINE_CELL_M) - 1,
  );
  completeOutline(spec, mask, stamp, input);
  // Parts without lot vehicles are what is left beyond a removed street;
  // the part holding the point (its building) always stays.
  const lotCells = lot.flatMap((vehicle) => {
    const cell = lonLatToCell(spec, vehicle);
    return cell ? [cellIndex(spec, cell.col, cell.row)] : [];
  });
  const anchorRef = lonLatToCell(spec, input.anchor);
  const anchorCell = anchorRef
    ? cellIndex(spec, anchorRef.col, anchorRef.row)
    : -1;
  const outline = masksToGeometry(
    spec,
    components(spec, mask).filter(
      (component) =>
        (anchorCell >= 0 && component[anchorCell] === 1) ||
        lotCells.filter((index) => component[index]).length >=
          CASCADE_LIMITS.minLotVehicles,
    ),
    { simplifyToleranceM: 1 },
  );
  const maxArea = input.parameters.boundaryMaxAreaSqm;
  const areaSqm = outline ? geometryAreaSqm(outline.geometry) : 0;
  if (
    !outline ||
    areaSqm < CASCADE_LIMITS.minHullSqm ||
    areaSqm > maxArea ||
    !outerRings(outline.geometry).every((ring) =>
      validRing(ring as LonLat[], maxArea),
    )
  ) {
    return {
      result: null,
      reason: `vehicle lot outline is ${Math.round(areaSqm)} m², outside the plausible range`,
      alternatives: [],
    };
  }
  const confidence = CASCADE_CONFIDENCE.vehicleHull;
  return {
    result: {
      source: "aerial",
      role: "operationalLot",
      provider: "vehicle-hull",
      polygon: outline.geometry,
      areaSqm,
      confidence,
      label: `Vehicle lot (${lot.length})`,
      evidence: {
        source: "Aerial imagery / vehicle detection",
        retrievedAt: now(),
        method: "cascade stage 2: outline of the detected vehicle lot",
        confidence,
        fallbackUsed: false,
        limitations: [
          "Outline of the vehicles seen, not a surveyed boundary",
          (input.buildings ?? []).length > 0
            ? "Buildings are included only where the vehicles surround them; empty yards are not"
            : "No building footprints here: showroom, workshop and empty areas without vehicles are not included",
        ],
      },
    },
    reason: `outline of ${lot.length} lot vehicles`,
    alternatives: [],
    lotVehicles: lot.length,
  };
}

/**
 * Completes the vehicle outline in place:
 *
 * - adds every building of which at least `hullBuildingShare` lies within
 *   `hullCloseM` of the lot vehicles (the showroom the rows stand around);
 * - takes every other building it runs through whole or not at all
 *   (`wholeBuildingShare`);
 * - fills holes (a courtyard or building the outline encloses);
 * - removes street-like parcels, so cars parked along the kerb do not carry
 *   the outline into the road.
 */
function completeOutline(
  spec: GridSpec,
  mask: Uint8Array,
  stamp: Float32Array,
  input: CascadeInput,
): void {
  let added = false;
  // The building the point lies in is the dealership's as a rule (the point
  // is its address or POI), so it belongs to the outline even where the lot
  // stands on one side only. Without cadastre (Bayern) it is the only
  // evidence of the showroom.
  const atPoint = anchorBuildingOf(input);
  const complex = atPoint
    ? buildingComplex(atPoint, input.buildings ?? [])
    : [];
  const complexArea = complex.reduce((sum, ring) => sum + ringAreaSqm(ring), 0);
  if (complex.length > 0 && complexArea <= CASCADE_LIMITS.maxParcelSqm) {
    for (const ring of complex) {
      const cells = new Uint8Array(mask.length);
      if (rasterizeMaskPolygon(spec, ring, cells) === 0) continue;
      for (let i = 0; i < cells.length; i += 1) if (cells[i]) mask[i] = 1;
      added = true;
    }
  }
  // Buildings that did not join by the rule below; the outline may still
  // run through them.
  const others: Uint8Array[] = [];
  for (const ring of input.buildings ?? []) {
    if (complex.includes(ring)) continue;
    const areaSqm = ringAreaSqm(ring);
    if (areaSqm > CASCADE_LIMITS.hullBuildingMaxSqm) continue;
    const cells = new Uint8Array(mask.length);
    if (rasterizeMaskPolygon(spec, ring, cells) === 0) continue;
    // Share of the footprint, and of its outline, within reach of the lot:
    // a large showroom the rows stand around is near along its walls only.
    let total = 0;
    let near = 0;
    let edge = 0;
    let edgeNear = 0;
    for (let i = 0; i < cells.length; i += 1) {
      if (!cells[i]) continue;
      total += 1;
      if (stamp[i] > 0) near += 1;
      const col = i % spec.cols;
      const row = Math.floor(i / spec.cols);
      const onEdge =
        col === 0 ||
        row === 0 ||
        col === spec.cols - 1 ||
        row === spec.rows - 1 ||
        !cells[i - 1] ||
        !cells[i + 1] ||
        !cells[i - spec.cols] ||
        !cells[i + spec.cols];
      if (!onEdge) continue;
      edge += 1;
      if (stamp[i] > 0) edgeNear += 1;
    }
    if (
      Math.max(near / total, edgeNear / edge) < CASCADE_LIMITS.hullBuildingShare
    ) {
      if (areaSqm >= CASCADE_LIMITS.wholeBuildingMinSqm) others.push(cells);
      continue;
    }
    for (let i = 0; i < cells.length; i += 1) if (cells[i]) mask[i] = 1;
    added = true;
  }
  if (added) {
    // A building can sit a few metres off the outline (a footpath, a kerb);
    // a small closing joins it instead of leaving a separate part.
    mask.set(erode(spec, dilate(spec, mask, HULL_JOIN_CELLS), HULL_JOIN_CELLS));
  }
  // A building is not divided (v14): where the outline runs through one, it
  // takes the building whole when it covers most of it, and stops at its
  // wall otherwise. A building the outline surrounds is filled below.
  for (const cells of others) {
    let total = 0;
    let covered = 0;
    for (let i = 0; i < cells.length; i += 1) {
      if (!cells[i]) continue;
      total += 1;
      if (mask[i]) covered += 1;
    }
    if (covered === 0 || covered === total) continue;
    const whole = covered / total >= CASCADE_LIMITS.wholeBuildingShare ? 1 : 0;
    for (let i = 0; i < cells.length; i += 1) if (cells[i]) mask[i] = whole;
  }
  fillHoles(spec, mask);
  if (input.isStreetAt) {
    for (let i = 0; i < mask.length; i += 1) {
      if (!mask[i]) continue;
      const col = i % spec.cols;
      const row = Math.floor(i / spec.cols);
      if (input.isStreetAt(cellToLonLat(spec, col, row))) mask[i] = 0;
    }
  }
  const streets = streetParcels(input.parcels);
  for (const parcel of input.parcels) {
    if (!streets.has(parcel)) continue;
    const cells = new Uint8Array(mask.length);
    rasterizeMaskPolygon(spec, parcel.ring, cells);
    for (let i = 0; i < cells.length; i += 1) if (cells[i]) mask[i] = 0;
  }
}

/**
 * The building at the point and every building attached to it (wall to
 * wall, within `BUILDING_ATTACHED_M`): official models split a showroom,
 * workshop and annex into separate buildings of one complex.
 */
function buildingComplex(seed: LonLat[], buildings: LonLat[][]): LonLat[][] {
  const complex = [seed];
  const queue = [seed];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const ring of buildings) {
      if (complex.includes(ring)) continue;
      const touches =
        ring.some((p) => distanceToRingM(p, current) <= BUILDING_ATTACHED_M) ||
        current.some((p) => distanceToRingM(p, ring) <= BUILDING_ATTACHED_M);
      if (!touches) continue;
      complex.push(ring);
      queue.push(ring);
    }
  }
  return complex;
}

/** Buildings closer than this count as attached (shared or touching walls). */
const BUILDING_ATTACHED_M = 1;

/** Sets every empty cell not connected to the grid edge (a hole). */
function fillHoles(spec: GridSpec, mask: Uint8Array): void {
  const outside = new Uint8Array(mask.length);
  const stack: number[] = [];
  const push = (col: number, row: number): void => {
    const index = cellIndex(spec, col, row);
    if (mask[index] || outside[index]) return;
    outside[index] = 1;
    stack.push(index);
  };
  for (let col = 0; col < spec.cols; col += 1) {
    push(col, 0);
    push(col, spec.rows - 1);
  }
  for (let row = 0; row < spec.rows; row += 1) {
    push(0, row);
    push(spec.cols - 1, row);
  }
  while (stack.length > 0) {
    const index = stack.pop()!;
    const col = index % spec.cols;
    const row = Math.floor(index / spec.cols);
    if (col > 0) push(col - 1, row);
    if (col < spec.cols - 1) push(col + 1, row);
    if (row > 0) push(col, row - 1);
    if (row < spec.rows - 1) push(col, row + 1);
  }
  for (let i = 0; i < mask.length; i += 1) if (!outside[i]) mask[i] = 1;
}

// --- Stage 3: OSM car-dealer area (cached only) ----------------------------

/**
 * An OSM area tagged as a car dealer that contains the point, or that carries
 * the dealership's name or address and lies within
 * `boundaryNearPointDistanceM` of it. A dealer tag on a building is a
 * showroom footprint, not the lot, and is ignored.
 */
export function osmDealerStage(input: CascadeInput): StageOutcome {
  if (!input.osm) {
    return { result: null, reason: "OSM not cached", alternatives: [] };
  }
  const maxArea = input.parameters.boundaryMaxAreaSqm;
  const nearM = input.parameters.boundaryNearPointDistanceM;
  const best = input.osm.areas
    .filter((area) => area.kind === "dealerArea" && !area.tags.building)
    .map((area) => ({
      area,
      areaSqm: ringAreaSqm(area.ring),
      distance: distanceM(area.ring, input.anchor),
      identity: matchesSite(area.tags, input.name, input.address),
    }))
    .filter(
      (c) =>
        c.areaSqm >= CASCADE_LIMITS.minLotSqm &&
        c.areaSqm <= maxArea &&
        validRing(c.area.ring, maxArea) &&
        (c.distance === 0 || (c.identity && c.distance <= nearM)),
    )
    // Identity first, then containment, then the more specific (smaller) area.
    .sort(
      (a, b) =>
        Number(b.identity) - Number(a.identity) ||
        a.distance - b.distance ||
        a.areaSqm - b.areaSqm,
    )[0];
  if (!best) {
    return {
      result: null,
      reason: "no OSM dealer area at the point",
      alternatives: [],
    };
  }
  const inside = best.distance === 0;
  const namedOtherwise =
    !best.identity && Boolean(best.area.tags.name) && Boolean(input.name);
  const confidence = best.identity
    ? inside
      ? CASCADE_CONFIDENCE.dealerMatchedInside
      : CASCADE_CONFIDENCE.dealerMatchedNear
    : namedOtherwise
      ? CASCADE_CONFIDENCE.dealerNamedOtherwise
      : CASCADE_CONFIDENCE.dealerInside;
  return {
    result: {
      source: "osm",
      role: "operationalLot",
      provider: "osm-dealer-area",
      polygon: { type: "Polygon", coordinates: [best.area.ring] },
      areaSqm: best.areaSqm,
      confidence,
      ...(best.area.tags.name ? { label: best.area.tags.name } : {}),
      evidence: {
        source: "OpenStreetMap / Overpass",
        retrievedAt: now(),
        method: "cascade stage 3: car-dealer area at the point",
        confidence,
        fallbackUsed: false,
        limitations: [
          "Drawn by OSM mappers; completeness varies by region",
          ...(namedOtherwise
            ? ["Area is named differently from the dealership"]
            : []),
        ],
      },
    },
    reason: best.identity
      ? `OSM dealer area matches name/address${inside ? " and contains the point" : `, ${Math.round(best.distance)} m from the point`}`
      : namedOtherwise
        ? `OSM dealer area contains the point but is named "${best.area.tags.name}"`
        : "OSM dealer area contains the point",
    alternatives: [],
  };
}
