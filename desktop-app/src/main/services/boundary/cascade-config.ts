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
 * 13: a road parcel is never the parcel at the point: the lot starts from
 * the plot beside it that holds the vehicles, and stage 4 declines; an
 * address that starts with the dealership's name is read
 * (docs/boundary-model.md, "Cascade v13").
 * 14: buildings are not divided: a footprint that lies mostly on the chosen
 * parcels, and the building at the point, is in the result whole; a vehicle
 * outline takes a building whole or not at all
 * (docs/boundary-model.md, "Cascade v14").
 * 15: outside Bayern the open land the cadastre registers inside a parcel
 * (`ave:NutzungFlurstueck`, seven states) is a unit of its own, and Hessen
 * and Brandenburg parcels get their land use from those sections
 * (parcel-sections.ts; docs/boundary-model.md, "Cascade v15").
 * 16: stage 1 is the site model: the parcel at the point grows onto the
 * neighbouring parcels a fitted model takes for the same site, from the
 * shared border and what the image shows on it, buildings across the line,
 * the vehicles and their rows, house numbers and land use. The reach limits
 * around the point (80 m, 160 m, 25 % extension), the vehicle-count joins
 * and the lot across the street are gone; "53", "53 b" and "53 c" are one
 * house number; a small parcel at the point is returned instead of the
 * circle (docs/boundary-model.md, "Site model").
 */
export const CASCADE_VERSION = 16;

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
  /** Fewer vehicles than this are a few parked cars, not a lot. */
  minLotVehicles: 3,
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
   * A parcel carrying the dealership's address counts as the parcel at the
   * point when it lies within this distance of a point whose own parcel has
   * another address or none.
   */
  addressAnchorReachM: 150,
  /**
   * A point on a road parcel starts from a plot within this distance: the
   * geocoder puts a house on the carriageway in front of it.
   */
  roadAnchorReachM: 40,
  /**
   * A parcel at the point larger than `maxParcelSqm` is a lot only with at
   * least this many vehicles per 1,000 m² of its unbuilt area (a dealer
   * centre on one parcel), and never beyond `boundaryMaxAreaSqm`.
   */
  largeSeedMinVehiclesPer1000Sqm: 5,
  /**
   * A parcel of the site with less than this share on the image the
   * vehicles were counted on asks for the wider image …
   */
  siteSeenShare: 0.9,
  /**
   * … and so does a parcel left out whose vehicles the image does not show
   * (under half of it on the image) and that the model gives at least this
   * probability without them.
   */
  unseenMinProbability: 0.1,
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
  /**
   * A building is not divided by the result's outline: with at least this
   * share of its footprint on the chosen parcels (or under the vehicle
   * outline) it is in the result whole. The parcel line under a showroom is
   * a legal line, not the edge of the site; in the November check both
   * Sachsen-Anhalt fixtures had the dealer's own showroom cut in two by it.
   * The building at the point is whole whatever its share. Limited to
   * footprints of `wholeBuildingMinSqm` to `hullBuildingMaxSqm`.
   */
  wholeBuildingShare: 0.5,
  /** Sheds and kiosks below this are left as the parcel line cuts them. */
  wholeBuildingMinSqm: 25,
  /** Vehicles outside the result but this close to it count as unexplained. */
  outsideNearbyM: 15,
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
   * image. A hedge or a verge on the line between two parcels speaks
   * against one site (boundary/vegetation.ts). It never reshapes a parcel.
   */
  vegetationAt?: (point: LonLat) => boolean | null;
  /**
   * [west, south, east, north] of the image the vehicles were detected on.
   * Beyond it "no vehicles" means "not seen"; without it every parcel
   * counts as seen.
   */
  imageBounds?: [number, number, number, number] | null;
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
   * The site, or a parcel in doubt at its edge, lies partly outside the
   * image the vehicles were counted on: a wider image may change the result.
   */
  imageTooSmall?: boolean;
  /**
   * The point the stages started from, when it is not the given one: a
   * point inside the parcel that carries the dealership's address.
   */
  anchor?: LonLat;
}
