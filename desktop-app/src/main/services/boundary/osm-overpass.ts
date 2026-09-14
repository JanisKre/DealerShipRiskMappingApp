import type { LonLat } from "../boundary-geometry";

/**
 * One combined OSM evidence query, and the pure classification of what comes
 * back.
 *
 * This replaces two narrow queries (a 250 m semantic lookup and a 60 m
 * building lookup) with a single round trip that also collects the things the
 * old pipeline never asked for and that actually delimit a dealership site:
 * fences, public roads, internal driveways, vegetation and water.
 *
 * Everything except `fetchOsmEvidence` is pure, so the classification rules —
 * the part that decides whether a way cuts a lot in half — are unit-testable
 * without a network.
 */

export type OsmTags = Record<string, string>;

/** Areas contribute signed score over the cells they cover. */
export type EvidenceAreaKind =
  | "dealerArea"
  | "parking"
  | "landuse"
  | "building"
  | "vegetation"
  | "water";

/**
 * Lines either cut the grid, push it down, or lift it up.
 *  - `barrier`      hard cut only, no score: a fence is an edge, not evidence
 *                   of what is on either side of it.
 *  - `publicRoad`   negative *and* a cut.
 *  - `serviceAisle` positive: a parking aisle is interior circulation.
 */
export type EvidenceLineKind =
  | "barrier"
  | "publicRoad"
  | "railway"
  | "waterway"
  | "serviceAisle";

export interface EvidenceArea {
  kind: EvidenceAreaKind;
  ring: LonLat[];
  tags: OsmTags;
  osmType: "way" | "relation";
  osmId: number;
}

export interface EvidenceLine {
  kind: EvidenceLineKind;
  line: LonLat[];
  /** Half the physical width, for buffering. Barriers are hairlines. */
  halfWidthM: number;
  tags: OsmTags;
  osmId: number;
}

export interface OsmEvidence {
  areas: EvidenceArea[];
  lines: EvidenceLine[];
  /** Address nodes, used to confirm which candidate carries the right number. */
  addressNodes: Array<{ point: LonLat; tags: OsmTags }>;
}

export const EMPTY_OSM_EVIDENCE: OsmEvidence = {
  areas: [],
  lines: [],
  addressNodes: [],
};

// --- Query -------------------------------------------------------------

/**
 * Default search radius. The evidence grid is a 400 m square, whose
 * half-diagonal is 283 m — anything nearer than that can touch the grid.
 */
export const OSM_EVIDENCE_RADIUS_M = 300;

/**
 * Builds the combined query.
 *
 * It ends in a bare `out geom;` for a reason. The previous query ended in
 * `out geom center tags;`, which returns elements with **no `geometry` array
 * at all** — `out` accepts a single geometry mode, and that combination
 * degrades to centroids. Every element was then dropped by the caller's
 * `geometry.length >= 3` guard, so the OSM provider silently returned nothing
 * on every lookup it ever made. `out geom;` uses the default `body` verbosity,
 * which includes tags, and returns full geometry for ways and relation members.
 */
export function buildOsmEvidenceQuery(
  lat: number,
  lon: number,
  radiusM: number = OSM_EVIDENCE_RADIUS_M,
): string {
  const at = `${radiusM},${lat},${lon}`;
  return [
    "[out:json][timeout:25];",
    "(",
    `  nwr(around:${at})["landuse"~"^(retail|commercial|industrial)$"];`,
    `  nwr(around:${at})["amenity"="parking"];`,
    `  nwr(around:${at})["site"="parking"];`,
    `  nwr(around:${at})["parking"="surface"];`,
    `  nwr(around:${at})["shop"~"^(car|car_repair|truck|motorcycle|caravan|trailer)$"];`,
    `  nwr(around:${at})["office"="car_dealer"];`,
    `  nwr(around:${at})["amenity"="driving_school"];`,
    `  nwr(around:${at})["building"];`,
    `  nwr(around:${at})["natural"];`,
    `  nwr(around:${at})["landuse"~"^(grass|forest|meadow|farmland|village_green)$"];`,
    `  nwr(around:${at})["leisure"~"^(park|garden|pitch|golf_course)$"];`,
    `  way(around:${at})["barrier"];`,
    `  way(around:${at})["highway"];`,
    `  way(around:${at})["railway"];`,
    `  way(around:${at})["waterway"];`,
    `  node(around:120,${lat},${lon})["addr:housenumber"];`,
    ");",
    "out geom;",
  ].join("\n");
}

// --- Classification ----------------------------------------------------

const DEALER_SHOPS = new Set([
  "car",
  "car_repair",
  "truck",
  "motorcycle",
  "caravan",
  "trailer",
]);
const VEGETATION_NATURAL = new Set([
  "wood",
  "scrub",
  "grassland",
  "tree_row",
  "heath",
  "wetland",
]);
const VEGETATION_LANDUSE = new Set([
  "grass",
  "forest",
  "meadow",
  "farmland",
  "village_green",
]);
const VEGETATION_LEISURE = new Set([
  "park",
  "garden",
  "pitch",
  "golf_course",
]);
const SITE_LANDUSE = new Set(["retail", "commercial", "industrial"]);

/** Which evidence layer an area belongs to, or null if it is irrelevant. */
export function classifyArea(tags: OsmTags): EvidenceAreaKind | null {
  if (tags.natural === "water" || tags.waterway === "riverbank") return "water";
  if (
    (tags.natural && VEGETATION_NATURAL.has(tags.natural)) ||
    (tags.landuse && VEGETATION_LANDUSE.has(tags.landuse)) ||
    (tags.leisure && VEGETATION_LEISURE.has(tags.leisure))
  ) {
    return "vegetation";
  }
  if (
    (tags.shop && DEALER_SHOPS.has(tags.shop)) ||
    tags.office === "car_dealer" ||
    tags.amenity === "driving_school"
  ) {
    return "dealerArea";
  }
  if (
    tags.amenity === "parking" ||
    tags.site === "parking" ||
    tags.parking === "surface"
  ) {
    return "parking";
  }
  if (tags.landuse && SITE_LANDUSE.has(tags.landuse)) return "landuse";
  if (tags.building) return "building";
  return null;
}

const BARRIER_VALUES = new Set([
  "fence",
  "wall",
  "hedge",
  "guard_rail",
  "retaining_wall",
  "city_wall",
  "gate",
  "bollard",
]);

/**
 * Roads that bound a site. Values NOT in this set are deliberately neutral.
 *
 * Footways, paths, cycleways and unqualified `highway=service` cross the
 * interior of dealership lots constantly. Treating every `highway=*` as a
 * negative barrier — the obvious reading of "roads bound the site" — would
 * slice lots in half and is the single most likely way to make detection worse
 * than doing nothing. There is a regression test for exactly this.
 */
const PUBLIC_ROAD_CLASSES: Record<string, number> = {
  motorway: 15,
  motorway_link: 8,
  trunk: 14,
  trunk_link: 8,
  primary: 12,
  primary_link: 7,
  secondary: 10,
  secondary_link: 7,
  tertiary: 8,
  tertiary_link: 6,
  unclassified: 6,
  residential: 6,
  living_street: 5,
};

/** `service` values that mean a public through-road rather than site interior. */
const PUBLIC_SERVICE_VALUES = new Set(["alley", "emergency_access"]);
/** `service` values that mean interior circulation — positive evidence. */
const INTERIOR_SERVICE_VALUES = new Set(["parking_aisle", "driveway"]);

export function classifyLine(tags: OsmTags): EvidenceLineKind | null {
  if (tags.barrier && BARRIER_VALUES.has(tags.barrier)) return "barrier";
  if (
    tags.railway === "rail" ||
    tags.railway === "light_rail" ||
    tags.railway === "tram"
  ) {
    return "railway";
  }
  if (
    tags.waterway === "river" ||
    tags.waterway === "stream" ||
    tags.waterway === "canal"
  ) {
    return "waterway";
  }
  const highway = tags.highway;
  if (!highway) return null;
  if (highway === "service") {
    const service = tags.service;
    if (service && INTERIOR_SERVICE_VALUES.has(service)) return "serviceAisle";
    if (service && PUBLIC_SERVICE_VALUES.has(service)) return "publicRoad";
    // Unqualified service roads are ambiguous — most often a site's own access
    // road. Neutral is the safe reading.
    return null;
  }
  return highway in PUBLIC_ROAD_CLASSES ? "publicRoad" : null;
}

/**
 * Physical half-width for buffering: an explicit `width` wins, then `lanes`
 * at 3 m each, then the road class default.
 */
export function roadHalfWidthM(tags: OsmTags): number {
  const width = parseFloat(tags.width ?? "");
  if (Number.isFinite(width) && width > 0) return width / 2;
  const lanes = parseInt(tags.lanes ?? "", 10);
  if (Number.isFinite(lanes) && lanes > 0) return (lanes * 3) / 2;
  const fallback = PUBLIC_ROAD_CLASSES[tags.highway ?? ""] ?? 6;
  return fallback / 2;
}

/** Half-width used for a line kind. Barriers are hairlines by definition. */
export function halfWidthForLine(
  kind: EvidenceLineKind,
  tags: OsmTags,
): number {
  switch (kind) {
    case "barrier":
      return 0;
    case "serviceAisle":
      return 3;
    case "railway":
      return 3;
    case "waterway":
      return 3;
    case "publicRoad":
      return roadHalfWidthM(tags);
  }
}

// --- Parsing -----------------------------------------------------------

interface OverpassGeometryPoint {
  lat: number;
  lon: number;
}

interface OverpassMember {
  type: string;
  role?: string;
  geometry?: OverpassGeometryPoint[];
}

export interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  tags?: OsmTags;
  geometry?: OverpassGeometryPoint[];
  members?: OverpassMember[];
}

function toRing(points: OverpassGeometryPoint[]): LonLat[] {
  const ring: LonLat[] = points.map((p) => [p.lon, p.lat]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);
  return ring;
}

function isClosed(points: OverpassGeometryPoint[]): boolean {
  if (points.length < 4) return false;
  const first = points[0];
  const last = points[points.length - 1];
  return first.lat === last.lat && first.lon === last.lon;
}

const RING_TOLERANCE_DEG = 1e-7;

function samePoint(a: OverpassGeometryPoint, b: OverpassGeometryPoint): boolean {
  return (
    Math.abs(a.lat - b.lat) <= RING_TOLERANCE_DEG &&
    Math.abs(a.lon - b.lon) <= RING_TOLERANCE_DEG
  );
}

/**
 * Chains a multipolygon relation's `outer` members head-to-tail into closed
 * rings. A chain that cannot be closed is dropped rather than guessed at — a
 * half-traced boundary is worse than none.
 *
 * Relation geometry was previously invisible to the pipeline: buildings were
 * fetched with `way(...)`, so every building or landuse mapped as a
 * multipolygon simply did not exist as far as detection was concerned.
 */
export function assembleRelationRings(
  members: OverpassMember[] | undefined,
): LonLat[][] {
  if (!members) return [];
  const pending = members
    .filter(
      (m) =>
        m.type === "way" &&
        (m.role ?? "outer") === "outer" &&
        Array.isArray(m.geometry) &&
        m.geometry.length >= 2,
    )
    .map((m) => [...m.geometry!]);

  const rings: LonLat[][] = [];
  while (pending.length > 0) {
    let chain = pending.shift()!;
    if (isClosed(chain)) {
      rings.push(toRing(chain));
      continue;
    }
    let extended = true;
    while (extended && !isClosed(chain)) {
      extended = false;
      for (let i = 0; i < pending.length; i += 1) {
        const candidate = pending[i];
        const head = chain[0];
        const tail = chain[chain.length - 1];
        const cHead = candidate[0];
        const cTail = candidate[candidate.length - 1];
        if (samePoint(tail, cHead)) {
          chain = [...chain, ...candidate.slice(1)];
        } else if (samePoint(tail, cTail)) {
          chain = [...chain, ...[...candidate].reverse().slice(1)];
        } else if (samePoint(head, cTail)) {
          chain = [...candidate.slice(0, -1), ...chain];
        } else if (samePoint(head, cHead)) {
          chain = [...[...candidate].reverse().slice(0, -1), ...chain];
        } else {
          continue;
        }
        pending.splice(i, 1);
        extended = true;
        break;
      }
    }
    if (isClosed(chain) && chain.length >= 4) rings.push(toRing(chain));
  }
  return rings;
}

/** Turns a raw Overpass response into classified evidence. Pure. */
export function parseOsmEvidence(data: {
  elements?: OverpassElement[];
}): OsmEvidence {
  const areas: EvidenceArea[] = [];
  const lines: EvidenceLine[] = [];
  const addressNodes: OsmEvidence["addressNodes"] = [];

  for (const element of data.elements ?? []) {
    const tags = element.tags ?? {};

    if (element.type === "node") {
      if (tags["addr:housenumber"] && element.lat != null && element.lon != null) {
        addressNodes.push({ point: [element.lon, element.lat], tags });
      }
      continue;
    }

    if (element.type === "relation") {
      const kind = classifyArea(tags);
      if (!kind) continue;
      for (const ring of assembleRelationRings(element.members)) {
        areas.push({ kind, ring, tags, osmType: "relation", osmId: element.id });
      }
      continue;
    }

    const geometry = element.geometry;
    if (!Array.isArray(geometry) || geometry.length < 2) continue;

    // A closed way carrying an area tag is an area; the same way may also be a
    // barrier (a fence drawn around a yard), so both are considered.
    const lineKind = classifyLine(tags);
    if (lineKind) {
      lines.push({
        kind: lineKind,
        line: geometry.map((p) => [p.lon, p.lat] as LonLat),
        halfWidthM: halfWidthForLine(lineKind, tags),
        tags,
        osmId: element.id,
      });
    }

    if (isClosed(geometry)) {
      const areaKind = classifyArea(tags);
      if (areaKind) {
        areas.push({
          kind: areaKind,
          ring: toRing(geometry),
          tags,
          osmType: "way",
          osmId: element.id,
        });
      }
    }
  }

  return { areas, lines, addressNodes };
}
