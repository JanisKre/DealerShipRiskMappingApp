import { centroid } from "@turf/centroid";
import { distance } from "@turf/distance";
import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import { point as turfPoint, polygon as turfPolygon } from "@turf/helpers";
import type { BoundaryResult, Polygon } from "@shared/types";
import { cached, TTL } from "./cache.service";
import { polygonAreaSqm } from "./geo-math";
import { checkRing, distanceToRingM } from "./boundary-geometry";

/**
 * ALKIS cadastral parcels (official lot boundaries) via the open
 * WFS services of the German federal states.
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
// analysis: after FAIL_THRESHOLD consecutive real network/HTTP errors, the
// service is skipped for OPEN_DURATION_MS. A valid empty result
// (service reachable, no parcel at this location) does NOT count as a failure.

const FAIL_THRESHOLD = 3;
const OPEN_DURATION_MS = 30_000;

interface CircuitState {
  failCount: number;
  openUntil: number;
}

const circuits = new Map<string, CircuitState>();

function isCircuitOpen(state: string): boolean {
  const c = circuits.get(state);
  if (!c) return false;
  if (Date.now() >= c.openUntil) {
    circuits.delete(state);
    return false;
  }
  return c.failCount >= FAIL_THRESHOLD;
}

function recordFailure(state: string): void {
  const c = circuits.get(state) ?? { failCount: 0, openUntil: 0 };
  c.failCount += 1;
  if (c.failCount >= FAIL_THRESHOLD)
    c.openUntil = Date.now() + OPEN_DURATION_MS;
  circuits.set(state, c);
}

function recordSuccess(state: string): void {
  circuits.delete(state);
}

/** Half edge length of the search box around the point (m) — parcels are usually < 100 m. */
const SEARCH_HALF_M = 60;

export async function fromAlkis(
  lat: number,
  lon: number,
): Promise<BoundaryResult | null> {
  for (const state of statesForPoint(lat, lon)) {
    const endpoint = ALKIS_ENDPOINTS[state];
    if (!endpoint || isCircuitOpen(state)) continue;

    const key = `alkis:${state}:${lat.toFixed(5)},${lon.toFixed(5)}`;
    const result = await cached(key, TTL.buildings, async () => {
      const fetched = await fetchAlkisXml(endpoint, lat, lon);
      if (fetched === "error") {
        recordFailure(state);
        return null;
      }
      recordSuccess(state);
      if (!fetched) return null;

      const rings = parseExteriorRings(fetched).filter(
        (ring) =>
          checkRing(ring, { minAreaSqm: 25, maxAreaSqm: 2_000_000 }).valid,
      );
      const chosen = pickRingForPoint(rings, lat, lon);
      if (!chosen) return null;

      const polygon: Polygon = { type: "Polygon", coordinates: [chosen] };
      return {
        source: "alkis",
        role: "parcel",
        provider: `alkis:${state}`,
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
          ],
        },
      } satisfies BoundaryResult;
    });

    if (result) return result;
    // No hit in this state (but service reachable) → next candidate.
  }
  return null;
}

/** "error" = network/HTTP error (counts toward the circuit breaker); null = reachable, but no hit. */
async function fetchAlkisXml(
  endpoint: AlkisEndpoint,
  lat: number,
  lon: number,
): Promise<string | null | "error"> {
  const dLat = SEARCH_HALF_M / 111_320;
  const dLon = SEARCH_HALF_M / (111_320 * Math.cos((lat * Math.PI) / 180));
  const crsUrn = `urn:ogc:def:crs:EPSG::${endpoint.crs}`;
  const bbox = `${lat - dLat},${lon - dLon},${lat + dLat},${lon + dLon},${crsUrn}`;
  const url =
    `${endpoint.url}?service=WFS&version=2.0.0&request=GetFeature` +
    `&typeNames=${encodeURIComponent(endpoint.typeName)}&count=20` +
    `&srsName=${crsUrn}&bbox=${encodeURIComponent(bbox)}`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
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
