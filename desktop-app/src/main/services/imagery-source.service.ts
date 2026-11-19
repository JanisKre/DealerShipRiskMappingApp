import { buildTileUrl, DETECTION_ZOOM } from "@shared/constants";
import {
  buildStateTileUrl,
  customImageryCandidate,
  DETECTION_MAX_RESOLUTION_M,
  IMAGERY_MIN_SELECTION_ZOOM,
  IMAGERY_TOLERANCE_DAYS,
  isGermanState,
  ownSourceGapNote,
  parseStateFlightDate,
  resolveStateService,
  selectImagery,
  stateAttribution,
  stateImageryDrawableAt,
  STATE_DOP_SERVICES,
  type GermanState,
  type ImageryCandidate,
  type ImagerySelection,
  type OwnSourceGap,
} from "@shared/imagery-sources";
import { buildWaybackTileUrl } from "@shared/imagery-wayback";
import { isUsableTileTemplate } from "@shared/tile-template";
import { cached, cacheKeyFragment, TTL } from "./cache.service";
import { customImageryCoverage } from "./custom-imagery.service";
import { fetchWithResilience } from "./http.service";
import { getEsriImageryMetadata } from "./imagery-metadata.service";
import { getSettings } from "./settings.service";

/**
 * Per-location choice of aerial imagery (Esri vs. state orthophoto) for the
 * map and for vehicle detection. The decision rule itself lives in
 * shared/imagery-sources.ts; this service gathers the dated candidates.
 */

const BKG_INFO_URL = "https://sgx.geodatenzentrum.de/wms_info";
const ESRI_ATTRIBUTION = "© Esri World Imagery";

export interface BkgFlightInfo {
  state: GermanState;
  /** ISO date of the orthophoto flight covering the point. */
  flightDate: string;
}

/**
 * Flight date and state of the official orthophoto at a point, from the
 * BKG's freely accessible DOP index (one ~1 km² record per image block).
 * Returns null outside Germany or when the index is unreachable.
 */
export async function getBkgFlightInfo(
  lat: number,
  lon: number,
): Promise<BkgFlightInfo | null> {
  const key = `bkg-dop-info:${lat.toFixed(3)},${lon.toFixed(3)}`;
  try {
    return await cached(key, TTL.imageryMetadata, async () => {
      const d = 0.001;
      const params = new URLSearchParams({
        SERVICE: "WMS",
        VERSION: "1.3.0",
        REQUEST: "GetFeatureInfo",
        LAYERS: "dop",
        QUERY_LAYERS: "dop",
        STYLES: "",
        // WMS 1.3.0 + EPSG:4326 uses lat,lon axis order.
        CRS: "EPSG:4326",
        BBOX: `${lat - d},${lon - d},${lat + d},${lon + d}`,
        WIDTH: "101",
        HEIGHT: "101",
        I: "50",
        J: "50",
        INFO_FORMAT: "application/json",
        FEATURE_COUNT: "1",
      });
      const res = await fetchWithResilience(`${BKG_INFO_URL}?${params}`, {});
      if (!res.ok) throw new Error(`BKG DOP info ${res.status}`);
      return parseBkgFlightInfo(await res.json());
    });
  } catch {
    return null;
  }
}

export function parseBkgFlightInfo(json: unknown): BkgFlightInfo | null {
  const features = (json as { features?: unknown } | null)?.features;
  if (!Array.isArray(features) || features.length === 0) return null;
  const props = (features[0] as { properties?: Record<string, unknown> })
    ?.properties;
  const state = props?.land;
  const flightDate = props?.bildflug;
  if (!isGermanState(state)) return null;
  if (typeof flightDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(flightDate))
    return null;
  return { state, flightDate };
}

async function esriCandidate(
  lat: number,
  lon: number,
  zoom: number,
): Promise<ImageryCandidate> {
  const meta = await getEsriImageryMetadata(lat, lon, zoom);
  return {
    id: `esri:z${zoom}`,
    kind: "esri",
    label: meta.collection
      ? `Esri World Imagery (${meta.collection})`
      : "Esri World Imagery",
    capturedAt: meta.capturedAt,
    dateSource: meta.capturedAt ? "esri-metadata" : "none",
    resolutionM: meta.resolutionM,
    zoom,
    attribution: meta.source
      ? `${ESRI_ATTRIBUTION}, ${meta.source}`
      : ESRI_ATTRIBUTION,
    esri: meta,
  };
}

/**
 * Flight date from the state's own flight-date layer at a point (text/plain
 * GetFeatureInfo). Null when the state has none, it is unreachable or the
 * answer carries no date.
 */
export async function getStateFlightDate(
  state: GermanState,
  lat: number,
  lon: number,
): Promise<string | null> {
  const info = STATE_DOP_SERVICES[state]?.flightInfo;
  if (!info) return null;
  const key = `state-dop-info:${state}:${lat.toFixed(3)},${lon.toFixed(3)}`;
  try {
    return await cached(key, TTL.imageryMetadata, async () => {
      const d = 0.001;
      const params = new URLSearchParams({
        SERVICE: "WMS",
        VERSION: "1.3.0",
        REQUEST: "GetFeatureInfo",
        LAYERS: info.layer,
        QUERY_LAYERS: info.layer,
        STYLES: "",
        CRS: "EPSG:4326",
        BBOX: `${lat - d},${lon - d},${lat + d},${lon + d}`,
        WIDTH: "101",
        HEIGHT: "101",
        I: "50",
        J: "50",
        INFO_FORMAT: "text/plain",
        FEATURE_COUNT: "1",
      });
      const sep = info.url.includes("?") ? "&" : "?";
      const res = await fetchWithResilience(`${info.url}${sep}${params}`);
      if (!res.ok) throw new Error(`${state} DOP info ${res.status}`);
      return parseStateFlightDate(await res.text());
    });
  } catch {
    return null;
  }
}

/**
 * The state orthophoto as a candidate. Its date comes from the state's own
 * flight-date layer where there is one, else from the BKG index. A service
 * published per flight year serves the year the BKG lists; a service pinned
 * to another year is not given the BKG date.
 */
export function stateCandidate(
  info: BkgFlightInfo,
  zoom: number,
  stateFlightDate: string | null = null,
): ImageryCandidate | null {
  const registered = STATE_DOP_SERVICES[info.state];
  if (!registered) return null;
  const flightYear = Number(info.flightDate.slice(0, 4));
  const vintage = registered.vintages?.some((v) => v.year === flightYear)
    ? flightYear
    : undefined;
  const service = resolveStateService(info.state, vintage) ?? registered;
  // A service pinned to one flight year must not borrow a newer BKG date.
  const vintageMismatch =
    stateFlightDate == null &&
    service.vintageYear != null &&
    service.vintageYear !== flightYear;
  const capturedAt =
    stateFlightDate ?? (vintageMismatch ? null : info.flightDate);
  return {
    id: `dop:${service.state}`,
    kind: "state-dop",
    label: service.label,
    capturedAt,
    dateSource: stateFlightDate
      ? "state-flight-index"
      : vintageMismatch
        ? "none"
        : "bkg-flight-index",
    resolutionM: service.resolutionM,
    zoom: Math.min(zoom, service.maxZoom ?? zoom),
    attribution: stateAttribution(service),
    state: service.state,
    ...(vintage != null ? { vintage } : {}),
    ...(vintageMismatch
      ? {
          note: `BKG lists a ${flightYear} flight, the open service serves ${service.vintageYear}`,
        }
      : {}),
  };
}

function customCandidate(zoom: number): ImageryCandidate {
  return customImageryCandidate(getSettings().customImagery, zoom);
}

function selection(
  mode: ImagerySelection["mode"],
  chosen: ImageryCandidate,
  reason: ImagerySelection["reason"],
  candidates: ImageryCandidate[],
): ImagerySelection {
  return {
    mode,
    chosen,
    reason,
    candidates,
    toleranceDays: IMAGERY_TOLERANCE_DAYS,
    resolvedAt: new Date().toISOString(),
  };
}

function currentMode(): ImagerySelection["mode"] {
  const provider = getSettings().satelliteProvider ?? "auto";
  const wms = getSettings().wmsTileUrl;
  // A "wms" setting without a usable template behaves like Esri everywhere
  // else in the app (buildTileUrl falls back), so report it as such.
  if (provider === "wms" && !isUsableTileTemplate(wms)) return "esri";
  return provider;
}

/**
 * The automatic choice made instead of the own source, which has no image
 * here. The own source stays in the record as a candidate that was not used.
 */
function insteadOfOwnSource(
  automatic: ImagerySelection,
  custom: ImageryCandidate,
  gap: OwnSourceGap,
): ImagerySelection {
  return {
    ...automatic,
    mode: "wms",
    candidates: [
      ...automatic.candidates,
      { ...custom, note: ownSourceGapNote(gap) },
    ],
    fallbackFrom: { label: custom.label, gap },
  };
}

/**
 * Source for vehicle detection at a point. The own source from the settings
 * is used where it has an image; elsewhere the automatic choice is made, and
 * the selection says so (`fallbackFrom`).
 */
export async function selectImageryForDetection(
  lat: number,
  lon: number,
): Promise<ImagerySelection> {
  const mode = currentMode();
  if (mode !== "wms") return detectionSelection(lat, lon, mode);
  const custom = customCandidate(DETECTION_ZOOM);
  const coverage = await customImageryCoverage(lat, lon);
  if (coverage === "ok") {
    return selection(mode, custom, "fixed-provider", [custom]);
  }
  return insteadOfOwnSource(
    await detectionSelection(lat, lon, "auto"),
    custom,
    coverage,
  );
}

/**
 * Esri or state orthophoto for vehicle detection. Esri is considered at
 * DETECTION_ZOOM and one level below, because Esri often serves a different
 * (older or newer) image at z20 than at z19. Only sources up to
 * DETECTION_MAX_RESOLUTION_M compete; when none qualifies, Esri is still used
 * and the detector flags the coarse imagery in its limitations.
 */
async function detectionSelection(
  lat: number,
  lon: number,
  mode: "auto" | "esri",
): Promise<ImagerySelection> {
  const [esriHigh, esriLow, bkg] = await Promise.all([
    esriCandidate(lat, lon, DETECTION_ZOOM),
    esriCandidate(lat, lon, DETECTION_ZOOM - 1),
    mode === "auto" ? getBkgFlightInfo(lat, lon) : Promise.resolve(null),
  ]);
  // Esri answers z20 with placeholders where it has no z20 imagery; only a
  // published metadata record means real imagery exists at that level.
  const esri = [esriHigh.esri?.available ? esriHigh : null, esriLow].filter(
    (c): c is ImageryCandidate => c != null,
  );
  const stateDate = bkg ? await getStateFlightDate(bkg.state, lat, lon) : null;
  const state = bkg ? stateCandidate(bkg, DETECTION_ZOOM, stateDate) : null;
  const candidates = state ? [...esri, state] : esri;
  const fallback = esri[0];

  // Stricter than the map: coarse scenes are what the detector under-counts on.
  const limits = { maxResolutionM: DETECTION_MAX_RESOLUTION_M };
  if (mode === "esri") {
    const { chosen } = selectImagery(esri, fallback, limits);
    return selection(mode, chosen, "fixed-provider", candidates);
  }
  const { chosen, reason } = selectImagery(candidates, fallback, limits);
  return selection(mode, chosen, reason, candidates);
}

/**
 * Source for the map view centred at a point at the current map zoom. The
 * own source is drawn where it has an image for the tile at the map centre
 * (at the map zoom, so an overview asks for the area in view); elsewhere the
 * automatic choice is drawn.
 */
export async function selectImageryForView(
  lat: number,
  lon: number,
  zoom: number,
): Promise<ImagerySelection> {
  const mode = currentMode();
  if (mode !== "wms") return viewSelection(lat, lon, zoom, mode);
  const custom = customCandidate(zoom);
  const coverage = await customImageryCoverage(lat, lon, zoom);
  if (coverage === "ok") {
    return selection(mode, custom, "fixed-provider", [custom]);
  }
  return insteadOfOwnSource(
    await viewSelection(lat, lon, zoom, "auto"),
    custom,
    coverage,
  );
}

/** Esri or state orthophoto for the map view. */
async function viewSelection(
  lat: number,
  lon: number,
  zoom: number,
  mode: "auto" | "esri",
): Promise<ImagerySelection> {
  const esri = await esriCandidate(lat, lon, zoom);
  if (mode === "esri") return selection(mode, esri, "fixed-provider", [esri]);
  if (zoom < IMAGERY_MIN_SELECTION_ZOOM)
    return selection(mode, esri, "overview-zoom", [esri]);

  // The map follows the choice vehicle detection makes here (same candidates,
  // same sharpness limit), so "Automatic" shows the image a fresh analysis
  // counts on instead of a newer scene too coarse to count cars on.
  const detection = await detectionSelection(lat, lon, "auto");
  const counted = detection.candidates.find((c) => c.kind === "state-dop");
  const state = counted ? { ...counted, zoom } : null;
  const candidates = state ? [esri, state] : [esri];
  if (state && detection.chosen.kind === "state-dop") {
    // A state service that does not draw at this zoom leaves Esri's mosaic.
    return stateImageryDrawableAt(state.state, zoom)
      ? selection(mode, state, detection.reason, candidates)
      : selection(mode, esri, "overview-zoom", candidates);
  }
  return selection(mode, esri, detection.reason, candidates);
}

/** How the main process fetches tiles for a chosen candidate. */
export interface TileSource {
  /** Part of the tile cache key; must change whenever the imagery would. */
  cacheId: string;
  url: (z: number, y: number, x: number, time?: string) => string;
}

export const ESRI_TILE_SOURCE: TileSource = {
  cacheId: "esri",
  url: (z, y, x) => buildTileUrl("esri", z, y, x),
};

export function tileSourceForCandidate(
  candidate: ImageryCandidate,
): TileSource {
  if (candidate.kind === "state-dop" && candidate.state) {
    const service = resolveStateService(candidate.state, candidate.vintage);
    if (service) {
      return {
        cacheId: `dop:${service.state}:${cacheKeyFragment(`${service.url}|${service.layer ?? ""}`)}`,
        url: (z, y, x) => buildStateTileUrl(service, z, x, y),
      };
    }
  }
  if (candidate.kind === "esri-wayback" && candidate.wayback) {
    const { release } = candidate.wayback;
    return {
      cacheId: `wayback:${release}`,
      url: (z, y, x) => buildWaybackTileUrl(release, z, y, x),
    };
  }
  if (candidate.kind === "custom") {
    const template = getSettings().wmsTileUrl;
    // An unusable template is never fetched (buildTileUrl would fall back
    // to Esri anyway); keep the Esri cache id so tiles are not mislabelled.
    if (!isUsableTileTemplate(template)) return ESRI_TILE_SOURCE;
    return {
      cacheId: `wms:${cacheKeyFragment(template)}`,
      url: (z, y, x, time) =>
        buildTileUrl("wms", z, y, x, { wmsTemplate: template, time }),
    };
  }
  return ESRI_TILE_SOURCE;
}
