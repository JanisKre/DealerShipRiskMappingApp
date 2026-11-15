import type {
  BoundaryResult,
  BoundaryReviewFlag,
  RiskParameters,
} from "@shared/types";
import { type LonLat } from "../boundary-geometry";
import type { ParcelFeature } from "../alkis.service";
import type { OsmEvidence } from "./osm-overpass";

/** Version, limits, priors and data shapes of the source cascade (`cascade.ts`). */

/**
 * Bumped whenever a stage rule changes, so cached results can be retired.
 * 3: complete cadastre, street test by length, empty-parcel test, anchor
 * reach from the building edge, bounded lot extension, outline with
 * buildings (docs/boundary-model.md, "Cascade v3").
 * 4: field strips (a point on one declines stage 1; they are not streets),
 * `anchorOffLot` flag with the lot's parcels as an alternative, stricter
 * empty-parcel test for large areas, minimum area in stage 1
 * (docs/boundary-model.md, "Cascade v4").
 * 5: the building complex at the point joins the vehicle outline; Bayern
 * footprints from the LoD2 model.
 * 6: traffic areas cut the outline where there are no street parcels
 * (Bayern land-use map).
 * 7: full confidence from 70 % lot coverage (was 80 %).
 * 8: small dense parcels, short parking strips (as leaves) and enclosed
 * parcels join; holes in the parcel union are filled
 * (docs/boundary-model.md, "Cascade v8").
 * 9: the cadastre's land use decides what a street is, where published;
 * parcels with the address of the parcel at the point join; a point whose
 * parcel does not carry the dealership's address moves to the parcel that
 * does; housing and open land join only when dense with vehicles
 * (docs/boundary-model.md, "Cascade v9").
 * 10: parcels in all states; a dense lot across a street joins.
 * 11: a point in woodland or open land, with no building and no vehicles
 * near it, is off the site (`pointOffSite`): its parcel is not returned,
 * the nearest vehicle lot within reach is, else a small marker
 * (docs/boundary-model.md, "Cascade v11").
 * 12: a parcel result is whole cadastral units, never reshaped on a raster
 * (the vegetation trimming of v9 is gone); in Bayern the open land the
 * parcel map draws inside a parcel is a unit of its own
 * (docs/boundary-model.md, "Cascade v12").
 */
export const CASCADE_VERSION = 12;

export type CascadeStage = 1 | 2 | 3 | 4 | 5;

/** Limits in metres and m². See docs/boundary-model.md, "Source cascade". */
export const CASCADE_LIMITS = {
  /** Below this nothing is a dealership lot — a kiosk, a garage, a sliver. */
  minLotSqm: 300,
  /** Smallest vehicle hull worth returning. */
  minHullSqm: 200,
  /** A parcel larger than this is an estate or a field, not a lot. */
  maxParcelSqm: 30_000,
  /** Vehicles further apart than this belong to different lots. */
  vehicleLinkM: 12,
  /**
   * A vehicle cluster belongs to the site if it comes this close to the point.
   * Was 25 m; a showroom is 40–80 m across, and a point on its roof then
   * reached only the cars on one side.
   */
  anchorReachM: 40,
  /** … or this close to the edge of the building the point lies in. */
  anchorBuildingReachM: 25,
  /**
   * Vehicles further from the point are ignored, so lots cannot chain on
   * through a business park. 150 m doubled the area bias on the benchmark.
   */
  maxReachM: 80,
  /**
   * Second pass: a cluster up to this far from the point joins when it
   * continues the lot (shares a vehicle with it) or stands on a parcel the
   * lot already holds. Bounded, unlike a plain larger `maxReachM`.
   */
  extendedReachM: 160,
  /**
   * The second pass may add at most this share of the first pass's area.
   * A larger jump is offered as an alternative instead: in the audit, small
   * additions completed a lot (Dresden, Kassel) and large ones reached into
   * neighbouring blocks whose ownership the image cannot tell.
   */
  maxExtensionShare: 0.25,
  /** Fewer vehicles than this are a few parked cars, not a lot. */
  minLotVehicles: 3,
  /**
   * An adjacent parcel joins when at least this many lot vehicles stand on it:
   * a yard, not a neighbour's staff parking.
   */
  parcelMinVehicles: 10,
  /**
   * … or, for a small lot, this share of it (at least `minLotVehicles`): the
   * yard of a small dealer never holds ten cars, and its result was the
   * building parcel alone.
   */
  parcelMinLotShare: 0.3,
  /**
   * … and at least this many per 1,000 m² of its unbuilt area (parcel minus
   * buildings). Keeps a meadow with a row of cars at its edge out; a showroom
   * parcel, mostly roof, still joins.
   */
  parcelMinVehiclesPer1000Sqm: 3,
  /**
   * … or this many when the unbuilt area exceeds `largeUnbuiltSqm`. In the
   * 50-site run a 13,900 m² sand lot with 49 scattered detections (3.5)
   * joined a Berlin site at confidence 0.75; real yards stand at 20–70. A
   * global 5 cut a dealer's own yard where the lot reached only part of its
   * rows, and counting every vehicle on the parcel let dense street parking
   * of inner-city neighbours join (Hannover 0.90 → 0.34).
   */
  parcelMinVehiclesPer1000SqmLarge: 5,
  largeUnbuiltSqm: 10_000,
  /** Unbuilt area is never taken as less than this share of the parcel. */
  minUnbuiltShare: 0.2,
  /**
   * A small adjacent parcel also joins with fewer than `parcelMinVehicles`,
   * but at least `parcelDenseMinVehicles`, when its lot vehicles stand at
   * least `parcelDenseVehiclesPer1000Sqm` per 1,000 m² of unbuilt area: a
   * 970 m² corner of the yard holds five cars, not ten, and was cut out of
   * the lot as a notch (docs/boundary-model.md, "Cascade v8"). Three cars in
   * the courtyard of a town-centre block were not enough.
   */
  parcelDenseMinVehicles: 5,
  parcelDenseVehiclesPer1000Sqm: 8,
  /**
   * A short narrow parcel (street-like by width only, not longer than
   * `streetMinLengthM`) joins as a leaf — nothing grows from it — when at
   * least this many lot vehicles stand per 1,000 m² of the strip: a parking
   * strip or corner of the forecourt cut as its own plot, not a driveway
   * with a few cars at its edge.
   */
  stripMinVehiclesPer1000Sqm: 15,
  /**
   * A parcel of which at least this share of the outline borders the parcels
   * already chosen is enclosed by the lot and joins whatever stands on it: an
   * annex plot, a transformer, a driveway between two yards.
   */
  enclosedMinShare: 0.75,
  /** … unless it is larger than this share of the lot chosen so far. */
  enclosedMaxShareOfLot: 0.5,
  /**
   * Where the cadastre publishes land use, a parcel is a street when at
   * least this share of it is traffic area and it carries no house number
   * (a dealer's yard was found registered as "Weg" under its own address).
   */
  streetTrafficShare: 0.5,
  /**
   * A parcel of which at least this share is housing or open land (farmland,
   * woodland, parks) joins only by the dense rule, and joins as an enclosed
   * plot only below `enclosedForeignMaxSqm`: a neighbour's house or a meadow
   * inside the block is not the dealer's.
   */
  foreignUseShare: 0.5,
  enclosedForeignMaxSqm: 200,
  /**
   * A parcel of which at least this share is vegetation on the aerial image
   * is treated like open land: it joins only by the dense rule.
   */
  greenParcelShare: 0.5,
  /**
   * A parcel with the address of the parcel at the point joins without
   * vehicles up to this size, and beyond it only while it is no larger than
   * the parcels chosen so far.
   */
  addressJoinFreeSqm: 5000,
  /**
   * A parcel carrying the dealership's address counts as the parcel at the
   * point when it lies within this distance of a point whose own parcel has
   * another address or none.
   */
  addressAnchorReachM: 150,
  /** Vertex distance at which two parcels count as neighbours. */
  adjacentParcelM: 3,
  /**
   * Street test. Width is 2·area/perimeter, which is right for a strip but
   * also small for an L- or U-shaped yard; so a parcel is a street only when
   * it is narrower than `streetMaxWidthM` and either longer than
   * `streetMinLengthM` (its minimum bounding rectangle) or narrower than
   * `streetNarrowM`.
   */
  streetMaxWidthM: 20,
  streetMinLengthM: 150,
  streetNarrowM: 10,
  /** A street-like parcel with this many parallel street-like neighbours … */
  fieldStripMinNeighbours: 2,
  /** … within this angle is a field strip, not a street. */
  fieldStripMaxAngleDeg: 15,
  /**
   * The point is "off the lot" when the parcel at the point holds less than
   * this share of the lot vehicles off the street …
   */
  anchorOffLotShare: 0.25,
  /** … and the chosen parcels less than this share. */
  anchorOffLotResultShare: 0.5,
  /**
   * Margin around the outermost vehicle centres in the outline: half a car,
   * a driving lane and the forecourt edge.
   */
  hullMarginM: 10,
  /**
   * An outline needs at least this many vehicles. With fewer, the dealer's
   * stock was not seen, and the outline of a few cars is far too small.
   */
  hullMinVehicles: 20,
  /**
   * Gaps narrower than twice this between vehicles of the same lot (aisles,
   * empty bays, a showroom between rows) are filled in the outline.
   */
  hullCloseM: 20,
  /**
   * A building joins the outline when at least this share of it, or of its
   * outline, lies within `hullCloseM` of the lot vehicles: the showroom
   * between or among the rows.
   */
  hullBuildingShare: 0.5,
  /** Larger buildings (a neighbouring hall) never join the outline. */
  hullBuildingMaxSqm: 20_000,
  /** Vehicles outside the result but this close to it count as unexplained. */
  outsideNearbyM: 15,
  /**
   * Share of lot vehicles a parcel result must cover for full confidence.
   * Was 0.8; on 76 visually judged sites, correct results covered 0.70–0.78
   * of their lot (kerbside cars and a neighbour's yard in the lot) and were
   * flagged for that alone (docs/boundary-model.md, "Review calibration").
   */
  goodCoverage: 0.7,
  /**
   * A parcel across a street from the lot (adjacent to a street parcel the
   * lot borders, not to the lot) joins as a second part when at least this
   * many lot vehicles stand on it…
   */
  acrossMinVehicles: 10,
  /** … at this density (a parked-up car lot, not a customer car park)… */
  acrossMinVehiclesPer1000Sqm: 15,
  /** … or when it has the dealership's address and `minLotVehicles`. */
} as const;

export const CASCADE_CONFIDENCE = {
  vehicleParcels: 0.75,
  vehicleParcelsPartial: 0.6,
  /** Was 0.55; the outline scored a mean IoU of 0.23 in the November audit. */
  vehicleHull: 0.45,
  dealerMatchedInside: 0.65,
  dealerInside: 0.55,
  dealerMatchedNear: 0.5,
  /** Contains the point but carries another business's name. */
  dealerNamedOtherwise: 0.45,
  parcel: 0.4,
} as const;

export interface CascadeInput {
  anchor: LonLat;
  name?: string;
  address?: string;
  /**
   * Georeferenced vehicle centres from the context image, roofs masked.
   * Null when no detector or no image was available.
   */
  vehicles: LonLat[] | null;
  /** Null when OSM is not cached yet; the cascade never waits for it. */
  osm: OsmEvidence | null;
  parcels: ParcelFeature[];
  /**
   * True when the cadastre answer was capped even after paging, so parcels
   * may be missing (alkis.service.ts `truncated`).
   */
  parcelsTruncated?: boolean;
  /**
   * Building footprints (official ALKIS, OSM when cached). Used for the
   * unbuilt area of a parcel, the building the point lies in and the
   * buildings inside a vehicle outline. Empty where none are published.
   */
  buildings?: LonLat[][];
  /**
   * Traffic areas where there are no street parcels (Bayern: the ALKIS
   * land-use map). The outline is cut back there like at street parcels.
   */
  isStreetAt?: (point: LonLat) => boolean;
  /**
   * Vegetation on the aerial image (grass, trees in leaf); null outside the
   * image. A parcel that is mostly vegetation joins only when dense with
   * vehicles (boundary/vegetation.ts). It never reshapes a parcel.
   */
  vegetationAt?: (point: LonLat) => boolean | null;
  parameters: RiskParameters;
}

export interface StageOutcome {
  result: BoundaryResult | null;
  /** One line explaining why the stage accepted or declined. */
  reason: string;
  /** Geometries worth offering as alternatives even though not chosen. */
  alternatives: BoundaryResult[];
  /** Vehicles the stage counted as the lot, when it formed one. */
  lotVehicles?: number;
  /** Review conditions the stage found, kept only for the chosen stage. */
  flags?: BoundaryReviewFlag[];
}

export interface CascadeOutcome {
  /** Null when stages 1–4 all declined; the caller adds the circle. */
  result: BoundaryResult | null;
  stage: CascadeStage | null;
  trace: string[];
  alternatives: BoundaryResult[];
  /** Size of the vehicle lot at the point (stage 1 or 2), when one formed. */
  lotVehicles?: number;
  /** Conditions that send the result to review on their own. */
  flags: BoundaryReviewFlag[];
  /**
   * The point lies in woodland or open land with nothing of a dealership
   * near it; the caller then draws a small marker, not the full circle.
   */
  pointOffSite?: boolean;
  /**
   * The point the stages started from, when it is not the given one: a
   * point inside the parcel that carries the dealership's address.
   */
  anchor?: LonLat;
}
