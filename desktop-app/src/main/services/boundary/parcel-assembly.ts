import { area as turfArea } from "@turf/area";
import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import {
  featureCollection,
  multiPolygon as turfMultiPolygon,
  polygon as turfPolygon,
} from "@turf/helpers";
import intersect from "@turf/intersect";
import { union } from "@turf/union";
import type { Feature, MultiPolygon, Polygon as GeoPolygon } from "geojson";
import type { BoundaryGeometry, Polygon } from "@shared/types";
import { distanceToRingM, type LonLat } from "../boundary-geometry";
import type { ParcelFeature } from "../alkis.service";

/**
 * Assembles a dealership site from cadastral parcels.
 *
 * A parcel is a legal unit, and a dealership routinely occupies several
 * adjacent ones — or only part of one. Picking the single parcel containing the
 * geocoded point, which is what detection used to do, is wrong in both
 * directions: it returned 449 m² against a 6,889 m² site in one benchmark
 * location and 33,496 m² against a 9,570 m² site in another.
 *
 * So: start from parcels that are demonstrably the dealership's, then grow
 * outward only along shared boundaries, and only onto parcels that carry their
 * own evidence of belonging. Adjacency is real shared edge length, not centroid
 * proximity — two parcels either side of a street are close together, and are
 * not the same site.
 *
 * Pure: geometry only, no network.
 */

type PolyFeature = Feature<GeoPolygon | MultiPolygon>;

/** Minimum shared boundary length for two parcels to count as adjacent. */
export const MIN_SHARED_EDGE_M = 5;

/**
 * A matched parcel is suspiciously large above this multiple of the known
 * operational footprint.
 */
export const LARGE_PARCEL_RATIO = 3;

/**
 * Hard reject: the parcel is definitively not this dealership.
 *
 * The generous ceiling is deliberate. When OSM maps only the showroom building
 * rather than the lot, the true compound can legitimately be far larger, so a
 * tight ratio would reject correct parcels exactly where the evidence is
 * thinnest. Above ~1,000 m² the footprint is a real lot outline and the limit
 * tightens.
 */
export const HARD_REJECT_RATIO = 25;
/** Below this, an OSM footprint is treated as a building, not a lot outline. */
export const SHOWROOM_FOOTPRINT_SQM = 1_000;

export interface ParcelEvidence {
  /** Geometry the site is known to occupy, e.g. a mapped dealer area. */
  footprint?: Polygon;
  /** Parking or dealer polygons that vouch for an otherwise unevidenced parcel. */
  supporting: Polygon[];
}

export interface AssemblyResult {
  polygon: BoundaryGeometry;
  areaSqm: number;
  /** Parcels that went into the union. */
  parcelCount: number;
  /** How many were added by adjacency expansion rather than being anchors. */
  expandedCount: number;
  anchorContainsPoint: boolean;
  reasons: string[];
}

function toFeature(ring: LonLat[]): PolyFeature | null {
  try {
    return turfPolygon([ring]) as PolyFeature;
  } catch {
    return null;
  }
}

function polygonToFeature(polygon: BoundaryGeometry): PolyFeature | null {
  try {
    return polygon.type === "Polygon"
      ? (turfPolygon(polygon.coordinates as never) as PolyFeature)
      : (turfMultiPolygon(polygon.coordinates as never) as PolyFeature);
  } catch {
    return null;
  }
}

/**
 * Length of `ring`'s boundary that runs within `toleranceM` of `other`.
 *
 * Deliberately *not* computed with `@turf/intersect`. Two parcels that abut
 * share a boundary of zero area, and the intersection of zero-area geometry is
 * null — the boolean operation cannot see a shared edge at all. That is a real
 * trap: the test appears to work while silently reporting every neighbour as
 * non-adjacent.
 *
 * Sampling also matches what cadastral data actually looks like. Neighbouring
 * parcels are digitised independently and their shared edge is rarely
 * coordinate-identical, so a strict collinearity test would miss adjacency over
 * a few centimetres of slack.
 */
export function sharedBoundaryLengthM(
  ring: LonLat[],
  other: LonLat[],
  toleranceM = 0.5,
  stepM = 1,
): number {
  let shared = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const a = ring[i];
    const b = ring[i + 1];
    const segmentLength = distanceToRingM(a, [b, b]);
    if (segmentLength === 0) continue;
    const steps = Math.max(1, Math.ceil(segmentLength / stepM));
    for (let k = 0; k < steps; k += 1) {
      const t = (k + 0.5) / steps;
      const sample: LonLat = [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
      ];
      if (distanceToRingM(sample, other) <= toleranceM) {
        shared += segmentLength / steps;
      }
    }
  }
  return shared;
}

/**
 * True when two parcels share a real boundary, not just a corner.
 *
 * Either they genuinely overlap, or their outlines run together for at least
 * `minSharedLengthM`. A corner touch is a point, not an edge, and two plots
 * either side of a street are close but separate sites.
 */
export function sharesEdge(
  a: LonLat[],
  b: LonLat[],
  minSharedLengthM = MIN_SHARED_EDGE_M,
): boolean {
  const featureA = toFeature(a);
  const featureB = toFeature(b);
  if (featureA && featureB && overlapRatio(featureA, featureB) > 0.01) {
    return true;
  }
  return sharedBoundaryLengthM(a, b) >= minSharedLengthM;
}

/** Share of `subject` covered by `other`. 0 when they do not intersect. */
export function overlapRatio(subject: PolyFeature, other: PolyFeature): number {
  try {
    const subjectArea = turfArea(subject);
    if (subjectArea <= 0) return 0;
    const overlap = intersect(featureCollection([subject, other]) as never);
    if (!overlap) return 0;
    return Math.min(1, turfArea(overlap as Feature) / subjectArea);
  } catch {
    return 0;
  }
}

function unionAll(features: PolyFeature[]): PolyFeature | null {
  if (features.length === 0) return null;
  let merged = features[0];
  for (let i = 1; i < features.length; i += 1) {
    try {
      const next = union(featureCollection([merged, features[i]]) as never);
      if (next) merged = next as PolyFeature;
    } catch {
      // Skip a parcel with invalid geometry rather than losing the whole union.
    }
  }
  return merged;
}

/** Preserves every component and hole returned by the parcel union. */
function geometryOf(feature: PolyFeature): BoundaryGeometry | null {
  const geometry = feature.geometry;
  if (geometry.type === "Polygon") {
    return { type: "Polygon", coordinates: geometry.coordinates as never };
  }
  if (geometry.type === "MultiPolygon") {
    return {
      type: "MultiPolygon",
      coordinates: geometry.coordinates as never,
    };
  }
  return null;
}

/**
 * Assembles the site.
 *
 * Stage 1 picks anchors: parcels containing the geocoded point, plus parcels
 * substantially covered by a known footprint. Stage 2 expands along shared
 * edges onto parcels that carry their own supporting evidence. Parcels with no
 * evidence are never added, however adjacent they are — that is what stops the
 * site from running away across a business park.
 */
export function assembleSiteFromParcels(
  parcels: ParcelFeature[],
  anchor: LonLat,
  evidence: ParcelEvidence = { supporting: [] },
): AssemblyResult | null {
  if (parcels.length === 0) return null;

  const features = parcels
    .map((parcel) => ({ parcel, feature: toFeature(parcel.ring) }))
    .filter(
      (entry): entry is { parcel: ParcelFeature; feature: PolyFeature } =>
        entry.feature !== null,
    );
  if (features.length === 0) return null;

  const reasons: string[] = [];
  const footprint = evidence.footprint
    ? polygonToFeature(evidence.footprint)
    : null;
  const footprintArea = footprint ? turfArea(footprint) : 0;
  // A small footprint is a showroom, so the surrounding compound may be much
  // larger; a large one is a lot outline and the parcel should resemble it.
  const rejectRatio =
    footprintArea > 0 && footprintArea < SHOWROOM_FOOTPRINT_SQM
      ? HARD_REJECT_RATIO
      : LARGE_PARCEL_RATIO * 2;

  const anchorIndices = new Set<number>();
  let anchorContainsPoint = false;

  features.forEach(({ feature }, index) => {
    let contains = false;
    try {
      contains = booleanPointInPolygon(anchor, feature as never);
    } catch {
      contains = false;
    }
    if (contains) {
      anchorIndices.add(index);
      anchorContainsPoint = true;
    }
  });

  if (footprint) {
    features.forEach(({ feature }, index) => {
      if (anchorIndices.has(index)) return;
      // The parcel must cover a real part of the known footprint.
      if (overlapRatio(footprint, feature) >= 0.15) anchorIndices.add(index);
    });
  }

  if (anchorIndices.size === 0) {
    // Fall back to the parcel nearest the anchor, so a geocode landing on the
    // pavement still resolves to something.
    let nearest = -1;
    let nearestDistance = Infinity;
    features.forEach(({ parcel }, index) => {
      const distance = distanceToRingM(anchor, parcel.ring);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = index;
      }
    });
    if (nearest < 0 || nearestDistance > 35) return null;
    anchorIndices.add(nearest);
    reasons.push("no parcel contains the reference point");
  }

  // Drop anchors that are implausibly large relative to a known footprint.
  if (footprintArea > 0) {
    for (const index of [...anchorIndices]) {
      const ratio = turfArea(features[index].feature) / footprintArea;
      if (ratio > rejectRatio) {
        anchorIndices.delete(index);
        reasons.push(
          `parcel rejected: ${ratio.toFixed(1)}x the mapped footprint`,
        );
      }
    }
    if (anchorIndices.size === 0) return null;
  }

  // Stage 2: expand along shared edges onto evidenced parcels only.
  const supporting = evidence.supporting
    .map((polygon) => polygonToFeature(polygon))
    .filter((feature): feature is PolyFeature => feature !== null);

  const selected = new Set(anchorIndices);
  let expanded = 0;
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < features.length; i += 1) {
      if (selected.has(i)) continue;
      const candidate = features[i].feature;
      const hasEvidence =
        supporting.some((support) => overlapRatio(candidate, support) >= 0.2) ||
        (footprint ? overlapRatio(candidate, footprint) >= 0.1 : false);
      if (!hasEvidence) continue;
      const touches = [...selected].some((index) =>
        sharesEdge(features[index].parcel.ring, features[i].parcel.ring),
      );
      if (!touches) continue;
      selected.add(i);
      expanded += 1;
      changed = true;
    }
  }

  const merged = unionAll([...selected].map((index) => features[index].feature));
  if (!merged) return null;
  const polygon = geometryOf(merged);
  if (!polygon) return null;

  return {
    polygon,
    areaSqm: turfArea(merged),
    parcelCount: selected.size,
    expandedCount: expanded,
    anchorContainsPoint,
    reasons,
  };
}
