import { buildTileUrl, DETECTION_ZOOM } from "@shared/constants";
import {
  buildStateTileUrl,
  DETECTION_MAX_RESOLUTION_M,
  IMAGERY_MIN_SELECTION_ZOOM,
  IMAGERY_TOLERANCE_DAYS,
  isGermanState,
  selectImagery,
  stateAttribution,
  STATE_DOP_SERVICES,
  type GermanState,
  type ImageryCandidate,
  type ImagerySelection,
} from "@shared/imagery-sources";
import { cached, cacheKeyFragment, TTL } from "./cache.service";
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
      const res = await fetchWithResilience(`${BKG_INFO_URL}?${params}`, {
        headers: { "User-Agent": "DealershipRiskMapping/1.0 (desktop)" },
      });
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

function stateCandidate(
  info: BkgFlightInfo,
  zoom: number,
): ImageryCandidate | null {
  const service = STATE_DOP_SERVICES[info.state];
  if (!service) return null;
  const flightYear = Number(info.flightDate.slice(0, 4));
  // A service pinned to one flight year must not borrow a newer BKG date.
  const vintageMismatch =
    service.vintageYear != null && service.vintageYear !== flightYear;
  return {
    id: `dop:${service.state}`,
    kind: "state-dop",
    label: service.label,
    capturedAt: vintageMismatch ? null : info.flightDate,
    dateSource: vintageMismatch ? "none" : "bkg-flight-index",
    resolutionM: service.resolutionM,
    zoom,
    attribution: stateAttribution(service),
    state: service.state,
    ...(vintageMismatch
      ? {
          note: `BKG lists a ${flightYear} flight, the open service serves ${service.vintageYear}`,
        }
      : {}),
  };
}

function customCandidate(zoom: number): ImageryCandidate {
  return {
    id: "custom",
    kind: "custom",
    label: "Custom WMS/XYZ",
    capturedAt: null,
    dateSource: "none",
    resolutionM: null,
    zoom,
    attribution: "",
  };
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
  if (provider === "wms" && !(wms && wms.includes("{"))) return "esri";
  return provider;
}

/**
 * Source for vehicle detection at a point. Esri is considered at
 * DETECTION_ZOOM and one level below, because Esri often serves a different
 * (older or newer) image at z20 than at z19. Only sources up to
 * DETECTION_MAX_RESOLUTION_M compete; when none qualifies, Esri is still used
 * and the detector flags the coarse imagery in its limitations.
 */
export async function selectImageryForDetection(
  lat: number,
  lon: number,
): Promise<ImagerySelection> {
  const mode = currentMode();
  if (mode === "wms") {
    const custom = customCandidate(DETECTION_ZOOM);
    return selection(mode, custom, "fixed-provider", [custom]);
  }

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
  const state = bkg ? stateCandidate(bkg, DETECTION_ZOOM) : null;
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

/** Source for the map view centred at a point at the current map zoom. */
export async function selectImageryForView(
  lat: number,
  lon: number,
  zoom: number,
): Promise<ImagerySelection> {
  const mode = currentMode();
  if (mode === "wms") {
    const custom = customCandidate(zoom);
    return selection(mode, custom, "fixed-provider", [custom]);
  }
  const esri = await esriCandidate(lat, lon, zoom);
  if (mode === "esri") return selection(mode, esri, "fixed-provider", [esri]);
  if (zoom < IMAGERY_MIN_SELECTION_ZOOM)
    return selection(mode, esri, "overview-zoom", [esri]);

  const bkg = await getBkgFlightInfo(lat, lon);
  const state = bkg ? stateCandidate(bkg, zoom) : null;
  const candidates = state ? [esri, state] : [esri];
  const { chosen, reason } = selectImagery(candidates, esri);
  return selection(mode, chosen, reason, candidates);
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
    const service = STATE_DOP_SERVICES[candidate.state];
    if (service) {
      return {
        cacheId: `dop:${service.state}:${cacheKeyFragment(`${service.url}|${service.layer ?? ""}`)}`,
        url: (z, y, x) => buildStateTileUrl(service, z, x, y),
      };
    }
  }
  if (candidate.kind === "custom") {
    const template = getSettings().wmsTileUrl ?? "";
    return {
      cacheId: `wms:${cacheKeyFragment(template)}`,
      url: (z, y, x, time) =>
        buildTileUrl("wms", z, y, x, { wmsTemplate: template, time }),
    };
  }
  return ESRI_TILE_SOURCE;
}
