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
    const houseNumber = address
      ?.match(/\b\d+\s*[a-z]?\b/i)?.[0]
      ?.trim()
      .toLowerCase();
    if (!houseNumber) return true;
    return tags["addr:housenumber"]?.toLowerCase() === houseNumber;
  }
  return false;
}

/**
 * Stricter identity test for admitting a *separate* component, which has no
 * physical connection to vouch for it. Every distinctive token of the site's
 * name must appear — "Opel - Autohaus Dresden" must not claim everything
 * named "…Dresden…", nor "Autocenter Löbtau" every building in Löbtau, since
 * place names are routinely part of dealership names. An address match needs
 * the house number; a postcode alone covers a whole district.
 */
export function matchesSiteStrictly(
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
  if (tokens.length > 0 && tokens.every((token) => haystack.includes(token))) {
    return true;
  }

  const postcode = address?.match(/\b\d{5}\b/)?.[0];
  const houseNumber = address
    ?.replace(/\b\d{5}\b/g, " ")
    .match(/\b\d+\s*[a-z]?\b/i)?.[0]
    ?.trim()
    .toLowerCase();
  return Boolean(
    postcode &&
      houseNumber &&
      tags["addr:postcode"] === postcode &&
      tags["addr:housenumber"]?.toLowerCase() === houseNumber,
  );
}

/**
 * Words that name a *kind of place* rather than a business — "Gewerbegebiet
 * Nord" or "Kundenparkplatz" are not an identity that could conflict with the
 * dealership's.
 */
const GENERIC_PLACE_WORDS = new Set([
  "gewerbegebiet",
  "industriegebiet",
  "gewerbepark",
  "industriepark",
  "businesspark",
  "gewerbehof",
  "parkplatz",
  "kundenparkplatz",
  "mitarbeiterparkplatz",
  "parkhaus",
  "halle",
  "gebaeude",
  // Directions qualify a place name ("Gewerbegebiet Nord"), they are not one.
  "nord",
  "sued",
  "west",
  "mitte",
]);

/** Amenities that are site furniture, not a business in their own right. */
const NON_BUSINESS_AMENITIES = new Set([
  "parking",
  "parking_entrance",
  "parking_space",
  "bicycle_parking",
  "motorcycle_parking",
  "charging_station",
  "atm",
  "vending_machine",
  "bench",
  "waste_basket",
  "waste_disposal",
  "recycling",
  "post_box",
  "telephone",
  "toilets",
  "shelter",
  "drinking_water",
  "fountain",
  "car_sharing",
  "taxi",
]);

const BUSINESS_LANDUSE = new Set(["retail", "commercial", "industrial"]);

/** Distinctive identity tokens: letters required, so "304" (a building number) is not one. */
function identityTokens(value: string): string[] {
  return normalize(value)
    .split(" ")
    .filter(
      (token) =>
        token.length >= 4 &&
        /[a-z]/.test(token) &&
        !NAME_STOPWORDS.has(token) &&
        !GENERIC_PLACE_WORDS.has(token),
    );
}

/**
 * The business identity an OSM feature declares, or null when it declares
 * none. A feature declares one when it is a business (shop, office, craft,
 * a non-furniture amenity, a named business landuse) or names an operator or
 * brand — and carries at least one distinctive token.
 */
export function businessIdentity(tags: Record<string, string>): string | null {
  const amenity = tags.amenity;
  const isBusiness =
    Boolean(tags.shop || tags.office || tags.craft || tags.company) ||
    (amenity != null && !NON_BUSINESS_AMENITIES.has(amenity)) ||
    (tags.landuse != null && BUSINESS_LANDUSE.has(tags.landuse)) ||
    Boolean(tags.operator || tags.brand);
  if (!isBusiness) return null;
  const label = tags.name ?? tags.operator ?? tags.brand;
  if (!label) return null;
  const tokens = identityTokens(
    `${tags.name ?? ""} ${tags.brand ?? ""} ${tags.operator ?? ""}`,
  );
  return tokens.length > 0 ? label : null;
}

/**
 * Whether the feature is a *different* business than the one being analysed:
 * it declares an identity, and none of its distinctive tokens appear in the
 * site's name. Unknown stays unknown — without a usable site name nothing is
 * declared foreign. A shared address is deliberately not a match here: several
 * tenants at one house number is exactly the case this guards against.
 */
export function isForeignBusiness(
  tags: Record<string, string>,
  name?: string,
): boolean {
  if (businessIdentity(tags) == null) return false;
  const siteTokens = identityTokens(name ?? "");
  if (siteTokens.length === 0) return false;
  const featureTokens = identityTokens(
    `${tags.name ?? ""} ${tags.brand ?? ""} ${tags.operator ?? ""}`,
  );
  return !featureTokens.some((token) => siteTokens.includes(token));
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
    (point) =>
      distanceToRingM(point, reference.ring) <= ADJACENT_PARCEL_TOLERANCE_M,
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
  /** Identities of *other* businesses found inside the candidate component. */
  foreignBusinesses?: string[];
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
    matchesSiteStrictly(area.tags, context.name, context.address),
  );
  if (identityMatch) {
    reasons.push(
      `matches the site's name/address via its ${identityMatch.kind} tags`,
    );
    return { accepted: true, score: 0.9, reasons };
  }

  const foreign = context.foreignBusinesses ?? [];
  if (foreign.length > 0) {
    reasons.push(
      `contains a different business (${foreign.slice(0, 3).join(", ")}) — another operator's site`,
    );
    return { accepted: false, score: 0, reasons };
  }

  // A shared parcel edge is a cadastral fact, not shared use: in a business
  // park nearly every parcel touches several others. It only counts together
  // with vehicle-trade use on the component itself.
  const dealerUse = (context.overlappingAreaTags ?? []).some(
    (area) => area.kind === "dealerArea",
  );
  if (context.onAdjacentParcel && dealerUse) {
    reasons.push(
      "vehicle-trade use on a cadastral parcel directly adjacent to the anchor parcel",
    );
    return { accepted: true, score: 0.55, reasons };
  }
  if (context.onAdjacentParcel) {
    reasons.push(
      "only an adjacent parcel — adjacency alone is not evidence of shared use",
    );
    return { accepted: false, score: 0.2, reasons };
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
