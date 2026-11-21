import type { SourceStatus } from "@shared/types";
import { cacheGet, cacheSet, TTL } from "./cache.service";
import { fetchWithResilience } from "./http.service";
import { checkRing } from "./boundary-geometry";
import { createCircuitBreaker } from "./boundary/circuit-breaker";
import { toUtm } from "./utm";
import { withBwAttributesStatus } from "./bw-parcel-attributes";
import { splitParcelsByLandUse, type LandUseSection } from "./parcel-sections";
import {
  ALKIS_ENDPOINTS,
  type AlkisEndpoint,
  statesForPoint,
} from "./alkis-endpoints";
import {
  type ParcelAttributes,
  type ParcelFeature,
  memberCount,
  mergeRings,
  onlyFeatureMembers,
  parcelContainsPoint,
  parseLandUseSections,
  parseParcelFeatures,
  parseWfsCounts,
  ringKey,
  ringsFromUtm,
  toUtm32,
} from "./alkis-parse";

// Moved out of this module; still importable from here.
export { type AlkisEndpoint, statesForPoint } from "./alkis-endpoints";
export {
  type ParcelAttributes,
  type ParcelFeature,
  type ParcelLandUse,
  type ParcelUse,
  classifyLandUse,
  isTruncated,
  mergeRings,
  onlyFeatureMembers,
  parcelContainsPoint,
  parseExteriorRings,
  parseLandUse,
  parseLandUseSections,
  parseParcelFeatures,
  parsePolygons,
  parseWfsCounts,
  ringsFromUtm,
  toUtm32,
} from "./alkis-parse";

/**
 * Cadastral parcels (ALKIS) from the federal states' WFS services: the
 * parcels around a point with their use, land-use sections, and parcel
 * rings for the boundary cascade. Answers are cached; a degraded answer
 * (fallback service, capped result) only for a day.
 */

/** Lifetime of an incomplete cadastre answer (see fetchParcelsNear). */
export const DEGRADED_CADASTRE_TTL_MS = 24 * 60 * 60 * 1000;

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
 * 16 German federal states, these 9 now confirmed return parcel
 * geometries for unauthenticated requests (NRW, Sachsen, Niedersachsen,
 * Schleswig-Holstein, Sachsen-Anhalt, Brandenburg, Berlin — Sept. 2026; Hessen
 * and Baden-Württemberg added 14 Sep 2026, see below). The remaining 7 have
 * open INSPIRE metadata but were still unreachable, dead, or
 * access-restricted the last time each was tried (Hamburg, Saarland, Bremen —
 * the `numberReturned` and non-geographic-CRS caveats below apply to any
 * future retest of these too; Thuringia, Mecklenburg-Western Pomerania,
 * Rhineland-Palatinate dead; Bavaria paid/access-restricted, Art. 13 INSPIRE
 * Directive). For these states, the chain automatically falls back to
 * OSM/Overture or the synthetic circle — not an error case, just no official
 * source (yet). Per the plan's own instruction not to carry forward a stale
 * negative finding unquestioned (docs/boundary-improvement-plan.de.md P8),
 * these are due for the same live retest that found Hessen and
 * Baden-Württemberg, not a permanent verdict.
 *
 * 4. Baden-Württemberg (added 14 Sep 2026, live-verified against Stuttgart and
 *    Freiburg, BBOX spatial filtering confirmed honoured): its default
 *    response CRS is a **projected** EPSG:25832 (UTM zone 32N) — plain metres,
 *    not the lat/lon this module parses. Rather than add UTM↔lat/lon
 *    projection math here, the request explicitly asks for the EPSG:4258
 *    (ETRS89 geographic) alternate its capabilities document also advertises,
 *    which the service honours and which needs no new parsing at all. Any
 *    other state whose `DefaultCRS` turns out to be projected is worth the
 *    same check before assuming it needs new code.
 *
 * 3. Hessen (added 14 Sep 2026, live-verified against Frankfurt and Kassel,
 *    BBOX spatial filtering confirmed honoured): its `numberReturned="0"` on
 *    every response is **not** an absence of data — the service's own inline
 *    XML comment documents it as a placeholder forced by a WFS 2.0 schema
 *    validation constraint (the real value would be "unknown", like
 *    `numberMatched`, but that fails schema validation). The actual features
 *    ride in `<wfs:member>` regardless. Its geometry is also encoded as
 *    `gml:Surface`/`gml:PolygonPatch`, not a bare `gml:Polygon` — a
 *    perfectly valid alternative GML3.2 surface encoding that the original
 *    16-state table's parser (and, it turns out, no code in this file until
 *    now) ever looked for, which is the more likely reason Hessen was
 *    recorded as returning nothing in the first place. Both gaps — reading
 *    `numberReturned` as an absence signal, and matching only bare
 *    `gml:Polygon` — are worth checking again on any state still marked
 *    unavailable above.
 */

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

/** Upper bound on features requested per call (one page). */
const PARCEL_REQUEST_LIMIT = 250;

/**
 * Pages fetched per query at most: 4 × 250 = 1,000 parcels. A 250 m search
 * box in a dense town holds more than one page; a capped answer misses
 * arbitrary parcels, often the one at the point (docs/boundary-model.md,
 * "Complete cadastre").
 */
export const PARCEL_MAX_PAGES = 4;

/**
 * Radius of the second, smaller query when the first one stays capped. Some
 * services ignore `startIndex` (Niedersachsen answers every page with the
 * first), so paging alone cannot complete them.
 */
export const PARCEL_FALLBACK_RADIUS_M = 100;

export interface ParcelLookup {
  parcels: ParcelFeature[];
  state: string | null;
  /**
   * True when the service had more parcels than it returned. A truncated set
   * must not be used to assemble a multi-parcel site: the missing parcels are
   * arbitrary, so the union would be arbitrary too.
   */
  truncated: boolean;
  /**
   * Radius around the point within which the parcel set is complete: the
   * search radius when nothing was capped, the fallback radius when only the
   * smaller query fit, 0 when even that was capped.
   */
  completeRadiusM?: number;
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
  /**
   * Whether the land-use sections (`ave:NutzungFlurstueck`) were applied:
   * "read" when the service answered, "failed" when it did not (parcels
   * then stay whole). Absent where the state publishes none.
   */
  landUseSections?: "read" | "failed";
}

/**
 * The land-use sections in the search box, paged like the parcels. A capped
 * answer is not an error: parcels whose sections are incomplete stay whole
 * (parcel-sections.ts checks the areas).
 */
export async function fetchLandUseSections(
  endpoint: AlkisEndpoint,
  lat: number,
  lon: number,
  radiusM: number,
  fetchPage: typeof fetchAlkisXml = fetchAlkisXml,
): Promise<{ sections: LandUseSection[]; truncated: boolean } | "error"> {
  const source: AlkisEndpoint = {
    url: endpoint.url,
    typeName: "ave:NutzungFlurstueck",
    crs: endpoint.crs,
    ...(endpoint.utmZone ? { utmZone: endpoint.utmZone } : {}),
  };
  const seen = new Set<string>();
  const sections: LandUseSection[] = [];
  let truncated = false;
  for (let page = 0; page < PARCEL_MAX_PAGES; page += 1) {
    const xml = await fetchPage(
      source,
      lat,
      lon,
      radiusM,
      page * PARCEL_REQUEST_LIMIT,
    );
    if (xml === "error") {
      if (page === 0) return "error";
      return { sections, truncated: true };
    }
    if (!xml) break;
    const before = sections.length;
    for (const section of parseLandUseSections(xml)) {
      const ring = source.utmZone
        ? ringsFromUtm(section.ring, source.utmZone)
        : section.ring;
      const key = ringKey(ring);
      if (seen.has(key)) continue;
      seen.add(key);
      sections.push({ ring, use: section.use });
    }
    const { matched, returned } = parseWfsCounts(xml);
    truncated =
      matched != null && returned != null && returned > 0
        ? matched > page * PARCEL_REQUEST_LIMIT + returned
        : memberCount(xml) >= PARCEL_REQUEST_LIMIT;
    if (!truncated || sections.length === before) break;
  }
  return { sections, truncated };
}

/**
 * The sections near the point, as `fetchParcelsNear` applies them: a capped
 * answer is completed near the point with the smaller box, like the parcels.
 */
async function landUseSectionsNear(
  endpoint: AlkisEndpoint,
  lat: number,
  lon: number,
  radiusM: number,
): Promise<LandUseSection[] | "error"> {
  const wide = await fetchLandUseSections(endpoint, lat, lon, radiusM);
  if (wide === "error" || !wide.truncated) {
    return wide === "error" ? "error" : wide.sections;
  }
  if (radiusM <= PARCEL_FALLBACK_RADIUS_M) return wide.sections;
  const near = await fetchLandUseSections(
    endpoint,
    lat,
    lon,
    PARCEL_FALLBACK_RADIUS_M,
  );
  if (near === "error") return wide.sections;
  const seen = new Set(wide.sections.map((section) => ringKey(section.ring)));
  return [
    ...wide.sections,
    ...near.sections.filter((section) => !seen.has(ringKey(section.ring))),
  ];
}

/**
 * The land-use sections near a point in `state`, as the parcel lookup reads
 * them; null where the state publishes none. For the boundary benchmark,
 * which completes frozen inputs with them.
 */
export async function landUseSectionsFor(
  state: string,
  lat: number,
  lon: number,
  radiusM: number = PARCEL_SEARCH_RADIUS_M,
): Promise<LandUseSection[] | "error" | null> {
  const endpoint = ALKIS_ENDPOINTS[state];
  if (!endpoint?.landUseSections) return null;
  return landUseSectionsNear(endpoint, lat, lon, radiusM);
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
    const key = `alkis:v6:${state}:${radiusM}:${lat.toFixed(4)},${lon.toFixed(4)}`;
    const hit = cacheGet<ParcelLookup>(key);
    if (hit) {
      answeredAtLeastOnce = true;
      if (hit.parcels.length > 0) {
        // The cache key rounds to ~11 m, so a real anchor up to that far from
        // the one that populated this entry can sit on the other side of a
        // parcel line. The parcel geometry is safe to reuse; whether *this*
        // point falls inside it is not.
        return {
          ...hit,
          containsAnchor: parcelContainsPoint(hit.parcels, lat, lon),
        };
      }
      continue;
    }

    // Started with the parcels: the same host, another layer.
    const sectionsPromise = endpoint.landUseSections
      ? landUseSectionsNear(endpoint, lat, lon, radiusM).catch(
          () => "error" as const,
        )
      : null;
    let source = endpoint;
    let fetched = await fetchParcelRings(source, lat, lon, radiusM);
    if (fetched === "error" && endpoint.fallback) {
      source = endpoint.fallback;
      fetched = await fetchParcelRings(source, lat, lon, radiusM);
    }
    if (fetched === "error") {
      breaker.recordFailure(state);
      // A transient service error is not a statement about this location.
      // Writing it through `cached()` would persist "no parcels here" for a
      // month, long after the service recovered.
      continue;
    }
    breaker.recordSuccess(state);
    answeredAtLeastOnce = true;

    const { truncated, attributes } = fetched;
    let { rings } = fetched;
    let completeRadiusM = truncated ? 0 : radiusM;
    if (truncated && radiusM > PARCEL_FALLBACK_RADIUS_M) {
      // The neighbourhood of the point matters most; a smaller box fits.
      const near = await fetchParcelRings(
        source,
        lat,
        lon,
        PARCEL_FALLBACK_RADIUS_M,
      );
      if (near !== "error") {
        rings = mergeRings(rings, near.rings);
        for (const [id, value] of near.attributes) attributes.set(id, value);
        if (!near.truncated) completeRadiusM = PARCEL_FALLBACK_RADIUS_M;
      }
    }

    let parcels: ParcelFeature[] = [];
    for (const ring of rings) {
      const check = checkRing(ring, {
        minAreaSqm: 25,
        maxAreaSqm: 2_000_000,
      });
      if (!check.valid) continue;
      parcels.push({
        ring,
        areaSqm: check.areaSqm,
        state,
        ...attributes.get(ringKey(ring)),
      });
    }
    // BW publishes address and land use as separate layers.
    let attributesFailed = false;
    if (state === "Baden-Württemberg") {
      const enriched = await withBwAttributesStatus(parcels, lat, lon, radiusM);
      parcels = enriched.parcels;
      attributesFailed = enriched.layerFailed;
    }
    // Land-use sections cut open land off a parcel along the cadastre's
    // lines (cascade v15); without them the parcels stay whole.
    let landUseSections: ParcelLookup["landUseSections"];
    if (sectionsPromise) {
      const sections = await sectionsPromise;
      if (sections === "error") {
        landUseSections = "failed";
        attributesFailed = true;
      } else {
        landUseSections = "read";
        parcels = splitParcelsByLandUse(parcels, sections).parcels;
      }
    }
    const result: ParcelLookup = {
      parcels,
      state,
      truncated,
      completeRadiusM,
      reachable: true,
      containsAnchor: parcelContainsPoint(parcels, lat, lon),
      status:
        parcels.length === 0
          ? "successEmpty"
          : truncated
            ? "partial"
            : "success",
      ...(landUseSections ? { landUseSections } : {}),
    };
    // A degraded answer (INSPIRE fallback without address and land use, a
    // capped answer, a failed BW attribute layer) is kept for a day only:
    // the full answer must replace it once the service recovers, not a
    // month later.
    const degraded = source !== endpoint || truncated || attributesFailed;
    cacheSet(key, result, degraded ? DEGRADED_CADASTRE_TTL_MS : TTL.cadastre);

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
 * All parcel rings in the search box, paged with `startIndex` up to
 * `PARCEL_MAX_PAGES`. A page that adds nothing new means the service ignores
 * `startIndex`; paging stops there and the answer stays truncated. A failed
 * later page keeps what arrived and marks it truncated.
 */
export async function fetchParcelRings(
  endpoint: AlkisEndpoint,
  lat: number,
  lon: number,
  radiusM: number,
  fetchPage: typeof fetchAlkisXml = fetchAlkisXml,
): Promise<
  | {
      rings: [number, number][][];
      truncated: boolean;
      /** Address and land use per ring (`ringKey`), where published. */
      attributes: Map<string, ParcelAttributes>;
    }
  | "error"
> {
  let rings: [number, number][][] = [];
  let truncated = false;
  const attributes = new Map<string, ParcelAttributes>();
  for (let page = 0; page < PARCEL_MAX_PAGES; page += 1) {
    const xml = await fetchPage(
      endpoint,
      lat,
      lon,
      radiusM,
      page * PARCEL_REQUEST_LIMIT,
    );
    if (xml === "error") {
      if (page === 0) return "error";
      truncated = true;
      break;
    }
    if (!xml) break;
    const before = rings.length;
    const zone = endpoint.utmZone;
    const features = parseParcelFeatures(xml).map((feature) =>
      zone ? { ...feature, ring: ringsFromUtm(feature.ring, zone) } : feature,
    );
    for (const { ring, address, landUse } of features) {
      if (address || landUse) {
        attributes.set(ringKey(ring), {
          ...(address ? { address } : {}),
          ...(landUse ? { landUse } : {}),
        });
      }
    }
    rings = mergeRings(
      rings,
      features.map((feature) => feature.ring),
    );
    // `numberMatched` counts the whole answer, `numberReturned` this page.
    const { matched, returned } = parseWfsCounts(xml);
    // Some services (Hessen, Hamburg) always write numberReturned="0"; the
    // members of the page are then the only count there is.
    truncated =
      matched != null && returned != null && returned > 0
        ? matched > page * PARCEL_REQUEST_LIMIT + returned
        : returned != null && returned > 0
          ? returned >= PARCEL_REQUEST_LIMIT
          : memberCount(xml) >= PARCEL_REQUEST_LIMIT;
    if (!truncated || rings.length === before) break;
  }
  return { rings, truncated, attributes };
}

/** "error" = network/HTTP error (counts toward the circuit breaker); null = reachable, but no hit. */
async function fetchAlkisXml(
  endpoint: AlkisEndpoint,
  lat: number,
  lon: number,
  radiusM: number,
  startIndex = 0,
): Promise<string | null | "error"> {
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  const crsUrn = endpoint.utmZone
    ? `urn:ogc:def:crs:EPSG::258${endpoint.utmZone}`
    : `urn:ogc:def:crs:EPSG::${endpoint.crs}`;
  let bbox = `${lat - dLat},${lon - dLon},${lat + dLat},${lon + dLon},${crsUrn}`;
  if (endpoint.bboxUtm32) {
    const [east, north] = toUtm32(lat, lon);
    bbox = `${east - radiusM},${north - radiusM},${east + radiusM},${north + radiusM},urn:ogc:def:crs:EPSG::25832`;
  }
  let url: string;
  if (endpoint.utmZone && endpoint.storedQuery) {
    // One answer with every layer; it has no paging.
    if (startIndex > 0) return null;
    const [east, north] = toUtm(lat, lon, endpoint.utmZone);
    url =
      `${endpoint.url}?service=WFS&version=2.0.0&request=GetFeature` +
      `&STOREDQUERY_ID=${encodeURIComponent(endpoint.storedQuery)}` +
      `&CRS=${encodeURIComponent(crsUrn)}` +
      `&x1=${(east - radiusM).toFixed(1)}&y1=${(north - radiusM).toFixed(1)}` +
      `&x2=${(east + radiusM).toFixed(1)}&y2=${(north + radiusM).toFixed(1)}`;
  } else {
    if (endpoint.utmZone) {
      const [east, north] = toUtm(lat, lon, endpoint.utmZone);
      bbox = `${east - radiusM},${north - radiusM},${east + radiusM},${north + radiusM},${crsUrn}`;
    }
    url =
      `${endpoint.url}?service=WFS&version=2.0.0&request=GetFeature` +
      `&typeNames=${encodeURIComponent(endpoint.typeName)}&count=${PARCEL_REQUEST_LIMIT}` +
      (startIndex > 0 ? `&startIndex=${startIndex}` : "") +
      `&srsName=${crsUrn}&bbox=${encodeURIComponent(bbox)}`;
  }
  try {
    const res = await fetchWithResilience(url, {});
    if (!res.ok) return "error";
    const text = await res.text();
    if (text.includes("ExceptionReport")) return "error";
    return endpoint.featureElement
      ? onlyFeatureMembers(text, endpoint.featureElement)
      : text;
  } catch {
    return "error";
  }
}
