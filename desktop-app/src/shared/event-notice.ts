import type { HailEventHit } from "./hail-events";
import type { RadarHailClass } from "./radar-hail";

/**
 * Event watch: after a hail event, the locations it reached (computed by
 * `computeHailEventImpact`) as a work list and as the facts of a message to
 * the dealerships. The app sends nothing; the text is copied. The optional
 * AI layer words the same facts as a message. No loss amounts are included:
 * the stress-test loss is a screening figure, not something to tell a dealer.
 */

export interface NoticeSite {
  id: string;
  name: string;
  /** Date the hail reached the site (YYYY-MM-DD, UTC). */
  date: string;
  hailClass: RadarHailClass;
  distanceKm: number;
}

/** Sites in the fact list for the AI; the work list itself is never cut. */
export const NOTICE_FACT_SITES = 30;

export function noticeSites(
  hits: readonly HailEventHit[],
  names: ReadonlyMap<string, string>,
): NoticeSite[] {
  return hits.flatMap((hit) => {
    const name = names.get(hit.id);
    if (!name) return [];
    return [
      {
        id: hit.id,
        name,
        date: new Date(hit.firstAt).toISOString().slice(0, 10),
        hailClass: hit.hailClass,
        distanceKm: hit.distanceKm,
      },
    ];
  });
}

const CLASS_TEXT: Record<RadarHailClass, string> = {
  large: "large hail",
  hail: "hail",
  mixed: "rain-hail mixture",
};

/** Plain-text facts for the optional AI message. */
export function noticeFacts(
  eventName: string,
  sites: readonly NoticeSite[],
  radiusKm: number,
): string {
  const listed = sites.slice(0, NOTICE_FACT_SITES);
  return [
    `Hail event: ${eventName}`,
    `Radar detected hail cells within ${radiusKm} km of ${sites.length} location(s) of the portfolio. Radar shows where hail was likely; it does not show damage.`,
    ...listed.map(
      (s) =>
        `- ${s.name}: ${s.date}, ${CLASS_TEXT[s.hailClass]}, ${s.distanceKm === 0 ? "cell over the site" : `${s.distanceKm} km from the nearest cell`}`,
    ),
    ...(sites.length > listed.length
      ? [`(${sites.length - listed.length} more locations not listed)`]
      : []),
  ].join("\n");
}
