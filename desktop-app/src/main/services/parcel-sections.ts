import { checkRing, ringAreaSqm, type LonLat } from "./boundary-geometry";
import {
  contains,
  interiorPoint,
  ringBounds,
  unionRings,
} from "./boundary/cascade-geometry";
import type { ParcelFeature, ParcelLandUse, ParcelUse } from "./alkis.service";

/**
 * Sub-parcel land use from the simplified ALKIS product
 * (`ave:NutzungFlurstueck`): every parcel is tiled into sections of one
 * actual land use each, drawn on the cadastre's own lines. Since cascade v15
 * a parcel holding both open land (meadow, wood, field) and another use is
 * cut along those lines, the same cut the Bayern parcel map gives
 * (bavaria-parcels.service.ts, `splitOpenSections`). Where a service
 * publishes no land use on the parcel itself (Hessen, Brandenburg), the
 * sections supply its shares. Methodology: docs/boundary-model.md,
 * "Cascade v15".
 */

/** One land-use section of a parcel. */
export interface LandUseSection {
  ring: LonLat[];
  use: ParcelUse;
}

/**
 * Smallest open-land patch cut off a parcel, and smallest rest it may leave
 * behind; the same limit as in Bayern.
 */
export const MIN_SECTION_SQM = 100;

/**
 * The sections found for a parcel must add up to its area within this
 * share. Less means the answer missed some (capped, or a section crossing
 * the search box); more means sections of another parcel were matched.
 */
const AREA_TOLERANCE = 0.03;

export interface SectionSplit {
  parcels: ParcelFeature[];
  /** Parcels that were cut into open land and the rest. */
  cut: number;
  /** Parcels without land use that took their shares from the sections. */
  filled: number;
}

interface PlacedSection extends LandUseSection {
  areaSqm: number;
  point: LonLat;
}

function sharesOf(sections: PlacedSection[]): ParcelLandUse | undefined {
  const total = sections.reduce((sum, s) => sum + s.areaSqm, 0);
  if (total <= 0) return undefined;
  const shares: ParcelLandUse = {};
  for (const s of sections) {
    shares[s.use] = (shares[s.use] ?? 0) + s.areaSqm / total;
  }
  return shares;
}

/** Polygons of a union as exterior rings; null when one has a hole. */
function exteriorsWithoutHoles(rings: LonLat[][]): LonLat[][] | null {
  const union = unionRings(rings);
  if (!union) return null;
  const polygons =
    union.type === "Polygon" ? [union.coordinates] : union.coordinates;
  if (polygons.some((polygon) => polygon.length > 1)) return null;
  return polygons.map((polygon) => polygon[0]);
}

function inside(ring: LonLat[], point: LonLat): boolean {
  const [minLon, minLat, maxLon, maxLat] = ringBounds(ring);
  const [lon, lat] = point;
  if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) {
    return false;
  }
  return contains(ring, point);
}

/**
 * The parcel cut into its open-land patches of at least `MIN_SECTION_SQM`
 * and the pieces of the rest, or null when it stays whole: no such patch,
 * too small a rest, or a patch enclosed by the rest (a ring without holes
 * cannot carry it; the cascade fills holes anyway).
 */
function cutParcel(
  parcel: ParcelFeature,
  sections: PlacedSection[],
  landUse: ParcelLandUse | undefined,
): ParcelFeature[] | null {
  const open = sections.filter((s) => s.use === "open");
  const total = sections.reduce((sum, s) => sum + s.areaSqm, 0);
  const openArea = open.reduce((sum, s) => sum + s.areaSqm, 0);
  if (openArea < MIN_SECTION_SQM || total - openArea < MIN_SECTION_SQM) {
    return null;
  }
  // Adjacent open sections form one patch.
  const patches = exteriorsWithoutHoles(open.map((s) => s.ring));
  if (!patches) return null;
  const large: Array<{ ring: LonLat[]; sections: PlacedSection[] }> = [];
  const rest = sections.filter((s) => s.use !== "open");
  for (const ring of patches) {
    const members = open.filter((s) => inside(ring, s.point));
    const area = members.reduce((sum, s) => sum + s.areaSqm, 0);
    if (area >= MIN_SECTION_SQM) large.push({ ring, sections: members });
    else rest.push(...members);
  }
  if (large.length === 0) return null;
  const restArea = rest.reduce((sum, s) => sum + s.areaSqm, 0);
  if (restArea < MIN_SECTION_SQM) return null;
  const pieces = exteriorsWithoutHoles(rest.map((s) => s.ring));
  if (!pieces) return null;

  const out: ParcelFeature[] = [];
  for (const ring of pieces) {
    const members = rest.filter((s) => inside(ring, s.point));
    const check = checkRing(ring, { minAreaSqm: 25, maxAreaSqm: 2_000_000 });
    if (!check.valid || members.length === 0) return null;
    const shares = sharesOf(members);
    out.push({
      ring,
      areaSqm: check.areaSqm,
      state: parcel.state,
      // The address belongs to the built part, not to the meadow.
      ...(parcel.address ? { address: parcel.address } : {}),
      ...(shares ? { landUse: shares } : landUse ? { landUse } : {}),
    });
  }
  for (const patch of large) {
    const check = checkRing(patch.ring, {
      minAreaSqm: 25,
      maxAreaSqm: 2_000_000,
    });
    if (!check.valid) return null;
    out.push({
      ring: patch.ring,
      areaSqm: check.areaSqm,
      state: parcel.state,
      landUse: { open: 1 },
    });
  }
  return out;
}

/**
 * Parcels with their land-use sections applied. Each section belongs to the
 * parcel holding a point inside it; a parcel whose sections do not add up to
 * its area stays as it was. With `cut: false` only missing land-use shares
 * are filled in (for measuring the two effects apart).
 */
export function splitParcelsByLandUse(
  parcels: ParcelFeature[],
  sections: LandUseSection[],
  options: { cut?: boolean } = {},
): SectionSplit {
  const cutEnabled = options.cut ?? true;
  const byParcel = new Map<ParcelFeature, PlacedSection[]>();
  for (const section of sections) {
    if (section.ring.length < 4) continue;
    const point = interiorPoint(section.ring);
    const owner = parcels.find((parcel) => inside(parcel.ring, point));
    if (!owner) continue;
    const placed: PlacedSection = {
      ...section,
      areaSqm: ringAreaSqm(section.ring),
      point,
    };
    const list = byParcel.get(owner);
    if (list) list.push(placed);
    else byParcel.set(owner, [placed]);
  }

  const out: ParcelFeature[] = [];
  let cut = 0;
  let filled = 0;
  for (const parcel of parcels) {
    const own = byParcel.get(parcel);
    if (!own) {
      out.push(parcel);
      continue;
    }
    const total = own.reduce((sum, s) => sum + s.areaSqm, 0);
    if (Math.abs(total / parcel.areaSqm - 1) > AREA_TOLERANCE) {
      out.push(parcel);
      continue;
    }
    let landUse = parcel.landUse;
    if (!landUse) {
      landUse = sharesOf(own);
      if (landUse) filled += 1;
    }
    const pieces = cutEnabled ? cutParcel(parcel, own, landUse) : null;
    if (pieces) {
      cut += 1;
      out.push(...pieces);
    } else {
      out.push(
        landUse && landUse !== parcel.landUse ? { ...parcel, landUse } : parcel,
      );
    }
  }
  return { parcels: out, cut, filled };
}
