import { STATE_CADASTRE_SERVICES } from "@shared/cadastre-sources";
import type { GermanState } from "@shared/imagery-sources";
import type { BoundaryGeometry, BoundaryResult } from "@shared/types";
import { geometryAreaSqm } from "@shared/boundary-geometry-utils";
import { distanceToRingM, type LonLat } from "../boundary-geometry";
import type { ParcelFeature } from "../alkis.service";
import { addressKeys, sharesAddress } from "./parcel-address";
import {
  CASCADE_LIMITS,
  CASCADE_CONFIDENCE,
  type CascadeInput,
  type StageOutcome,
} from "./cascade-config";
import {
  now,
  contains,
  unionRings,
  withoutHoles,
  interiorPoint,
} from "./cascade-geometry";
import { anchorParcelOf, completeBuildings } from "./cascade-anchors";
import {
  isFieldStrip,
  isForeignUse,
  isRoadParcel,
  streetByUse,
} from "./cascade-parcels";
import {
  buildSiteGraph,
  parcelEvidence,
  frontier,
  siteIdentity,
  unbuiltSqm,
  vehiclesOnParcels,
  type SiteGraph,
  type SiteIdentity,
} from "./site-graph";
import {
  growSite,
  mainReasons,
  merelyTouches,
  SITE_FEATURE_LIMITS,
  SITE_MODEL,
  type SiteDecision,
  type SiteGrowth,
} from "./site-model";

/**
 * Stage 1 of the cascade since v16: the site as a set of whole cadastral
 * parcels, chosen by the site model (`site-model.ts`).
 *
 * The parcel the dealership stands on is the seed. Every parcel bordering
 * the site is judged on its evidence — shared border and what lies on it,
 * a building across the line, the vehicles on it and how they continue the
 * site's rows, house numbers, land use — and joins when the model gives it
 * `SITE_MODEL.joinAt` or more. There is no reach limit: the site ends where
 * the evidence ends, not at a distance from the geocoded point.
 */

// --- The parcel the dealership stands on ----------------------------------

/**
 * The parcel that carries the dealership's address, when the parcel at the
 * point does not: a geocoded point often lands on the road, on a
 * neighbour's plot or at the wrong end of a long site. The point moves only
 * when it lies on no parcel, on a street, or on a parcel with another house
 * number and fewer than `minLotVehicles` vehicles. Null otherwise, and when
 * the address is unknown, the cadastre publishes none or no parcel within
 * `addressAnchorReachM` carries it.
 */
export function addressAnchor(
  input: CascadeInput,
): { anchor: LonLat; distanceM: number } | null {
  const keys = new Set(addressKeys(input.address));
  if (keys.size === 0) return null;
  const atPoint = anchorParcelOf(input);
  if (atPoint && !isRoadParcel(atPoint, input.parcels)) {
    // A parcel without a house number is left alone: the showroom often
    // stands on one, and the numbered plot is the owner's house behind it.
    // So is a parcel with another number that holds vehicles: a yard is
    // often registered under the neighbouring number. In both cases the
    // parcels with the address join as neighbours.
    const numbered = addressKeys(atPoint.address).length > 0;
    const vehiclesHere = (input.vehicles ?? []).filter((v) =>
      contains(atPoint.ring, v),
    ).length;
    if (
      !numbered ||
      sharesAddress(keys, atPoint.address) ||
      vehiclesHere >= CASCADE_LIMITS.minLotVehicles
    ) {
      return null;
    }
  }
  const nearest = input.parcels
    .filter(
      (parcel) =>
        parcel.areaSqm <= CASCADE_LIMITS.maxParcelSqm &&
        !isRoadParcel(parcel, input.parcels) &&
        sharesAddress(keys, parcel.address),
    )
    .map((parcel) => ({
      parcel,
      distanceM: distanceToRingM(input.anchor, parcel.ring),
    }))
    .filter((c) => c.distanceM <= CASCADE_LIMITS.addressAnchorReachM)
    .sort((a, b) => a.distanceM - b.distanceM)[0];
  if (!nearest) return null;
  return {
    anchor: interiorPoint(nearest.parcel.ring),
    distanceM: nearest.distanceM,
  };
}

/**
 * For a point on a road parcel: the plot within `roadAnchorReachM` that
 * holds the most vehicles, at least `minLotVehicles` (the geocoder puts a
 * house on the carriageway in front of it); without vehicles the plot with
 * the largest building there. Null when the plots beside the road show
 * neither.
 */
function plotBesideRoad(
  input: CascadeInput,
  road: ParcelFeature,
): { parcel: ParcelFeature; note: string } | null {
  const plots = input.parcels
    .filter(
      (parcel) =>
        parcel !== road &&
        parcel.areaSqm <= CASCADE_LIMITS.maxParcelSqm &&
        !isRoadParcel(parcel, input.parcels) &&
        distanceToRingM(input.anchor, parcel.ring) <=
          CASCADE_LIMITS.roadAnchorReachM,
    )
    .map((parcel) => ({
      parcel,
      vehicles: (input.vehicles ?? []).filter((v) => contains(parcel.ring, v))
        .length,
      distanceM: distanceToRingM(input.anchor, parcel.ring),
    }));
  const byVehicles = plots
    .filter((plot) => plot.vehicles >= CASCADE_LIMITS.minLotVehicles)
    .sort((a, b) => b.vehicles - a.vehicles || a.distanceM - b.distanceM)[0];
  if (byVehicles) {
    return {
      parcel: byVehicles.parcel,
      note: `the point lies on a road parcel; the plot beside it (${byVehicles.vehicles} vehicles)`,
    };
  }
  return null;
}

// --- Result ---------------------------------------------------------------

/**
 * `state` of parcels read from a rendered parcel map instead of a vector
 * service (bavaria-parcels.service.ts).
 */
const MAP_PARCEL_STATE = "Bayern";

/** State names of the cadastre services → state codes of the source registry. */
const CADASTRE_STATE_CODES: Record<string, GermanState> = {
  NRW: "NW",
  Sachsen: "SN",
  Niedersachsen: "NI",
  "Schleswig-Holstein": "SH",
  "Sachsen-Anhalt": "ST",
  Brandenburg: "BB",
  Berlin: "BE",
  Hessen: "HE",
  "Baden-Württemberg": "BW",
  Saarland: "SL",
  Hamburg: "HH",
  Bremen: "HB",
  "Mecklenburg-Vorpommern": "MV",
  Thüringen: "TH",
  "Rheinland-Pfalz": "RP",
  Bayern: "BY",
};

/**
 * Source line of a parcel result with the attribution the state's licence
 * requires (dl-de/by-2-0 and CC BY 4.0 ask for it); the state name alone
 * when the registry has no entry.
 */
export function cadastreSourceLine(state: string): string {
  if (state === MAP_PARCEL_STATE)
    return "ALKIS-Parzellarkarte Bayern © Bayerische Vermessungsverwaltung (CC BY 4.0)";
  const code = CADASTRE_STATE_CODES[state];
  const service = code ? STATE_CADASTRE_SERVICES[code] : undefined;
  if (!service) return `ALKIS (${state})`;
  const attribution = service.attribution.replaceAll(
    "{year}",
    String(new Date().getFullYear()),
  );
  return `ALKIS (${state}) ${attribution}`;
}

/** Providers of a parcel result: the chosen site and its two variants. */
export type SiteProvider =
  | "alkis-vehicle-parcels"
  | "alkis-parcel"
  | "alkis-site-core"
  | "alkis-site-extended";

export function parcelResult(
  geometry: BoundaryGeometry,
  areaSqm: number,
  state: string,
  confidence: number,
  provider: SiteProvider,
  label: string,
): BoundaryResult {
  const withLot = provider !== "alkis-parcel";
  return {
    source: "alkis",
    role: withLot ? "operationalLot" : "parcel",
    provider,
    polygon: geometry,
    areaSqm,
    confidence,
    label,
    evidence: {
      source: cadastreSourceLine(state),
      retrievedAt: now(),
      method: withLot
        ? "cascade stage 1: cadastral parcels of the site (site model)"
        : "cascade stage 4: cadastral parcels at the point, no vehicle lot seen",
      confidence,
      fallbackUsed: false,
      limitations: [
        "Parcels follow legal lines; part of a parcel may belong to another use",
        "Which neighbouring parcels belong to the site is an estimate from the image and the cadastre, not ownership",
        "A building standing across a parcel line is included whole when most of it is on the chosen parcels",
        ...(withLot
          ? ["Vehicles hidden by trees or shadow are not seen"]
          : [
              "No vehicle lot seen at the point; the parcels are a legal unit, not the operational lot",
            ]),
        ...(state === MAP_PARCEL_STATE
          ? [
              "Parcels read from the Bayern parcel map, good to about half a metre; a building can split or shift a plot",
            ]
          : []),
      ],
    },
  };
}

// --- Stage ----------------------------------------------------------------

/** What `siteStage` reports besides the usual stage outcome. */
export interface SiteStageOutcome extends StageOutcome {
  /**
   * The site holds a vehicle lot (`minLotVehicles` on its parcels) and is
   * at least `minLotSqm`: a stage-1 result. Without, the same parcels are
   * the stage-4 answer.
   */
  hasLot: boolean;
  /**
   * A parcel of the site, or one in doubt, lies partly outside the image
   * the vehicles were counted on: a wider image may change the answer.
   */
  imageTooSmall: boolean;
}

function declined(reason: string): SiteStageOutcome {
  return {
    result: null,
    reason,
    alternatives: [],
    hasLot: false,
    imageTooSmall: false,
  };
}

/**
 * Parcels the site all but encloses join whatever stands on them, so the
 * result has no notches where the cadastre cuts out a small plot: at least
 * `enclosedMinShare` of the outline on the site, no larger than
 * `enclosedMaxShareOfLot` of it, and not a neighbour's house or garden.
 */
function encloseParcels(
  graph: SiteGraph,
  members: Set<number>,
  site: SiteIdentity,
  excluded: (index: number) => boolean,
  maxAreaSqm: number,
): number[] {
  const added: number[] = [];
  let areaSqm = [...members].reduce(
    (sum, index) => sum + graph.parcels[index].areaSqm,
    0,
  );
  for (let changed = true; changed;) {
    changed = false;
    for (const index of frontier(graph, members)) {
      const parcel = graph.parcels[index];
      if (
        streetByUse(parcel) === true ||
        (excluded(index) &&
          parcel.areaSqm > CASCADE_LIMITS.enclosedForeignMaxSqm)
      ) {
        continue;
      }
      if (
        parcel.areaSqm > CASCADE_LIMITS.enclosedMaxShareOfLot * areaSqm ||
        areaSqm + parcel.areaSqm > maxAreaSqm
      ) {
        continue;
      }
      const evidence = parcelEvidence(graph, members, index, site);
      if (evidence.borderOfParcel < CASCADE_LIMITS.enclosedMinShare) continue;
      if (
        parcel.areaSqm > CASCADE_LIMITS.enclosedForeignMaxSqm &&
        isForeignUse(parcel) &&
        evidence.address !== "same"
      ) {
        continue;
      }
      members.add(index);
      added.push(index);
      areaSqm += parcel.areaSqm;
      changed = true;
    }
  }
  return added;
}

function describe(decision: SiteDecision, joined: boolean): string {
  const reasons = mainReasons(decision.evidence);
  return `${Math.round(decision.evidence.areaSqm)} m² ${joined ? "joined" : "left out"} at ${Math.round(decision.probability * 100)}%${reasons.length > 0 ? ` (${reasons.join(", ")})` : ""}`;
}

/**
 * The site at the point: the seed parcel grown by the site model. Declines
 * when no plot is found at the point, or when the parcel there is too large
 * to be one lot and not dense with vehicles.
 */
export function siteStage(input: CascadeInput): SiteStageOutcome {
  const atPoint = anchorParcelOf(input);
  if (!atPoint) {
    return declined(
      input.parcels.length === 0
        ? "no cadastral parcels here"
        : "no cadastral parcel contains the point",
    );
  }
  // A road is never the lot: the lot is the plot beside it.
  const onRoad = isRoadParcel(atPoint, input.parcels);
  const beside = onRoad ? plotBesideRoad(input, atPoint) : null;
  if (onRoad && !beside) {
    return declined(
      `the point lies on a road parcel and no plot within ${CASCADE_LIMITS.roadAnchorReachM} m holds vehicles`,
    );
  }
  const seedParcel = beside?.parcel ?? atPoint;
  const start = beside?.note ?? "parcel at the point";
  const maxAreaSqm = input.parameters.boundaryMaxAreaSqm;
  if (seedParcel.areaSqm > maxAreaSqm) {
    return declined(
      `${start} is ${Math.round(seedParcel.areaSqm)} m², too large for one lot`,
    );
  }

  if (isFieldStrip(seedParcel, input.parcels)) {
    // A strip in a row of equal strips runs far beyond a site that stands
    // across several of them (v4): the cadastre does not outline it here.
    return declined(
      "parcel at the point is a field strip; the cadastre does not outline the site here",
    );
  }

  const graph = buildSiteGraph({
    anchor: input.anchor,
    parcels: input.parcels,
    vehicles: input.vehicles,
    buildings: input.buildings ?? [],
    imageBounds: input.imageBounds ?? null,
    ...(input.vegetationAt ? { vegetationAt: input.vegetationAt } : {}),
  });
  const seed = input.parcels.indexOf(seedParcel);
  if (seedParcel.areaSqm > CASCADE_LIMITS.maxParcelSqm) {
    // An estate or a retail park is one parcel as well; it is a lot only
    // when it is full of vehicles.
    const density =
      (graph.vehiclesOn[seed].length / unbuiltSqm(graph, seed)) * 1000;
    if (density < CASCADE_LIMITS.largeSeedMinVehiclesPer1000Sqm) {
      return declined(
        `${start} is ${Math.round(seedParcel.areaSqm)} m² with ${graph.vehiclesOn[seed].length} vehicles, too large and too empty for one lot`,
      );
    }
  }
  const site = siteIdentity(graph, seed, input.address);
  const road = input.parcels.map(
    (parcel) =>
      isRoadParcel(parcel, input.parcels) ||
      parcel.areaSqm > CASCADE_LIMITS.maxParcelSqm,
  );
  const excluded = (index: number): boolean => road[index];
  const grow = (
    joinAt: number,
  ): { growth: SiteGrowth; members: Set<number>; enclosed: number[] } => {
    const growth = growSite(graph, seed, site, {
      excluded,
      maxAreaSqm,
      joinAt,
    });
    const members = new Set(growth.members);
    const enclosed = encloseParcels(graph, members, site, excluded, maxAreaSqm);
    return { growth, members, enclosed };
  };
  const geometryOf = (
    members: Set<number>,
  ): {
    geometry: BoundaryGeometry;
    areaSqm: number;
    completed: number;
  } | null => {
    const union = unionRings([...members].map((i) => input.parcels[i].ring));
    if (!union) return null;
    // Gaps between parcels the site surrounds are part of it. The outline
    // is cadastral lines only; a building the lines would cut in two is in
    // whole, along its own outline.
    const whole = completeBuildings(withoutHoles(union), input);
    return {
      geometry: whole.geometry,
      areaSqm: geometryAreaSqm(whole.geometry),
      completed: whole.added,
    };
  };

  const chosen = grow(SITE_MODEL.joinAt);
  const shape = geometryOf(chosen.members);
  if (!shape) return declined("parcel union failed");

  const vehicles = vehiclesOnParcels(graph, chosen.members);
  const hasLot =
    input.vehicles != null &&
    vehicles >= CASCADE_LIMITS.minLotVehicles &&
    shape.areaSqm >= CASCADE_LIMITS.minLotSqm;

  // Doubts: parcels that joined narrowly, and parcels that narrowly did not.
  const worthNoting = (decision: SiteDecision): boolean =>
    decision.evidence.areaSqm >= SITE_MODEL.doubtMinSqm;
  const narrowlyIn = chosen.growth.joined.filter(
    (d) => d.probability < SITE_MODEL.sureFrom && worthNoting(d),
  );
  const narrowlyOut = chosen.growth.rejected.filter(
    (d) =>
      d.probability >= SITE_MODEL.doubtFrom &&
      worthNoting(d) &&
      !merelyTouches(d.evidence) &&
      !chosen.members.has(d.parcel),
  );
  const doubts = narrowlyIn.length + narrowlyOut.length;

  // The image is too small when a parcel of the site lies partly outside
  // it, or when a parcel left out lies mostly outside it and either the
  // dealer's rows run onto it or vehicles on it could still make it join.
  const imageTooSmall =
    input.imageBounds != null &&
    ([...chosen.members].some(
      (index) => graph.seenShare[index] < CASCADE_LIMITS.siteSeenShare,
    ) ||
      chosen.growth.rejected.some(
        (d) =>
          worthNoting(d) &&
          d.evidence.seenShare < SITE_FEATURE_LIMITS.seenMin &&
          !merelyTouches(d.evidence) &&
          (d.evidence.lotVehicles >= CASCADE_LIMITS.minLotVehicles ||
            d.probability >= CASCADE_LIMITS.unseenMinProbability),
      ));

  const confidence = !hasLot
    ? CASCADE_CONFIDENCE.parcel
    : doubts === 0 && !chosen.growth.capped
      ? CASCADE_CONFIDENCE.vehicleParcels
      : CASCADE_CONFIDENCE.vehicleParcelsPartial;
  const joinedCount = chosen.members.size - 1;
  const label =
    joinedCount > 0 ? `ALKIS parcel + ${joinedCount} adjacent` : "ALKIS parcel";
  const result = parcelResult(
    shape.geometry,
    shape.areaSqm,
    seedParcel.state,
    confidence,
    hasLot ? "alkis-vehicle-parcels" : "alkis-parcel",
    label,
  );

  // The two variants a reviewer may want instead: without the parcels in
  // doubt, and with those that narrowly stayed out.
  const alternatives: BoundaryResult[] = [];
  const variant = (
    joinAt: number,
    provider: SiteProvider,
    name: string,
  ): void => {
    const other = grow(joinAt);
    if (
      other.members.size === chosen.members.size &&
      [...other.members].every((index) => chosen.members.has(index))
    ) {
      return;
    }
    const otherShape = geometryOf(other.members);
    if (!otherShape) return;
    alternatives.push(
      parcelResult(
        otherShape.geometry,
        otherShape.areaSqm,
        seedParcel.state,
        CASCADE_CONFIDENCE.vehicleParcelsPartial,
        provider,
        name,
      ),
    );
  };
  if (hasLot) {
    variant(SITE_MODEL.sureFrom, "alkis-site-core", "ALKIS parcels, sure only");
    variant(
      SITE_MODEL.doubtFrom,
      "alkis-site-extended",
      "ALKIS parcels with doubtful neighbours",
    );
  }

  const parts = [
    `${start}${joinedCount > 0 ? ` + ${joinedCount} adjacent parcel(s)${chosen.enclosed.length > 0 ? ` (${chosen.enclosed.length} enclosed)` : ""}` : ""}, ${Math.round(shape.areaSqm)} m²` +
      (input.vehicles != null ? ` with ${vehicles} vehicles` : ""),
    ...(shape.completed > 0
      ? [`${shape.completed} building(s) across the parcel line kept whole`]
      : []),
    ...narrowlyIn.slice(0, 3).map((d) => `in doubt: ${describe(d, true)}`),
    ...narrowlyOut.slice(0, 3).map((d) => `in doubt: ${describe(d, false)}`),
    ...(chosen.growth.capped
      ? [`growth stopped at the area limit of ${Math.round(maxAreaSqm)} m²`]
      : []),
    ...(imageTooSmall
      ? ["the site reaches beyond the image the vehicles were counted on"]
      : []),
  ];
  return {
    result,
    reason: parts.join("; "),
    alternatives,
    lotVehicles: vehicles,
    hasLot,
    imageTooSmall,
  };
}
