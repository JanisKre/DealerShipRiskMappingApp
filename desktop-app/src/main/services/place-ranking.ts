/**
 * One ranking for every location-search hit, whichever source found it.
 *
 * Hits that name the same place (same OSM object, same label at the same
 * spot, or a similar business name within a building's distance across OSM
 * and Overture) are merged first. Each merged place then gets one score from
 * independent, explainable signals — see `RANK_WEIGHTS` and
 * docs/location-search.md. Pure: no network, no database.
 */
import type { QueryLocality } from "./dealer-directory/directory-index";
import type { PortfolioMatch } from "./portfolio-index.service";
import {
  distanceKm,
  similarBusinessNames,
  textMatchScore,
} from "./place-query";

export type PlaceSource = "osm" | "overture";

export interface PlaceCandidate {
  label: string;
  lat: number;
  lon: number;
  /** Business name alone, for cross-source matching. */
  name: string | null;
  /** OSM object key, for exact de-duplication between Photon queries. */
  osmKey: string | null;
  source: PlaceSource;
  /** A car dealership (Photon `shop=car`, or any Overture directory hit). */
  dealer: boolean;
  /** The address carries a house number. */
  hasHouseNumber: boolean;
  /** 0-based position in its own source's ranking. */
  sourceRank: number;
}

export interface RankedPlace {
  label: string;
  lat: number;
  lon: number;
  /** Source of the label and position shown (OSM when both know the place). */
  source: PlaceSource;
  /** Every source that knows the place. */
  sources: PlaceSource[];
  /** Saved portfolio locations this place already is. */
  portfolio: PortfolioMatch[];
  score: number;
}

export interface RankContext {
  /** Folded tokens to match against names and labels. */
  tokens: readonly string[];
  /** A house number was typed: addresses outrank dealerships. */
  addressIntent: boolean;
  /** Place the query names, else the map view. */
  focus?: { lat: number; lon: number };
  locality?: QueryLocality | null;
  portfolio?: (place: {
    lat: number;
    lon: number;
    name: string | null;
  }) => PortfolioMatch[];
}

/**
 * Score = Σ weight × signal. Text dominates so a wrong name never wins on
 * proximity alone; the other signals order equally good name matches.
 */
export const RANK_WEIGHTS = {
  /** 0–1: share of the identifying query words found (typos count partly). */
  text: 4,
  /** 1 when the hit is the kind asked for: a dealer, or an address when a house number was typed. */
  kind: 1.5,
  /** 1 when OSM and Overture both know the place. */
  confirmed: 0.75,
  /** +1 inside the named city/postcode area, −1 outside. */
  locality: 1,
  /** 1 when the place is already in a saved portfolio. */
  portfolio: 1,
  /** −log10(1 + km/10) from the focus: −0.3 at 10 km, −1 at 90 km. */
  proximity: 0.5,
  /** Per position in the source's own list (capped at 5): keeps its order on ties. */
  sourceRank: 0.15,
} as const;

const MAX_RESULTS = 8;
/** Two hits closer than this with the same label are the same place. */
const DUPLICATE_DISTANCE_M = 75;
/**
 * OSM and Overture place the same business up to a building apart (entrance
 * vs. roof centroid); within this distance a similar name means one place.
 */
const CROSS_SOURCE_DISTANCE_M = 150;

function samePlace(a: PlaceCandidate, b: PlaceCandidate): boolean {
  if (b.osmKey != null && a.osmKey === b.osmKey) return true;
  const meters = distanceKm(a, b) * 1000;
  if (a.label === b.label && meters < DUPLICATE_DISTANCE_M) return true;
  return (
    a.source !== b.source &&
    a.name != null &&
    b.name != null &&
    meters < CROSS_SOURCE_DISTANCE_M &&
    similarBusinessNames(a.name, b.name)
  );
}

/** Groups hits that name the same place, keeping first-seen order. */
export function clusterCandidates(
  candidates: readonly PlaceCandidate[],
): PlaceCandidate[][] {
  const clusters: PlaceCandidate[][] = [];
  for (const candidate of candidates) {
    const cluster = clusters.find((members) =>
      members.some((member) => samePlace(member, candidate)),
    );
    if (cluster) cluster.push(candidate);
    else clusters.push([candidate]);
  }
  return clusters;
}

/** The member whose label is shown: OSM carries the richer address. */
function representative(members: readonly PlaceCandidate[]): PlaceCandidate {
  return members.find((member) => member.source === "osm") ?? members[0];
}

export function scorePlace(
  members: readonly PlaceCandidate[],
  context: RankContext,
): RankedPlace {
  const shown = representative(members);
  const sources = [...new Set(members.map((m) => m.source))].sort();
  const text = Math.max(
    ...members.map((m) =>
      textMatchScore(context.tokens, `${m.name ?? ""} ${m.label}`),
    ),
  );
  const kind = context.addressIntent
    ? members.some((m) => m.hasHouseNumber)
    : members.some((m) => m.dealer);
  const proximity = context.focus
    ? -Math.log10(1 + distanceKm(context.focus, shown) / 10)
    : 0;
  const locality = context.locality
    ? distanceKm(context.locality, shown) <= context.locality.radiusKm
      ? 1
      : -1
    : 0;
  const names = members
    .map((m) => m.name)
    .filter((n): n is string => n != null);
  const portfolio = context.portfolio
    ? context.portfolio({
        lat: shown.lat,
        lon: shown.lon,
        name: names[0] ?? null,
      })
    : [];
  const sourceRank = Math.min(5, Math.min(...members.map((m) => m.sourceRank)));

  const score =
    RANK_WEIGHTS.text * text +
    RANK_WEIGHTS.kind * (kind ? 1 : 0) +
    RANK_WEIGHTS.confirmed * (sources.length > 1 ? 1 : 0) +
    RANK_WEIGHTS.locality * locality +
    RANK_WEIGHTS.portfolio * (portfolio.length > 0 ? 1 : 0) +
    RANK_WEIGHTS.proximity * proximity -
    RANK_WEIGHTS.sourceRank * sourceRank;

  return {
    label: shown.label,
    lat: shown.lat,
    lon: shown.lon,
    source: shown.source,
    sources,
    portfolio,
    score,
  };
}

/** Merges, scores and orders all hits; equal scores keep first-seen order. */
export function rankPlaces(
  candidates: readonly PlaceCandidate[],
  context: RankContext,
  limit = MAX_RESULTS,
): RankedPlace[] {
  return clusterCandidates(candidates)
    .map((members, order) => ({ place: scorePlace(members, context), order }))
    .sort((a, b) => b.place.score - a.place.score || a.order - b.order)
    .slice(0, limit)
    .map(({ place }) => place);
}
