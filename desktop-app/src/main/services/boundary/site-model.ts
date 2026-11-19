import {
  frontier,
  parcelEvidence,
  type ParcelEvidence,
  type SiteGraph,
  type SiteIdentity,
} from "./site-graph";

/**
 * Site model: which parcels next to the dealership's parcel belong to it.
 *
 * One question is asked of every parcel that borders the parcels chosen so
 * far — "is this part of the same site?" — and answered with a probability
 * from a small logistic model over evidence that can be read off the
 * cadastre, the footprints, the aerial image and the detected vehicles
 * (`ParcelEvidence`). The most probable parcel joins, the evidence of the
 * rest is read again against the larger site, and so on until no parcel
 * reaches `SITE_MODEL.joinAt`.
 *
 * The weights are fitted, not set by hand: on the public reference lots
 * (boundary-public-v2) and on the eye-judged directory sample of November
 * 2026, cross-validated by state (docs/boundary-model.md, "Site model").
 * They are log-odds, so each can be read on its own: a positive weight
 * speaks for the parcel, a negative one against it.
 */

/** Feature names in the order of `SITE_MODEL.weights`. */
export const SITE_FEATURES = [
  "bias",
  "borderOfParcel",
  "openBorder",
  "greenBorder",
  "borderUnseen",
  "thin",
  "sharedBuilding",
  "ownBuilding",
  "firstBuilding",
  "density",
  "yard",
  "lot",
  "firstLot",
  "unseen",
  "addressSame",
  "addressOther",
  "residential",
  "open",
  "useUnknown",
  "sliver",
] as const;

export type SiteFeature = (typeof SITE_FEATURES)[number];

/** Caps that turn measurements into the bounded features the model is fitted on. */
export const SITE_FEATURE_LIMITS = {
  /** Metres of open shared border at which the feature saturates. */
  openBorderCapM: 40,
  /** A candidate at least this many times the site so far … */
  thinAreaRatio: 1.5,
  /** … sharing less than this of its outline with it merely touches it. */
  thinBorderShare: 0.12,
  /** Vehicles per 1,000 m² of unbuilt area at which density saturates. */
  densityCap: 30,
  /** Vehicles of the lot at the point at which the count saturates. */
  lotCap: 10,
  /** Fewer vehicles than this on the site are no vehicle lot … */
  lotVehicles: 3,
  /** … and a candidate with this many is one. */
  firstLotVehicles: 5,
  /** Below this area a parcel is a sliver. */
  sliverSqm: 300,
  /** Below this share on the image a parcel's vehicles are unknown. */
  seenMin: 0.5,
} as const;

/** The evidence as the numbers the model is fitted on, in `SITE_FEATURES` order. */
export function siteFeatures(e: ParcelEvidence): number[] {
  const L = SITE_FEATURE_LIMITS;
  const seen = e.seenShare >= L.seenMin;
  const use = e.landUse;
  const density = seen ? Math.min(e.density, L.densityCap) / L.densityCap : 0;
  return [
    1,
    e.borderOfParcel,
    e.openBorderM == null
      ? 0
      : Math.min(e.openBorderM, L.openBorderCapM) / L.openBorderCapM,
    e.greenBorder ?? 0,
    e.openBorderM == null ? 1 : 0,
    // A plot larger than the site that merely touches it.
    e.areaRatio >= L.thinAreaRatio && e.borderOfParcel < L.thinBorderShare
      ? 1
      : 0,
    e.sharedBuilding ? 1 : 0,
    e.ownBuilding ? 1 : 0,
    e.firstBuilding ? 1 : 0,
    density,
    // A dense lot that lies at the site with most of its cars.
    seen ? density * e.nearShare : 0,
    seen ? Math.min(e.lotVehicles, L.lotCap) / L.lotCap : 0,
    // The site so far shows no vehicle lot, and the candidate does.
    seen && e.siteVehicles < L.lotVehicles && e.vehicles >= L.firstLotVehicles
      ? 1
      : 0,
    seen ? 0 : 1,
    e.address === "same" ? 1 : 0,
    e.address === "other" ? 1 : 0,
    use?.residential ?? 0,
    use?.open ?? 0,
    use ? 0 : 1,
    e.areaSqm < L.sliverSqm ? 1 : 0,
  ];
}

export const SITE_MODEL = {
  /**
   * A parcel joins from this probability. Below one half on purpose: what
   * users reported were lots cut off, and in cross-validation 0.4 cut fewer
   * sites off without taking visibly more.
   */
  joinAt: 0.4,
  /**
   * A parcel that joined below this is a doubt, and so is one that stayed
   * out at or above `doubtFrom`: the result then goes to review, with the
   * site without the first and with the second as alternatives. Chosen so
   * that about as many results are flagged as before the model (37 %), of
   * which the wrong ones are the larger share.
   */
  sureFrom: 0.5,
  doubtFrom: 0.3,
  /** Doubts about parcels smaller than this are not reported. */
  doubtMinSqm: 500,
  /** Log-odds per feature, in `SITE_FEATURES` order (fitted). */
  weights: [
    -2.87, 1.25, 0.94, -1.21, -0.34, -0.78, 2.39, -0.51, 1.71, 1.71, 1.13, 1.22,
    1.92, -1.03, 0.87, -1.28, -1.27, -0.4, -0.65, 0.51,
  ] as number[],
};

/**
 * A plot larger than the site that merely touches it (`thinAreaRatio`,
 * `thinBorderShare`), while the site has a vehicle lot of its own: a car
 * compound or a neighbour's yard at a corner of the lot. Such a plot never
 * joins, however many cars stand on it — the model alone let a 14,000 m²
 * new-car compound join a dealer over 30 m of shared fence, because its
 * rows chained to his. A site without a lot is exempt: the point is then
 * often on the owner's house, and the dealership is the large plot behind.
 */
export function merelyTouches(e: ParcelEvidence): boolean {
  const L = SITE_FEATURE_LIMITS;
  return (
    e.areaRatio >= L.thinAreaRatio &&
    e.borderOfParcel < L.thinBorderShare &&
    e.siteVehicles >= L.lotVehicles &&
    !e.sharedBuilding
  );
}

export function memberProbability(
  evidence: ParcelEvidence,
  weights: readonly number[] = SITE_MODEL.weights,
): number {
  const x = siteFeatures(evidence);
  let z = 0;
  for (let i = 0; i < x.length; i += 1) z += (weights[i] ?? 0) * x[i];
  return 1 / (1 + Math.exp(-z));
}

/**
 * The features that moved the decision most, as "name ±weight" — for the
 * trace, so a reviewer sees why a parcel joined or stayed out.
 */
export function mainReasons(
  evidence: ParcelEvidence,
  count = 3,
  weights: readonly number[] = SITE_MODEL.weights,
): string[] {
  const x = siteFeatures(evidence);
  return x
    .map((value, i) => ({
      name: SITE_FEATURES[i],
      effect: value * (weights[i] ?? 0),
    }))
    .filter((term) => term.name !== "bias" && Math.abs(term.effect) >= 0.15)
    .sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect))
    .slice(0, count)
    .map(
      (term) =>
        `${term.name} ${term.effect > 0 ? "+" : "−"}${Math.abs(term.effect).toFixed(1)}`,
    );
}

export interface SiteDecision {
  parcel: number;
  probability: number;
  joined: boolean;
  evidence: ParcelEvidence;
}

export interface SiteGrowth {
  /** Parcel indices of the site, the seed first, in the order they joined. */
  members: number[];
  /** Every parcel that joined, with the evidence at the time. */
  joined: SiteDecision[];
  /** Parcels at the edge of the final site that did not join, most probable first. */
  rejected: SiteDecision[];
  areaSqm: number;
  /** Growth stopped at `maxAreaSqm` with a parcel still wanting to join. */
  capped: boolean;
}

export interface SiteGrowthOptions {
  /** Parcels that can never be part of a site (streets, rails, water). */
  excluded: (index: number) => boolean;
  maxAreaSqm: number;
  weights?: readonly number[];
  joinAt?: number;
}

/**
 * Grows the site from `seed`: the most probable bordering parcel joins,
 * while one reaches `joinAt` and the site stays under `maxAreaSqm`.
 */
export function growSite(
  graph: SiteGraph,
  seed: number,
  site: SiteIdentity,
  options: SiteGrowthOptions,
): SiteGrowth {
  const joinAt = options.joinAt ?? SITE_MODEL.joinAt;
  const members = new Set<number>([seed]);
  const joined: SiteDecision[] = [];
  let areaSqm = graph.parcels[seed].areaSqm;
  let capped = false;
  const judge = (index: number): SiteDecision => {
    const evidence = parcelEvidence(graph, members, index, site);
    return {
      parcel: index,
      probability: memberProbability(evidence, options.weights),
      joined: false,
      evidence,
    };
  };
  for (;;) {
    let best: SiteDecision | null = null;
    for (const index of frontier(graph, members)) {
      if (options.excluded(index)) continue;
      const decision = judge(index);
      if (decision.probability < joinAt) continue;
      if (merelyTouches(decision.evidence)) continue;
      if (areaSqm + graph.parcels[index].areaSqm > options.maxAreaSqm) {
        capped = true;
        continue;
      }
      if (!best || decision.probability > best.probability) best = decision;
    }
    if (!best) break;
    members.add(best.parcel);
    areaSqm += graph.parcels[best.parcel].areaSqm;
    joined.push({ ...best, joined: true });
  }
  const rejected = frontier(graph, members)
    .filter((index) => !options.excluded(index))
    .map(judge)
    .sort((a, b) => b.probability - a.probability);
  return { members: [...members], joined, rejected, areaSqm, capped };
}
