import { z } from "zod";
import { ImageryMetadataSchema } from "./imagery-metadata";

/**
 * Automatic choice of the aerial imagery a location is analysed on.
 *
 * Candidates are Esri World Imagery (dated per zoom level via Esri's
 * metadata layers) and the official orthophotos (DOP) of the German states,
 * dated via the BKG flight index. The rule is deterministic: the newest
 * dated source wins, unless a sharper source is less than
 * `IMAGERY_TOLERANCE_DAYS` older — for counting parked vehicles, 20 cm from
 * last spring beats 50 cm from last summer. Methodology and limitations:
 * docs/imagery-sources.md.
 */

export const GERMAN_STATES = [
  "BW",
  "BY",
  "BE",
  "BB",
  "HB",
  "HH",
  "HE",
  "MV",
  "NI",
  "NW",
  "RP",
  "SL",
  "SN",
  "ST",
  "SH",
  "TH",
] as const;
export type GermanState = (typeof GERMAN_STATES)[number];

export interface StateDopService {
  state: GermanState;
  /** Product name shown in the legend and provenance. */
  label: string;
  kind: "xyz" | "wms";
  /** XYZ template ({z}/{x}/{y}) or WMS base URL. */
  url: string;
  /** WMS layer name (kind "wms" only). */
  layer?: string;
  resolutionM: number;
  /** Required source attribution; `{year}` is replaced with the retrieval year. */
  attribution: string;
  license: string;
  /**
   * Year of the imagery the service actually serves, when it is pinned to
   * one flight year. The BKG index may already list a newer flight the open
   * service does not publish yet; such dates must not be attributed to it.
   */
  vintageYear?: number;
}

/**
 * Open, keyless orthophoto services verified in October 2026 (EPSG:3857,
 * GetMap returns imagery). Hamburg and Sachsen-Anhalt have no verified open
 * endpoint; there the choice falls back to Esri.
 */
export const STATE_DOP_SERVICES: Partial<Record<GermanState, StateDopService>> =
  {
    BW: {
      state: "BW",
      label: "DOP20 Baden-Württemberg",
      kind: "wms",
      url: "https://owsproxy.lgl-bw.de/owsproxy/ows/WMS_LGL-BW_ATKIS_DOP_20_C",
      layer: "IMAGES_DOP_20_RGB",
      resolutionM: 0.2,
      attribution: "© LGL-BW ({year}), dl-de/by-2-0",
      license: "dl-de/by-2-0",
    },
    BY: {
      state: "BY",
      label: "DOP20 Bayern",
      kind: "xyz",
      url: "https://wmtsod1.bayernwolke.de/wmts/by_dop/smerc/{z}/{x}/{y}",
      resolutionM: 0.2,
      attribution: "© Bayerische Vermessungsverwaltung ({year}), CC BY 4.0",
      license: "CC BY 4.0",
    },
    BE: {
      state: "BE",
      label: "TrueDOP Berlin 2024",
      kind: "wms",
      url: "https://gdi.berlin.de/services/wms/truedop_2024",
      layer: "truedop_2024",
      resolutionM: 0.2,
      attribution: "© Geoportal Berlin / TrueDOP 2024, dl-de/zero-2-0",
      license: "dl-de/zero-2-0",
      vintageYear: 2024,
    },
    BB: {
      state: "BB",
      label: "DOP20 Brandenburg",
      kind: "wms",
      url: "https://isk.geobasis-bb.de/mapproxy/dop20c/service/wms",
      layer: "bebb_dop20c",
      resolutionM: 0.2,
      attribution: "© GeoBasis-DE/LGB ({year}), dl-de/by-2-0",
      license: "dl-de/by-2-0",
    },
    HB: {
      state: "HB",
      label: "DOP10 Bremen 2025",
      kind: "wms",
      url: "https://geodienste.bremen.de/wms_dop_lb",
      layer: "dop10_2025_HB",
      resolutionM: 0.1,
      attribution: "© Landesamt GeoInformation Bremen ({year}), CC BY 4.0",
      license: "CC BY 4.0",
      vintageYear: 2025,
    },
    HE: {
      state: "HE",
      label: "DOP20 Hessen",
      kind: "wms",
      url: "https://www.gds-srv.hessen.de/cgi-bin/lika-services/ogc-free-images.ows?language=ger",
      layer: "he_dop20_rgb",
      resolutionM: 0.2,
      attribution: "© HVBG Hessen ({year}), dl-de/zero-2-0",
      license: "dl-de/zero-2-0",
    },
    MV: {
      state: "MV",
      label: "DOP20 Mecklenburg-Vorpommern",
      kind: "wms",
      url: "https://www.geodaten-mv.de/dienste/adv_dop",
      layer: "mv_dop",
      resolutionM: 0.2,
      attribution: "© GeoBasis-DE/M-V ({year}), CC BY 4.0",
      license: "CC BY 4.0",
    },
    NI: {
      state: "NI",
      label: "DOP20 Niedersachsen",
      kind: "wms",
      url: "https://opendata.lgln.niedersachsen.de/doorman/noauth/dop_wms",
      layer: "ni_dop20",
      resolutionM: 0.2,
      attribution: "© LGLN ({year}), CC BY 4.0",
      license: "CC BY 4.0",
    },
    NW: {
      state: "NW",
      label: "DOP10 Nordrhein-Westfalen",
      kind: "wms",
      url: "https://www.wms.nrw.de/geobasis/wms_nw_dop",
      layer: "nw_dop_rgb",
      resolutionM: 0.1,
      attribution: "© GeoBasis-DE / NRW ({year}), dl-de/zero-2-0",
      license: "dl-de/zero-2-0",
    },
    RP: {
      state: "RP",
      label: "DOP20 Rheinland-Pfalz",
      kind: "wms",
      url: "https://geo4.service24.rlp.de/wms/rp_dop20.fcgi",
      layer: "rp_dop20",
      resolutionM: 0.2,
      attribution: "© GeoBasis-DE / LVermGeoRP ({year}), dl-de/by-2-0",
      license: "dl-de/by-2-0",
    },
    SL: {
      state: "SL",
      label: "DOP Saarland",
      kind: "wms",
      url: "https://geoportal.saarland.de/freewms/dop",
      layer: "sl_dop",
      resolutionM: 0.2,
      attribution: "© GeoBasis-DE/LVGL-SL ({year}), dl-de/by-2-0",
      license: "dl-de/by-2-0",
    },
    SN: {
      state: "SN",
      label: "DOP20 Sachsen",
      kind: "wms",
      url: "https://geodienste.sachsen.de/wms_geosn_dop-rgb/guest",
      layer: "sn_dop_020",
      resolutionM: 0.2,
      attribution: "© GeoSN ({year}), dl-de/by-2-0",
      license: "dl-de/by-2-0",
    },
    SH: {
      state: "SH",
      label: "DOP20 Schleswig-Holstein",
      kind: "wms",
      url: "https://service.gdi-sh.de/WMS_SH_DOP20col_OpenGBD",
      layer: "sh_dop20_rgb",
      resolutionM: 0.2,
      attribution: "© GeoBasis-DE/LVermGeo SH ({year}), CC BY 4.0",
      license: "CC BY 4.0",
    },
    TH: {
      state: "TH",
      label: "DOP20 Thüringen",
      kind: "wms",
      url: "https://www.geoproxy.geoportal-th.de/geoproxy/services/DOP",
      layer: "th_dop",
      resolutionM: 0.2,
      attribution: "© GDI-Th ({year}), dl-de/by-2-0",
      license: "dl-de/by-2-0",
    },
  };

export function isGermanState(value: unknown): value is GermanState {
  return (
    typeof value === "string" &&
    (GERMAN_STATES as readonly string[]).includes(value)
  );
}

export function stateAttribution(
  service: StateDopService,
  year: number = new Date().getFullYear(),
): string {
  return service.attribution.replaceAll("{year}", String(year));
}

// --- Tile geometry ----------------------------------------------------------

const EARTH_HALF_CIRCUMFERENCE = Math.PI * 6378137;

/** Web Mercator (EPSG:3857) bounds of an XYZ tile: [minX, minY, maxX, maxY]. */
export function tileBboxEpsg3857(
  z: number,
  x: number,
  y: number,
): [number, number, number, number] {
  const size = (2 * EARTH_HALF_CIRCUMFERENCE) / 2 ** z;
  const minX = -EARTH_HALF_CIRCUMFERENCE + x * size;
  const maxY = EARTH_HALF_CIRCUMFERENCE - y * size;
  return [minX, maxY - size, minX + size, maxY];
}

/**
 * Tile URL template for a state service: the XYZ template as-is, or a WMS
 * 1.3.0 GetMap request for one 256 px tile with a `{bbox-epsg-3857}`
 * placeholder. The same template is filled in the main process (capture)
 * and by Leaflet in the renderer (map), so both always show the same image.
 */
export function stateTileTemplate(service: StateDopService): string {
  if (service.kind === "xyz") return service.url;
  const params = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetMap",
    LAYERS: service.layer ?? "",
    STYLES: "",
    CRS: "EPSG:3857",
    WIDTH: "256",
    HEIGHT: "256",
    FORMAT: "image/jpeg",
  });
  const sep = service.url.includes("?") ? "&" : "?";
  return `${service.url}${sep}${params.toString()}&BBOX={bbox-epsg-3857}`;
}

/** Fills {z}/{x}/{y} and {bbox-epsg-3857} in a tile template. */
export function fillTileTemplate(
  template: string,
  z: number,
  x: number,
  y: number,
): string {
  return template
    .replaceAll("{z}", String(z))
    .replaceAll("{x}", String(x))
    .replaceAll("{y}", String(y))
    .replaceAll("{bbox-epsg-3857}", tileBboxEpsg3857(z, x, y).join(","));
}

export function buildStateTileUrl(
  service: StateDopService,
  z: number,
  x: number,
  y: number,
): string {
  return fillTileTemplate(stateTileTemplate(service), z, x, y);
}

// --- Selection --------------------------------------------------------------

/**
 * A sharper source may be up to this much older than the newest one and
 * still win. Half a year keeps the seasonal stock picture comparable while
 * preferring 10–20 cm orthophotos over 30–50 cm satellite scenes.
 */
export const IMAGERY_TOLERANCE_DAYS = 183;
/** Coarser sources cannot resolve individual parked cars. */
export const IMAGERY_MAX_RESOLUTION_M = 0.5;
/**
 * Finest-to-coarsest range the vehicle detector is trained on: the dealership
 * model sees 0.10–0.20 m state orthophotos. Coarser imagery is upsampled at
 * most 2.5× (resampleFactor), so cars stay smaller and blurrier than in
 * training and are under-counted. Detection only competes sources up to this
 * resolution; the map still uses IMAGERY_MAX_RESOLUTION_M.
 */
export const DETECTION_MAX_RESOLUTION_M = 0.25;
/** Below this map zoom the view spans several states; Esri's mosaic is used. */
export const IMAGERY_MIN_SELECTION_ZOOM = 15;

export const ImageryCandidateSchema = z.object({
  /** Stable id, e.g. "esri:z19" or "dop:NW". */
  id: z.string(),
  kind: z.enum(["esri", "state-dop", "custom"]),
  label: z.string(),
  capturedAt: z.string().nullable(),
  /** Where `capturedAt` comes from. */
  dateSource: z.enum(["esri-metadata", "bkg-flight-index", "none"]),
  resolutionM: z.number().nullable(),
  /** Zoom level the imagery is captured/displayed at. */
  zoom: z.number().int(),
  attribution: z.string(),
  state: z.enum(GERMAN_STATES).optional(),
  /** Full Esri record for Esri candidates. */
  esri: ImageryMetadataSchema.optional(),
  /** Why a candidate's date was withheld or qualified. */
  note: z.string().optional(),
});
export type ImageryCandidate = z.infer<typeof ImageryCandidateSchema>;

export const ImagerySelectionReasonSchema = z.enum([
  "newest",
  "sharper-within-tolerance",
  "only-option",
  "no-dated-source",
  "no-sharp-source",
  "fixed-provider",
  "overview-zoom",
]);
export type ImagerySelectionReason = z.infer<
  typeof ImagerySelectionReasonSchema
>;

export const ImagerySelectionSchema = z.object({
  mode: z.enum(["auto", "esri", "wms"]),
  chosen: ImageryCandidateSchema,
  reason: ImagerySelectionReasonSchema,
  /** Every source that was considered, including the chosen one. */
  candidates: z.array(ImageryCandidateSchema),
  toleranceDays: z.number(),
  resolvedAt: z.string(),
});
export type ImagerySelection = z.infer<typeof ImagerySelectionSchema>;

export const ImageryViewRequestSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
  zoom: z.number().int().min(0).max(23),
});

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(newer: string, older: string): number {
  return (Date.parse(newer) - Date.parse(older)) / DAY_MS;
}

/**
 * Picks the source to analyse/display. Pure and deterministic.
 *
 * 1. Only dated sources no coarser than `maxResolutionM` compete.
 * 2. Among those within `toleranceDays` of the newest, the sharpest wins
 *    (ties go to the newer one).
 * 3. Without any dated source, `fallback` is used.
 */
export function selectImagery(
  candidates: ImageryCandidate[],
  fallback: ImageryCandidate,
  {
    toleranceDays = IMAGERY_TOLERANCE_DAYS,
    maxResolutionM = IMAGERY_MAX_RESOLUTION_M,
  }: { toleranceDays?: number; maxResolutionM?: number } = {},
): { chosen: ImageryCandidate; reason: ImagerySelectionReason } {
  const dated = candidates.filter(
    (c) => c.capturedAt != null && !Number.isNaN(Date.parse(c.capturedAt)),
  );
  const usable = dated
    .filter((c) => c.resolutionM == null || c.resolutionM <= maxResolutionM)
    .sort((a, b) => b.capturedAt!.localeCompare(a.capturedAt!));
  if (usable.length === 0) {
    return {
      chosen: fallback,
      reason: dated.length > 0 ? "no-sharp-source" : "no-dated-source",
    };
  }

  const newest = usable[0];
  const contenders = usable.filter(
    (c) => daysBetween(newest.capturedAt!, c.capturedAt!) < toleranceDays,
  );
  // Stable: `usable` is newest-first, so equal resolutions keep the newer one.
  const sharpest = contenders.reduce((best, c) =>
    (c.resolutionM ?? Infinity) < (best.resolutionM ?? Infinity) ? c : best,
  );
  if (usable.length === 1) return { chosen: newest, reason: "only-option" };
  return sharpest === newest
    ? { chosen: newest, reason: "newest" }
    : { chosen: sharpest, reason: "sharper-within-tolerance" };
}

/** Short English provenance line for evidence/limitations and reports. */
export function describeImagerySelection(selection: ImagerySelection): string {
  const c = selection.chosen;
  const date = c.capturedAt ?? "unknown capture date";
  const res = c.resolutionM != null ? `, ${c.resolutionM} m` : "";
  return `Vehicles counted on ${c.label} (${date}${res}, z${c.zoom}; selection: ${selection.reason})`;
}
