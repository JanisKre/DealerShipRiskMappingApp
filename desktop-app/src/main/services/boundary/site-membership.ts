import { distanceToRingM, type LonLat } from "../boundary-geometry";
import type { ParcelFeature } from "../alkis.service";

/**
 * Site-membership signals (docs/boundary-improvement-plan.de.md, P3).
 *
 * Geometric adjacency, physical connection, cadastral structure and
 * operational membership are four different relationships — a shared parcel
 * edge does not prove shared use, and an unrelated building next door is not
 * "this site" just because it is close. This module scores the one relevant
 * question for a *candidate site component*: is there a defensible reason to
 * believe it belongs to the dealership being analysed?
 *
 * Deliberately conservative: with nothing to go on, a component is rejected
 * rather than included on proximity alone (§2 of the plan — "unknown" is a
 * valid outcome, and unsupported gaps are not closed by a big hull).
 */

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const NAME_STOPWORDS = new Set([
  "auto",
  "autohaus",
  "gmbh",
  "co",
  "kg",
  "ag",
  "strasse",
  "deutschland",
  "filiale",
]);

/**
 * Whether an area's own tags identify it as *this* dealership rather than
 * merely as *a* dealership nearby. Used both to weight primary evidence and
 * to decide whether a separately-grown component may join the result.
 */
export function matchesSite(
  tags: Record<string, string>,
  name?: string,
  address?: string,
): boolean {
  const haystack = normalize(
    `${tags.name ?? ""} ${tags.brand ?? ""} ${tags.operator ?? ""}`,
  ).split(" ");
  const tokens = normalize(`${name ?? ""}`)
    .split(" ")
    .filter((token) => token.length >= 4 && !NAME_STOPWORDS.has(token));
  if (tokens.some((token) => haystack.includes(token))) return true;

  const postcode = address?.match(/\b\d{5}\b/)?.[0];
  if (postcode && tags["addr:postcode"] === postcode) {
    const houseNumber = address?.match(/\b\d+\s*[a-z]?\b/i)?.[0]?.trim().toLowerCase();
    if (!houseNumber) return true;
    return tags["addr:housenumber"]?.toLowerCase() === houseNumber;
  }
  return false;
}

/** Metres within which two parcels are treated as sharing an edge, not merely nearby. */
const ADJACENT_PARCEL_TOLERANCE_M = 3;

/**
 * Whether `candidate` directly abuts `reference` — a real cadastral
 * relationship, not proximity. Used to let a confirmed neighbouring parcel
 * support a component when no OSM identity tag is available.
 */
export function isAdjacentParcel(
  candidate: ParcelFeature,
  reference: ParcelFeature,
): boolean {
  return candidate.ring.some(
    (point) => distanceToRingM(point, reference.ring) <= ADJACENT_PARCEL_TOLERANCE_M,
  );
}

export interface MembershipEvaluation {
  accepted: boolean;
  /** 0..1, informational — acceptance is a hard gate, not a threshold on this. */
  score: number;
  reasons: string[];
}

export interface MembershipContext {
  name?: string;
  address?: string;
  /** OSM area tags whose ring overlaps the candidate component, if any. */
  overlappingAreaTags?: Array<{ kind: string; tags: Record<string, string> }>;
  /** True when the candidate sits inside a parcel adjacent to the anchor's parcel. */
  onAdjacentParcel?: boolean;
}

/**
 * Decides whether a component that region-growing could *not* reach from the
 * anchor (typically because a road or other barrier separates it) may still
 * be added to the result as a confirmed, separate part of the site.
 *
 * Every accepted component must have its own positive reason — geometric
 * closeness or "the evidence grid happened to score it" are not reasons.
 */
export function evaluateComponentMembership(
  context: MembershipContext,
): MembershipEvaluation {
  const reasons: string[] = [];

  const identityMatch = (context.overlappingAreaTags ?? []).find((area) =>
    matchesSite(area.tags, context.name, context.address),
  );
  if (identityMatch) {
    reasons.push(
      `matches the site's name/address via its ${identityMatch.kind} tags`,
    );
    return { accepted: true, score: 0.9, reasons };
  }

  if (context.onAdjacentParcel) {
    reasons.push("sits on a cadastral parcel directly adjacent to the anchor parcel");
    return { accepted: true, score: 0.55, reasons };
  }

  reasons.push(
    "no name/address match and no confirmed adjacent parcel — excluded rather than assumed",
  );
  return { accepted: false, score: 0.1, reasons };
}

/** Centroid of a set of grid-space points, in the same coordinate space. */
export function centroidOf(points: LonLat[]): LonLat {
  let sumLon = 0;
  let sumLat = 0;
  for (const [lon, lat] of points) {
    sumLon += lon;
    sumLat += lat;
  }
  return [sumLon / points.length, sumLat / points.length];
}
