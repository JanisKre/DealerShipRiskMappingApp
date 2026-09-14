import { centroid } from "@turf/centroid";
import { distance } from "@turf/distance";
import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import { point as turfPoint, polygon as turfPolygon } from "@turf/helpers";
import type { BoundaryResult, Polygon, SourceStatus } from "@shared/types";
import { cacheGet, cacheSet, TTL } from "./cache.service";
import { fetchWithResilience } from "./http.service";
import { polygonAreaSqm } from "./geo-math";
import { checkRing, distanceToRingM, type LonLat } from "./boundary-geometry";
import { createCircuitBreaker } from "./boundary/circuit-breaker";

/**
 * ALKIS cadastral parcels (official lot boundaries) via the open
 * WFS services of the German federal states.
 *
 * ENDPOINT AND FILTER FINDINGS (verified live, 14 Sep 2026)
 * --------------------------------------------------------
 * Two things were tested and did NOT work; both are recorded here so nobody
 * spends the afternoon rediscovering them.
 *
 * 1. A predecessor project carried a table of direct state ALKIS WFS endpoints
 *    covering all 16 states (`adv:AX_Flurstueck` and friends). Probed live,
 *    16 of 16 failed: HTTP 404 for Berlin, Hamburg, Bremen, Bayern, BW,
 *    Niedersachsen, Brandenburg, MV, Sachsen-Anhalt and RLP; 400 for NRW and
 *    Saarland; 403 for Sachsen; a service exception for Hessen; a dead
 *    connection for SH; and Thüringen answered but returned no geometry. The
 *    seven INSPIRE endpoints below were re-verified through the same harness
 *    and all returned parcels, so the harness was sound and that table is
 *    simply stale.
 *
 * 2. `CQL_FILTER=INTERSECTS(geom, POINT(...))` is **silently ignored** by these
 *    services. A point in the North Sea returns the same features as an
 *    unfiltered request. The filter appears to work — it answers 200 with
 *    plausible data — which makes it worse than an outright rejection. BBOX is
 *    the only spatial filter these endpoints honour, so "which parcel contains
 *    this point" is decided client-side, in `pickRingForPoint`.
 *
 * The state is determined **offline** via bounding box from the coordinate
 * (no reverse-geocoding call needed anymore, no single point of failure).
 *
 * Most states now provide the INSPIRE-harmonized feature type
 * `cp:CadastralParcel` (one unified schema instead of 16 ALKIS dialects).
 * NRW still uses `ave:Flurstueck` (ALKIS simplified) — the only
 * originally configured service, left unchanged.
 *
 * IMPORTANT — only live-verified endpoints are listed here. Of the
 * 16 German federal states, only these 7 actually return parcel
 * geometries for unauthenticated requests when tested (Sept. 2026); the rest
 * have open INSPIRE metadata, but their WFS endpoints return
 * `numberReturned="0"` (Hesse, Hamburg, Saarland, Bremen, Baden-Württemberg)
 * or are dead by now (Thuringia, Mecklenburg-Western Pomerania,
 * Rhineland-Palatinate) or paid/access-restricted (Bavaria, Art. 13
 * INSPIRE Directive). For these states, the chain automatically falls back to
 * OSM/Overture or the synthetic circle — not an error case, just
 * no official source (yet).
 */

const USER_AGENT = "DealershipRiskMapping-Desktop/0.1 (contact: internal)";

interface AlkisEndpoint {
  url: string;
  typeName: string;
  /** EPSG code for BBOX filter and response geometry (states require different CRS). */
  crs: number;
}

const ALKIS_ENDPOINTS: Record<string, AlkisEndpoint> = {
  NRW: {
    url: "https://www.wfs.nrw.de/geobasis/wfs_nw_alkis_vereinfacht",
    typeName: "ave:Flurstueck",
    crs: 4326,
  },
  Sachsen: {
    url: "https://geodienste.sachsen.de/aaa/public_inspire/alkis/cp/dls/wfs",
    typeName: "cp:CadastralParcel",
    crs: 4258,
  },
  Niedersachsen: {
    url: "https://www.inspire.niedersachsen.de/doorman/noauth/alkis-dls-cp",
    typeName: "cp:CadastralParcel",
    crs: 4258,
  },
  "Schleswig-Holstein": {
    url: "https://service.gdi-sh.de/SH_INSPIREDOWNLOAD_AI_CP_ALKIS",
    typeName: "cp:CadastralParcel",
    crs: 4258,
  },
  "Sachsen-Anhalt": {
    url: "https://geodatenportal.sachsen-anhalt.de/ows_INSPIRE_LVermGeo_ALKIS_CP_WFS",
    typeName: "cp:CadastralParcel",
    crs: 4258,
  },
  Brandenburg: {
    url: "https://inspire.brandenburg.de/services/cp_alkis_wfs",
    typeName: "cp:CadastralParcel",
    crs: 4258,
  },
  Berlin: {
    url: "https://gdi.berlin.de/services/wfs/alkis_flurstuecke",
    typeName: "alkis_flurstuecke:flurstuecke",
    crs: 4326,
  },
};

/** Rough state bounding boxes — only for the 7 states listed above, smallest (city-states) first. */
interface StateBbox {
  state: string;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

const STATE_BBOXES: StateBbox[] = [
  {
    state: "Berlin",
    minLat: 52.33,
    maxLat: 52.68,
    minLon: 13.09,
    maxLon: 13.76,
  },
  {
    state: "Brandenburg",
    minLat: 51.36,
    maxLat: 53.56,
    minLon: 11.27,
    maxLon: 14.77,
  },
  {
    state: "Sachsen-Anhalt",
    minLat: 50.94,
    maxLat: 53.06,
    minLon: 10.56,
    maxLon: 13.19,
  },
  {
    state: "Sachsen",
    minLat: 50.17,
    maxLat: 51.68,
    minLon: 11.87,
    maxLon: 15.04,
  },
  {
    state: "Schleswig-Holstein",
    minLat: 53.36,
    maxLat: 55.06,
    minLon: 7.86,
    maxLon: 11.32,
  },
  {
    state: "Niedersachsen",
    minLat: 51.29,
    maxLat: 53.89,
    minLon: 6.65,
    maxLon: 11.6,
  },
  { state: "NRW", minLat: 50.32, maxLat: 52.53, minLon: 5.87, maxLon: 9.46 },
];

/** Candidate states for a coordinate, smallest (enclaves) first — bboxes deliberately overlap. */
function statesForPoint(lat: number, lon: number): string[] {
  return STATE_BBOXES.filter(
    (b) =>
      lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon,
  ).map((b) => b.state);
}

// --- Circuit breaker (in-memory, per state) --------------------------
// Prevents a permanently unreachable state service from delaying every
// analysis. A valid empty result (service reachable, no parcel at this
// location) does NOT count as a failure — see boundary/circuit-breaker.ts.

const breaker = createCircuitBreaker();

/** Test seam: clears breaker state between cases. */
export function resetAlkisCircuits(): void {
  breaker.reset();
}

/**
 * Default search radius around the point.
 *
 * Was 60 m, which returns the containing parcel and little else. A dealership
 * routinely occupies several adjacent parcels, so the boundary engine needs
 * the neighbourhood, not just the hit.
 */
export const PARCEL_SEARCH_RADIUS_M = 250;

/** Upper bound on features requested per call. */
const PARCEL_REQUEST_LIMIT = 250;

export interface ParcelFeature {
  ring: LonLat[];
  areaSqm: number;
  state: string;
}

export interface ParcelLookup {
  parcels: ParcelFeature[];
  state: string | null;
  /**
   * True when the service had more parcels than it returned. A truncated set
   * must not be used to assemble a multi-parcel site: the missing parcels are
   * arbitrary, so the union would be arbitrary too.
   */
  truncated: boolean;
  /** True when at least one state service answered, even if it had no parcels. */
  reachable: boolean;
  /**
   * True when the geocoded point falls inside one of the returned parcels.
   * False means the nearest parcel was taken instead, which is a weaker claim.
   */
  containsAnchor: boolean;
  /**
   * Distinguishes "no service covers this location", "asked, but the service
   * failed", "asked and got an empty answer" and "asked and got a capped
   * answer" — `reachable` alone collapses all but the first into one boolean.
   */
  status: SourceStatus;
}

/**
 * Reads the WFS response envelope's feature counts.
 *
 * `numberMatched` may legitimately be "unknown" — several state services do
 * not count before streaming — in which case a full page is the only signal
 * that there may be more.
 */
export function parseWfsCounts(xml: string): {
  matched: number | null;
  returned: number | null;
} {
  const matchedRaw = xml.match(/numberMatched="([^"]+)"/)?.[1];
  const returnedRaw = xml.match(/numberReturned="([^"]+)"/)?.[1];
  const toNumber = (value?: string): number | null => {
    if (value == null) return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  };
  return { matched: toNumber(matchedRaw), returned: toNumber(returnedRaw) };
}

export function isTruncated(xml: string, limit: number): boolean {
  const { matched, returned } = parseWfsCounts(xml);
  if (matched != null && returned != null) return matched > returned;
  if (returned != null) return returned >= limit;
  return false;
}

/** All cadastral parcels near a point, for multi-parcel site assembly. */
export async function fetchParcelsNear(
  lat: number,
  lon: number,
  radiusM: number = PARCEL_SEARCH_RADIUS_M,
): Promise<ParcelLookup> {
  const candidateStates = statesForPoint(lat, lon);
  if (candidateStates.length === 0) {
    return {
      parcels: [],
      state: null,
      truncated: false,
      reachable: false,
      containsAnchor: false,
      status: "unsupportedHere",
    };
  }

  let answeredAtLeastOnce = false;
  for (const state of candidateStates) {
    const endpoint = ALKIS_ENDPOINTS[state];
    if (!endpoint || breaker.isOpen(state)) continue;

    // Four decimals (~11 m) on purpose: neighbouring locations in the same
    // business park then share one cached cadastre response.
    const key = `alkis:v2:${state}:${radiusM}:${lat.toFixed(4)},${lon.toFixed(4)}`;
    const hit = cacheGet<ParcelLookup>(key);
    if (hit) {
      answeredAtLeastOnce = true;
      if (hit.parcels.length > 0) {
        // The cache key rounds to ~11 m, so a real anchor up to that far from
        // the one that populated this entry can sit on the other side of a
        // parcel line. The parcel geometry is safe to reuse; whether *this*
        // point falls inside it is not.
        return { ...hit, containsAnchor: parcelContainsPoint(hit.parcels, lat, lon) };
      }
      continue;
    }

    const fetched = await fetchAlkisXml(endpoint, lat, lon, radiusM);
    if (fetched === "error") {
      breaker.recordFailure(state);
      // A transient service error is not a statement about this location.
      // Writing it through `cached()` would persist "no parcels here" for a
      // month, long after the service recovered.
      continue;
    }
    breaker.recordSuccess(state);
    answeredAtLeastOnce = true;

    const parcels: ParcelFeature[] = [];
    if (fetched) {
      for (const ring of parseExteriorRings(fetched)) {
        const check = checkRing(ring, { minAreaSqm: 25, maxAreaSqm: 2_000_000 });
        if (!check.valid) continue;
        parcels.push({ ring, areaSqm: check.areaSqm, state });
      }
    }
    const truncated = fetched ? isTruncated(fetched, PARCEL_REQUEST_LIMIT) : false;
    const result: ParcelLookup = {
      parcels,
      state,
      truncated,
      reachable: true,
      containsAnchor: parcelContainsPoint(parcels, lat, lon),
      status: parcels.length === 0 ? "successEmpty" : truncated ? "partial" : "success",
    };
    cacheSet(key, result, TTL.cadastre);

    if (result.parcels.length > 0) return result;
    // Service answered but holds nothing here — try the next candidate state
    // (the bounding boxes overlap on purpose) before giving up.
  }
  return {
    parcels: [],
    state: null,
    truncated: false,
    reachable: answeredAtLeastOnce,
    containsAnchor: false,
    status: answeredAtLeastOnce ? "successEmpty" : "transientFailure",
  };
}

/**
 * Single containing parcel, as a boundary candidate.
 *
 * Kept as a thin wrapper over `fetchParcelsNear` so the existing ranking chain
 * is unchanged. A parcel is legal context, not an operational footprint — the
 * multi-parcel assembly that turns these into a site lives in the fusion
 * engine.
 */
export async function fromAlkis(
  lat: number,
  lon: number,
): Promise<BoundaryResult | null> {
  const lookup = await fetchParcelsNear(lat, lon);
  if (lookup.parcels.length === 0) return null;
  const chosen = pickRingForPoint(
    lookup.parcels.map((parcel) => parcel.ring),
    lat,
    lon,
  );
  if (!chosen) return null;

  const polygon: Polygon = { type: "Polygon", coordinates: [chosen] };
  return {
    source: "alkis",
    role: "parcel",
    provider: `alkis:${lookup.state ?? "de"}`,
    polygon,
    areaSqm: polygonAreaSqm(chosen),
    confidence: 0.9,
    evidence: {
      source: "German cadastral service / ALKIS",
      retrievedAt: new Date().toISOString(),
      method: "INSPIRE/ALKIS cadastral parcel lookup",
      confidence: 0.9,
      fallbackUsed: false,
      limitations: [
        "A cadastral parcel is not necessarily the dealership's operational lot",
        ...(lookup.truncated
          ? ["Cadastral response was truncated; nearby parcels may be missing"]
          : []),
        ...(lookup.containsAnchor
          ? []
          : ["Reference point lies outside every returned parcel"]),
      ],
    },
  } satisfies BoundaryResult;
}

/** "error" = network/HTTP error (counts toward the circuit breaker); null = reachable, but no hit. */
async function fetchAlkisXml(
  endpoint: AlkisEndpoint,
  lat: number,
  lon: number,
  radiusM: number,
): Promise<string | null | "error"> {
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  const crsUrn = `urn:ogc:def:crs:EPSG::${endpoint.crs}`;
  const bbox = `${lat - dLat},${lon - dLon},${lat + dLat},${lon + dLon},${crsUrn}`;
  const url =
    `${endpoint.url}?service=WFS&version=2.0.0&request=GetFeature` +
    `&typeNames=${encodeURIComponent(endpoint.typeName)}&count=${PARCEL_REQUEST_LIMIT}` +
    `&srsName=${crsUrn}&bbox=${encodeURIComponent(bbox)}`;
  try {
    const res = await fetchWithResilience(url, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) return "error";
    const text = await res.text();
    if (text.includes("ExceptionReport")) return "error";
    return text;
  } catch {
    return "error";
  }
}

/**
 * Extracts the exterior rings (`gml:exterior`) of all `gml:Polygon` elements in the GML.
 * Coordinates arrive as "lat lon lat lon …" (EPSG:4258/4326, both with
 * geographic axis order lat,lon) and are flipped to [lon, lat]
 * (GeoJSON convention). Works independently of the surrounding schema
 * (INSPIRE `cp:CadastralParcel`, NRW `ave:Flurstueck`, Berlin
 * `alkis_flurstuecke:flurstuecke`, …) — all use the same GML geometry.
 */
export function parseExteriorRings(xml: string): [number, number][][] {
  const rings: [number, number][][] = [];
  const polygonRe = /<(?:[\w.-]+:)?Polygon\b[\s\S]*?<\/(?:[\w.-]+:)?Polygon>/g;
  for (const match of xml.matchAll(polygonRe)) {
    const exterior = match[0].match(
      /<(?:[\w.-]+:)?exterior>[\s\S]*?<(?:[\w.-]+:)?posList[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?posList>/,
    );
    if (!exterior) continue;
    const nums = exterior[1].trim().split(/\s+/).map(Number);
    const ring: [number, number][] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const la = nums[i];
      const lo = nums[i + 1];
      if (Number.isFinite(la) && Number.isFinite(lo)) ring.push([lo, la]);
    }
    if (ring.length < 3) continue;
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
    rings.push(ring);
  }
  return rings;
}

/**
 * Whether the geocoded point actually falls inside one of the parcels.
 *
 * This is a real confidence signal and the two cases must not be conflated: a
 * parcel *containing* the point identifies the property, whereas the *nearest*
 * parcel is a guess that happens to be close. The services will not make this
 * distinction for us (their spatial filter is ignored — see the header), so it
 * is made here.
 */
export function parcelContainsPoint(
  parcels: ParcelFeature[],
  lat: number,
  lon: number,
): boolean {
  const pt = turfPoint([lon, lat]);
  return parcels.some((parcel) =>
    booleanPointInPolygon(pt, { type: "Polygon", coordinates: [parcel.ring] }),
  );
}

/** Picks a containing ring; nearest rings are accepted only within 35 m. */
function pickRingForPoint(
  rings: [number, number][][],
  lat: number,
  lon: number,
): [number, number][] | null {
  if (rings.length === 0) return null;
  const pt = turfPoint([lon, lat]);
  const containing = rings.find((r) =>
    booleanPointInPolygon(pt, { type: "Polygon", coordinates: [r] }),
  );
  if (containing) return containing;

  let best: [number, number][] | null = null;
  let bestDist = Infinity;
  for (const r of rings) {
    const d = distance(pt, centroid(turfPolygon([r])));
    if (d < bestDist && distanceToRingM([lon, lat], r) <= 35) {
      bestDist = d;
      best = r;
    }
  }
  return best;
}
