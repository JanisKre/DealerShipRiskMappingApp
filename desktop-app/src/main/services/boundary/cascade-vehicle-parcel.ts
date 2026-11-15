import type {
  BoundaryGeometry,
  BoundaryResult,
  BoundaryReviewFlag,
} from "@shared/types";
import { geometryAreaSqm } from "@shared/boundary-geometry-utils";
import {
  distanceToRingM,
  projectPoint,
  type LonLat,
} from "../boundary-geometry";
import type { ParcelFeature } from "../alkis.service";
import { addressKeys, sharesAddress } from "./parcel-address";
import {
  CASCADE_LIMITS,
  CASCADE_CONFIDENCE,
  type CascadeStage,
  type CascadeInput,
  type StageOutcome,
} from "./cascade-config";
import {
  now,
  contains,
  geometryContains,
  metres,
  unionRings,
  withoutHoles,
  interiorPoint,
} from "./cascade-geometry";
import {
  vehicleLot,
  clusterIndices,
  anchorBuildingOf,
  anchorParcelOf,
} from "./cascade-anchors";
import {
  isFieldStrip,
  streetParcels,
  isStreetLike,
  isShortStrip,
  streetByUse,
  isStreetParcel,
  isForeignUse,
  greenShare,
  borderShare,
  unbuiltAreaSqm,
  isAdjacent,
} from "./cascade-parcels";

/**
 * The lot continued beyond `maxReachM`, up to `extendedReachM`: clusters of
 * at least `minLotVehicles` that share a vehicle with the lot (the same rows,
 * cut off at 80 m) or stand with at least `minLotVehicles` vehicles on parcels
 * the lot already holds. Bounded on purpose — counting every vehicle on a
 * neighbouring parcel chained into neighbouring businesses in the audit.
 */
export function extendLot(
  vehicles: LonLat[],
  anchor: LonLat,
  lot: LonLat[],
  members: LonLat[][],
): LonLat[] {
  const points = vehicles.filter(
    (v) => metres(anchor, v) <= CASCADE_LIMITS.extendedReachM,
  );
  const inLot = new Set(lot.map((v) => v.join()));
  const extended: LonLat[] = [];
  for (const cluster of clusterIndices(
    points.map((p) => projectPoint(p, anchor)),
  )) {
    if (cluster.length < CASCADE_LIMITS.minLotVehicles) continue;
    const vs = cluster.map((i) => points[i]);
    const continues = vs.some((v) => inLot.has(v.join()));
    const onMembers =
      vs.filter((v) => members.some((ring) => contains(ring, v))).length >=
      CASCADE_LIMITS.minLotVehicles;
    if (continues || onMembers) extended.push(...vs);
  }
  // Lot vehicles outside the extended reach cannot exist; keep the lot whole.
  const seen = new Set(extended.map((v) => v.join()));
  return [...extended, ...lot.filter((v) => !seen.has(v.join()))];
}

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
  if (atPoint && streetByUse(atPoint) !== true) {
    // A parcel without a house number is left alone: the showroom often
    // stands on one, and the numbered plot is the owner's house behind it.
    // So is a parcel with another number that holds vehicles: a yard is
    // often registered under the neighbouring number. In both cases the
    // parcels with the address join as neighbours (stage 1).
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
        streetByUse(parcel) !== true &&
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
 * `state` of parcels read from a rendered parcel map instead of a vector
 * service (bavaria-parcels.service.ts).
 */
const MAP_PARCEL_STATE = "Bayern";

export function parcelResult(
  geometry: BoundaryGeometry,
  areaSqm: number,
  state: string,
  confidence: number,
  stage: CascadeStage,
  label: string,
  role: "operationalLot" | "parcel",
): BoundaryResult {
  return {
    source: "alkis",
    role,
    provider: stage === 1 ? "alkis-vehicle-parcels" : "alkis-parcel",
    polygon: geometry,
    areaSqm,
    confidence,
    label,
    evidence: {
      source:
        state === MAP_PARCEL_STATE
          ? "ALKIS-Parzellarkarte Bayern © Bayerische Vermessungsverwaltung (CC BY 4.0)"
          : `ALKIS (${state})`,
      retrievedAt: now(),
      method:
        stage === 1
          ? "cascade stage 1: cadastral parcels holding the vehicle lot"
          : "cascade stage 4: cadastral parcel containing the point",
      confidence,
      fallbackUsed: false,
      limitations:
        stage === 1
          ? [
              "Parcels follow legal lines; part of a parcel may belong to another use",
              "Vehicles hidden by trees or shadow are not seen",
              ...(state === MAP_PARCEL_STATE
                ? [
                    "Parcels read from the Bayern parcel map, good to about half a metre; a building can split or shift a plot",
                  ]
                : []),
            ]
          : [
              "No vehicles seen; a parcel is a legal unit, not the operational lot",
            ],
    },
  };
}

// --- Stage 1: parcels holding the vehicle lot -----------------------------

/**
 * The parcel at the point, grown over shared edges onto every adjacent parcel
 * on which at least `parcelMinVehicles` lot vehicles stand. Street-like
 * parcels never join, so a lot never jumps a road. Growth stops at
 * `boundaryMaxAreaSqm`.
 */
export function vehicleParcelStage(input: CascadeInput): StageOutcome {
  if (!input.vehicles) {
    return { result: null, reason: "no vehicle detection", alternatives: [] };
  }
  const anchor = anchorParcelOf(input);
  if (!anchor) {
    return {
      result: null,
      reason:
        input.parcels.length === 0
          ? "no cadastral parcels here"
          : "no cadastral parcel contains the point",
      alternatives: [],
    };
  }
  if (anchor.areaSqm > CASCADE_LIMITS.maxParcelSqm) {
    return {
      result: null,
      reason: `parcel at the point is ${Math.round(anchor.areaSqm)} m², too large for one lot`,
      alternatives: [],
    };
  }
  if (isFieldStrip(anchor, input.parcels)) {
    return {
      result: null,
      reason:
        "parcel at the point is a field strip; the cadastre does not outline the site here",
      alternatives: [],
    };
  }
  const buildings = input.buildings ?? [];
  const firstLot = vehicleLot(
    input.vehicles,
    input.anchor,
    anchor.ring,
    anchorBuildingOf(input),
  );
  if (firstLot.length === 0) {
    return {
      result: null,
      reason: "no vehicle lot at the point",
      alternatives: [],
    };
  }

  // Parcels that joined by the strip or enclosure rule: named in the trace,
  // and not counted towards the minimum lot area.
  // Mostly vegetation on the image: a meadow or a wood, whatever the
  // cadastre registers it as.
  const isGreen = (parcel: ParcelFeature): boolean =>
    (greenShare(parcel.ring, input.vegetationAt, buildings) ?? 0) >=
    CASCADE_LIMITS.greenParcelShare;
  const isForeign = (parcel: ParcelFeature): boolean =>
    isForeignUse(parcel) || isGreen(parcel);
  const joinedAs = new Map<
    ParcelFeature,
    "strip" | "enclosed" | "address" | "across"
  >();
  // Parcels across the street are chosen on the first lot (within
  // `maxReachM`) only; later passes reuse that choice, so the lot beyond
  // 80 m is judged on the same parts as before.
  let acrossChosen: Set<ParcelFeature> | null = null;
  const siteKeys = new Set([
    ...addressKeys(anchor.address),
    ...addressKeys(input.address),
  ]);
  const grow = (
    lot: LonLat[],
    seed: ParcelFeature = anchor,
  ): ParcelFeature[] => {
    const vehiclesOn = (parcel: ParcelFeature): number =>
      lot.filter((v) => contains(parcel.ring, v)).length;
    const minVehicles = Math.max(
      CASCADE_LIMITS.minLotVehicles,
      Math.min(
        CASCADE_LIMITS.parcelMinVehicles,
        Math.ceil(CASCADE_LIMITS.parcelMinLotShare * lot.length),
      ),
    );
    // "grow": the parcel joins and the lot may grow on from it; "leaf": it
    // joins, but nothing grows from it (a strip could lead along a road).
    const joins = (parcel: ParcelFeature): "grow" | "leaf" | null => {
      if (parcel.areaSqm > CASCADE_LIMITS.maxParcelSqm) return null;
      const count = vehiclesOn(parcel);
      if (count < CASCADE_LIMITS.minLotVehicles) return null;
      const unbuilt = unbuiltAreaSqm(parcel, buildings);
      const density = (count / unbuilt) * 1000;
      const byUse = streetByUse(parcel);
      // A road by land use never joins, however many cars park on it.
      if (byUse === true) return null;
      if (byUse === null && isStreetLike(parcel.ring)) {
        // Field strips too: a strip full of cars is part of the yard. Its
        // density counts the whole strip; a building on it is no parking.
        return isShortStrip(parcel.ring) &&
          (count / parcel.areaSqm) * 1000 >=
            CASCADE_LIMITS.stripMinVehiclesPer1000Sqm
          ? "leaf"
          : null;
      }
      const minDensity =
        unbuilt > CASCADE_LIMITS.largeUnbuiltSqm
          ? CASCADE_LIMITS.parcelMinVehiclesPer1000SqmLarge
          : CASCADE_LIMITS.parcelMinVehiclesPer1000Sqm;
      return (count >= minVehicles &&
        density >= minDensity &&
        !isForeign(parcel)) ||
        (count >= CASCADE_LIMITS.parcelDenseMinVehicles &&
          density >= CASCADE_LIMITS.parcelDenseVehiclesPer1000Sqm)
        ? "grow"
        : null;
    };
    const members: ParcelFeature[] = [seed];
    let areaSqm = seed.areaSqm;
    const fits = (parcel: ParcelFeature): boolean =>
      areaSqm + parcel.areaSqm <= input.parameters.boundaryMaxAreaSqm;
    const queue = [seed];
    const touching = (a: ParcelFeature, b: ParcelFeature): boolean =>
      isAdjacent(a, b) || isAdjacent(b, a);
    // A second part of the lot across the street: a dense car lot, or a plot
    // with the dealership's address, directly across a street parcel the lot
    // borders. Only for the lot at the point, once.
    const acrossTheStreet = (): ParcelFeature[] => {
      const streets = input.parcels.filter(
        (parcel) =>
          !members.includes(parcel) &&
          isStreetParcel(parcel) &&
          members.some((member) => touching(parcel, member)),
      );
      if (streets.length === 0) return [];
      const found: ParcelFeature[] = [];
      for (const parcel of input.parcels) {
        if (members.includes(parcel) || streets.includes(parcel)) continue;
        if (parcel.areaSqm > CASCADE_LIMITS.maxParcelSqm) continue;
        if (
          streetByUse(parcel) === true ||
          (streetByUse(parcel) === null && isStreetLike(parcel.ring)) ||
          isForeign(parcel) ||
          !fits(parcel)
        )
          continue;
        if (!streets.some((street) => touching(parcel, street))) continue;
        if (members.some((member) => touching(parcel, member))) continue;
        const count = vehiclesOn(parcel);
        const density = (count / unbuiltAreaSqm(parcel, buildings)) * 1000;
        const dense =
          count >= CASCADE_LIMITS.acrossMinVehicles &&
          density >= CASCADE_LIMITS.acrossMinVehiclesPer1000Sqm;
        const ours =
          count >= CASCADE_LIMITS.minLotVehicles &&
          sharesAddress(siteKeys, parcel.address);
        if (dense || ours) found.push(parcel);
      }
      return found;
    };
    const across = (): ParcelFeature[] => {
      if (acrossChosen)
        return [...acrossChosen].filter(
          (parcel) => !members.includes(parcel) && fits(parcel),
        );
      acrossChosen = new Set(acrossTheStreet());
      return [...acrossChosen];
    };
    let crossed = seed !== anchor;
    for (;;) {
      while (queue.length > 0) {
        const current = queue.shift()!;
        for (const parcel of input.parcels) {
          if (members.includes(parcel) || !isAdjacent(parcel, current))
            continue;
          // A neighbouring parcel with the address of the parcel at the point
          // (or of the dealership) is the same property, cars on it or not.
          const sameAddress =
            parcel.areaSqm <= CASCADE_LIMITS.maxParcelSqm &&
            // Not a large plot that exceeds everything chosen so far: an
            // estate or a retail park registered under one address.
            parcel.areaSqm <=
              Math.max(areaSqm, CASCADE_LIMITS.addressJoinFreeSqm) &&
            // Not the owner's house or a field behind the yard.
            !isForeignUse(parcel) &&
            streetByUse(parcel) !== true &&
            !isGreen(parcel) &&
            sharesAddress(siteKeys, parcel.address);
          const kind = sameAddress ? "grow" : joins(parcel);
          if (!kind || !fits(parcel)) continue;
          members.push(parcel);
          areaSqm += parcel.areaSqm;
          if (kind === "grow") queue.push(parcel);
          else joinedAs.set(parcel, "strip");
          if (sameAddress && !joins(parcel)) joinedAs.set(parcel, "address");
        }
      }
      if (crossed) break;
      crossed = true;
      for (const parcel of across()) {
        if (!fits(parcel)) continue;
        members.push(parcel);
        areaSqm += parcel.areaSqm;
        joinedAs.set(parcel, "across");
        // The lot may continue from there by the usual rules.
        queue.push(parcel);
      }
      if (queue.length === 0) break;
    }
    // Parcels the lot encloses join whatever stands on them, so the result
    // has no notches or holes where the cadastre cuts out a small plot.
    for (let added = true; added;) {
      added = false;
      for (const parcel of input.parcels) {
        if (members.includes(parcel)) continue;
        if (
          parcel.areaSqm > CASCADE_LIMITS.enclosedMaxShareOfLot * areaSqm ||
          !fits(parcel) ||
          streetByUse(parcel) === true ||
          (streetByUse(parcel) === null &&
            isStreetLike(parcel.ring) &&
            !isShortStrip(parcel.ring)) ||
          (parcel.areaSqm > CASCADE_LIMITS.enclosedForeignMaxSqm &&
            (isGreen(parcel) ||
              (isForeignUse(parcel) &&
                !sharesAddress(siteKeys, parcel.address)))) ||
          !members.some((member) => isAdjacent(parcel, member))
        ) {
          continue;
        }
        if (
          borderShare(
            parcel,
            members.map((member) => member.ring),
          ) < CASCADE_LIMITS.enclosedMinShare
        ) {
          continue;
        }
        members.push(parcel);
        areaSqm += parcel.areaSqm;
        added = true;
        joinedAs.set(parcel, "enclosed");
      }
    }
    return members;
  };

  const build = (
    lot: LonLat[],
    members: ParcelFeature[],
  ): { areaSqm: number; result: BoundaryResult; reason: string } | null => {
    const union = unionRings(members.map((parcel) => parcel.ring));
    if (!union) return null;
    // Gaps between parcels the lot surrounds (slivers, a plot left out for
    // its size) are part of the site. The outline is cadastral lines only:
    // nothing is cut off a parcel by what the image shows on it.
    const geometry = withoutHoles(union);
    const areaSqm = geometryAreaSqm(geometry);
    const covered = lot.filter((v) => geometryContains(geometry, v)).length;
    const coverage = covered / lot.length;
    const acrossJoined = members.some((m) => joinedAs.get(m) === "across");
    // A part across the street is the rule's guess, not the cadastre's: the
    // result keeps the partial confidence, so it is offered for review.
    const confidence =
      coverage >= CASCADE_LIMITS.goodCoverage && !acrossJoined
        ? CASCADE_CONFIDENCE.vehicleParcels
        : CASCADE_CONFIDENCE.vehicleParcelsPartial;
    const joined = members.length - 1;
    const strips = members.filter((m) => joinedAs.get(m) === "strip").length;
    const enclosed = members.filter(
      (m) => joinedAs.get(m) === "enclosed",
    ).length;
    const byAddress = members.filter(
      (m) => joinedAs.get(m) === "address",
    ).length;
    const across = members.filter((m) => joinedAs.get(m) === "across").length;
    const detail = [
      ...(byAddress > 0 ? [`${byAddress} by address`] : []),
      ...(across > 0 ? [`${across} across the street`] : []),
      ...(strips > 0 ? [`${strips} parking strip(s)`] : []),
      ...(enclosed > 0 ? [`${enclosed} enclosed`] : []),
    ].join(", ");
    return {
      areaSqm,
      result: parcelResult(
        geometry,
        areaSqm,
        anchor.state,
        confidence,
        1,
        joined > 0 ? `ALKIS parcel + ${joined} with vehicles` : "ALKIS parcel",
        "operationalLot",
      ),
      reason: `parcel at the point${joined > 0 ? ` + ${joined} adjacent parcel(s)${detail ? ` (${detail})` : ""}` : ""} hold ${covered} of ${lot.length} lot vehicles (${Math.round(coverage * 100)}%)`,
    };
  };

  const firstMembers = grow(firstLot);
  const first = build(firstLot, firstMembers);
  if (!first) {
    return { result: null, reason: "parcel union failed", alternatives: [] };
  }
  // Area held by the parcel at the point and the parcels its vehicles grew
  // onto; strips and enclosed plots only complete such a lot.
  const grownSqm = firstMembers
    .filter(
      (parcel) =>
        !joinedAs.has(parcel) ||
        joinedAs.get(parcel) === "address" ||
        joinedAs.get(parcel) === "across",
    )
    .reduce((sum, parcel) => sum + parcel.areaSqm, 0);
  if (grownSqm < CASCADE_LIMITS.minLotSqm) {
    // A sliver at the point (a 128 m² town-centre plot in the 50-site run)
    // with nothing joined is not a lot; the vehicle outline does better. A
    // parking strip beside it does not make it one either.
    return {
      result: null,
      reason: `parcel at the point is ${Math.round(anchor.areaSqm)} m² and no parcel with vehicles joined, too small for a lot`,
      alternatives: [],
    };
  }
  const offLot = anchorOffLot(
    input,
    anchor,
    firstLot,
    first.result,
    grow,
    build,
  );
  // Second pass: rows cut off at `maxReachM`, and vehicles on parcels the lot
  // already holds, continue the lot up to `extendedReachM`.
  const lot = extendLot(
    input.vehicles,
    input.anchor,
    firstLot,
    firstMembers.map((parcel) => parcel.ring),
  );
  const extendedMembers = lot.length > firstLot.length ? grow(lot) : null;
  const extended =
    extendedMembers && extendedMembers.length > firstMembers.length
      ? build(lot, extendedMembers)
      : null;
  if (!extended) {
    return {
      ...first,
      reason: first.reason + offLot.note,
      alternatives: offLot.alternatives,
      lotVehicles: firstLot.length,
      flags: offLot.flags,
    };
  }
  const added = extended.areaSqm / first.areaSqm - 1;
  const note = `lot continued beyond ${CASCADE_LIMITS.maxReachM} m by ${lot.length - firstLot.length} vehicles adds ${Math.round(added * 100)}% area`;
  if (added <= CASCADE_LIMITS.maxExtensionShare) {
    return {
      result: extended.result,
      reason: `${extended.reason}; ${note}${offLot.note}`,
      alternatives: offLot.alternatives,
      lotVehicles: lot.length,
      flags: offLot.flags,
    };
  }
  return {
    result: first.result,
    reason: `${first.reason}; ${note}, offered as an alternative${offLot.note}`,
    alternatives: [
      {
        ...extended.result,
        label: `${extended.result.label ?? "ALKIS parcels"} (lot beyond ${CASCADE_LIMITS.maxReachM} m)`,
      },
      ...offLot.alternatives,
    ],
    lotVehicles: firstLot.length,
    flags: offLot.flags,
  };
}

/**
 * Whether the point lies off the vehicle lot: the parcel at the point holds
 * less than `anchorOffLotShare`, and the chosen parcels less than
 * `anchorOffLotResultShare`, of the lot vehicles that are not on a street
 * (kerbside cars say nothing about which plot is the dealer's). The point is
 * then often on a neighbouring plot or in the wrong building; the result is
 * kept, flagged `anchorOffLot`, and the parcels around the parcel holding
 * most of the lot are offered as an alternative.
 */
function anchorOffLot(
  input: CascadeInput,
  anchor: ParcelFeature,
  lot: LonLat[],
  result: BoundaryResult,
  grow: (lot: LonLat[], seed?: ParcelFeature) => ParcelFeature[],
  build: (
    lot: LonLat[],
    members: ParcelFeature[],
  ) => { areaSqm: number; result: BoundaryResult; reason: string } | null,
): {
  flags: BoundaryReviewFlag[];
  alternatives: BoundaryResult[];
  note: string;
} {
  const none = { flags: [], alternatives: [], note: "" };
  const streets = streetParcels(input.parcels);
  const offStreet = lot.filter(
    (v) => ![...streets].some((street) => contains(street.ring, v)),
  );
  if (offStreet.length < CASCADE_LIMITS.minLotVehicles) return none;
  const onAnchor = offStreet.filter((v) => contains(anchor.ring, v)).length;
  const onResult = offStreet.filter((v) =>
    geometryContains(result.polygon, v),
  ).length;
  if (
    onAnchor / offStreet.length >= CASCADE_LIMITS.anchorOffLotShare ||
    onResult / offStreet.length >= CASCADE_LIMITS.anchorOffLotResultShare
  ) {
    return none;
  }
  const note = `; the point lies off the lot (its parcel holds ${onAnchor} of ${offStreet.length} lot vehicles off the street)`;
  const seed = input.parcels
    .filter(
      (parcel) =>
        parcel !== anchor &&
        parcel.areaSqm <= CASCADE_LIMITS.maxParcelSqm &&
        !isStreetParcel(parcel),
    )
    .map((parcel) => ({
      parcel,
      count: offStreet.filter((v) => contains(parcel.ring, v)).length,
    }))
    .sort((a, b) => b.count - a.count)[0];
  const alternative =
    seed && seed.count >= CASCADE_LIMITS.minLotVehicles
      ? build(lot, grow(lot, seed.parcel))
      : null;
  return {
    flags: ["anchorOffLot"],
    alternatives: alternative
      ? [
          {
            ...alternative.result,
            label: "ALKIS parcels holding the vehicle lot",
          },
        ]
      : [],
    note,
  };
}
