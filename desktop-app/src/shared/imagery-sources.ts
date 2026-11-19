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
  /**
   * Lowest map zoom the service draws at. Below it the WMS answers with blank
   * white tiles (scale limit), so the map must stay on Esri there.
   */
  minZoom?: number;
  /**
   * Highest zoom the service has tiles for. Above it the service answers
   * with errors (Bayern's WMTS: HTTP 400 at z20), so captures stay at this
   * level and the map upscales it.
   */
  maxZoom?: number;
  /**
   * The state's own flight-date layer (WMS GetFeatureInfo, text/plain). Its
   * date is the one of the image the service serves; the BKG index lagged
   * two years behind it at test points in Köln and München (November 2026).
   */
  flightInfo?: { url: string; layer: string };
  /**
   * Services published per flight year: the layer whose year matches the
   * BKG flight date at the point is used (and dated); without a match the
   * newest one, undated. Replaces `layer`, `url` and `label` when chosen.
   */
  vintages?: ReadonlyArray<{
    year: number;
    layer: string;
    url?: string;
    label: string;
    resolutionM?: number;
  }>;
}

/**
 * Open, keyless orthophoto services verified in October and November 2026
 * (EPSG:3857, GetMap returns imagery). Hamburg's open time series also
 * carries Maxar imagery under a closed licence (stated in the service's
 * capabilities) and offers no date per tile, so Hamburg stays on Esri.
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
      // z20 answers HTTP 400, z19 serves the 20 cm image (November 2026).
      maxZoom: 19,
      flightInfo: {
        url: "https://geoservices.bayern.de/od/wms/dop/v1/dop20",
        layer: "by_dop20_info",
      },
    },
    BE: {
      state: "BE",
      label: "TrueDOP Berlin 2024",
      kind: "wms",
      url: "https://gdi.berlin.de/services/wms/truedop_2024",
      layer: "truedop_2024",
      resolutionM: 0.2,
      attribution: "© Geoportal Berlin ({year}), dl-de/zero-2-0",
      license: "dl-de/zero-2-0",
      vintageYear: 2024,
      vintages: [
        {
          year: 2024,
          url: "https://gdi.berlin.de/services/wms/truedop_2024",
          layer: "truedop_2024",
          label: "TrueDOP Berlin 2024",
        },
        {
          year: 2025,
          url: "https://gdi.berlin.de/services/wms/dop_2025_fruehjahr",
          layer: "dop20_2025",
          label: "DOP20 Berlin Frühjahr 2025",
        },
      ],
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
      // Bremen and Bremerhaven are separate layers of the same flight.
      layer: "dop10_2025_HB,dop10_2025_BHV",
      resolutionM: 0.1,
      attribution: "© Landesamt GeoInformation Bremen ({year}), CC BY 4.0",
      license: "CC BY 4.0",
      vintageYear: 2025,
      vintages: [
        {
          year: 2021,
          layer: "dop10_2021_HB,dop10_2021_BHV",
          label: "DOP10 Bremen 2021",
        },
        {
          year: 2023,
          layer: "dop10_2023_HB,dop10_2023_BHV",
          label: "DOP10 Bremen 2023",
        },
        {
          year: 2025,
          layer: "dop10_2025_HB,dop10_2025_BHV",
          label: "DOP10 Bremen 2025",
        },
      ],
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
      // Blank up to z15 (verified November 2026).
      minZoom: 16,
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
      flightInfo: {
        url: "https://www.wms.nrw.de/geobasis/wms_nw_dop",
        layer: "nw_dop_utm_info",
      },
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
      flightInfo: {
        url: "https://geodienste.sachsen.de/wms_geosn_dop-rgb/guest",
        layer: "sn_dop_020_info",
      },
    },
    ST: {
      state: "ST",
      label: "DOP20 Sachsen-Anhalt",
      kind: "wms",
      url: "https://www.geodatenportal.sachsen-anhalt.de/wss/service/ST_LVermGeo_DOP_WMS_OpenData/guest",
      layer: "lsa_lvermgeo_dop20_2",
      resolutionM: 0.2,
      attribution: "© GeoBasis-DE / LVermGeo ST ({year}), dl-de/by-2-0",
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
      // The service states CC BY 4.0 (checked November 2026).
      attribution: "© GDI-Th ({year}), CC BY 4.0",
      license: "CC BY 4.0",
    },
  };

/**
 * The service of a state as it serves one flight year: the matching entry of
 * `vintages` (layer, URL, label), else the service as registered.
 */
export function resolveStateService(
  state: GermanState,
  vintage?: number,
): StateDopService | undefined {
  const service = STATE_DOP_SERVICES[state];
  if (!service || vintage == null || !service.vintages) return service;
  const match = service.vintages.find((v) => v.year === vintage);
  if (!match) return service;
  return {
    ...service,
    url: match.url ?? service.url,
    layer: match.layer,
    label: match.label,
    resolutionM: match.resolutionM ?? service.resolutionM,
    vintageYear: match.year,
  };
}

/**
 * Flight date in a state's text/plain GetFeatureInfo answer: NRW
 * "Bildflugdatum = '11.05.2025'", Bayern "ua = '24.08.2024'", Sachsen
 * "Datum: 19.03. + 07.04.2024" (several days: the latest). ISO date or null.
 */
export function parseStateFlightDate(text: string): string | null {
  const line = text
    .split(/\r?\n/)
    .find((l) => /^\s*(?:Bildflugdatum|ua|Datum)\s*[=:]/i.test(l));
  if (!line) return null;
  const days = [...line.matchAll(/(\d{1,2})\.(\d{1,2})\.(\d{4})?/g)];
  const year = days
    .map((m) => m[3])
    .filter(Boolean)
    .at(-1);
  if (!year) return null;
  const iso = days
    .map(
      ([, d, m, y]) =>
        `${y ?? year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`,
    )
    .filter((date) => !Number.isNaN(Date.parse(date)))
    .sort();
  return iso.at(-1) ?? null;
}

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

/** XYZ (Web Mercator) tile column containing a longitude. */
export function lon2tile(lon: number, zoom: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** zoom);
}

/** XYZ (Web Mercator) tile row containing a latitude (row 0 is north). */
export function lat2tile(lat: number, zoom: number): number {
  return Math.floor(
    ((1 -
      Math.log(
        Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180),
      ) /
        Math.PI) /
      2) *
      2 ** zoom,
  );
}

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

/**
 * Whether the map may draw a state's orthophoto at a zoom: never below the
 * selection zoom (the view spans several states) or the service's own limit.
 */
export function stateImageryDrawableAt(
  state: GermanState | undefined,
  zoom: number,
): boolean {
  const service = state ? STATE_DOP_SERVICES[state] : undefined;
  return (
    service != null &&
    zoom >= Math.max(IMAGERY_MIN_SELECTION_ZOOM, service.minZoom ?? 0)
  );
}

export const ImageryCandidateSchema = z.object({
  /** Stable id, e.g. "esri:z19" or "dop:NW". */
  id: z.string(),
  kind: z.enum(["esri", "state-dop", "custom", "esri-wayback"]),
  label: z.string(),
  capturedAt: z.string().nullable(),
  /** Where `capturedAt` comes from. */
  dateSource: z.enum([
    "esri-metadata",
    "esri-wayback-metadata",
    "bkg-flight-index",
    "state-flight-index",
    "none",
  ]),
  resolutionM: z.number().nullable(),
  /** Zoom level the imagery is captured/displayed at. */
  zoom: z.number().int(),
  attribution: z.string(),
  state: z.enum(GERMAN_STATES).optional(),
  /** Flight year of a state service published per year (`vintages`). */
  vintage: z.number().int().optional(),
  /** Full Esri record for Esri candidates. */
  esri: ImageryMetadataSchema.optional(),
  /** Archived World Imagery version, for `esri-wayback` candidates. */
  wayback: z
    .object({
      release: z.number().int().positive(),
      /** ISO date Esri published this version of the basemap. */
      publishedAt: z.string(),
    })
    .optional(),
  /** Why a candidate's date was withheld or qualified. */
  note: z.string().optional(),
});
export type ImageryCandidate = z.infer<typeof ImageryCandidateSchema>;

/** Label of the custom tile source when the user gave it no name. */
export const CUSTOM_IMAGERY_LABEL = "Custom WMS/XYZ";

/**
 * The custom tile source as a candidate. Name, attribution and resolution
 * are the user's statements from the settings; a tile service publishes none
 * of them, and no capture date either.
 */
export function customImageryCandidate(
  stated:
    { name?: string; attribution?: string; resolutionM?: number } | undefined,
  zoom: number,
): ImageryCandidate {
  return {
    id: "custom",
    kind: "custom",
    label: stated?.name ?? CUSTOM_IMAGERY_LABEL,
    capturedAt: null,
    dateSource: "none",
    resolutionM: stated?.resolutionM ?? null,
    zoom,
    attribution: stated?.attribution ?? "",
  };
}

/**
 * Limitation for a custom source without a stated resolution: the detector
 * cannot tell whether the imagery is sharp enough, so the count says so.
 */
export function unstatedResolutionLimitations(
  chosen: ImageryCandidate | undefined,
): string[] {
  if (chosen?.kind !== "custom" || chosen.resolutionM != null) return [];
  return [
    "Resolution of the custom imagery source is not stated; on imagery " +
      `coarser than ${DETECTION_MAX_RESOLUTION_M} m/px the vehicle count is likely too low`,
  ];
}

export const ImagerySelectionReasonSchema = z.enum([
  "newest",
  "sharper-within-tolerance",
  "only-option",
  "no-dated-source",
  "no-sharp-source",
  "fixed-provider",
  "overview-zoom",
  /** A Wayback version chosen by the user for display. */
  "pinned-version",
]);
export type ImagerySelectionReason = z.infer<
  typeof ImagerySelectionReasonSchema
>;

/** Why the own tile source has no image at a place. */
export const OwnSourceGapSchema = z.enum([
  /** One flat colour: outside the coverage (or below a scale limit). */
  "blank",
  "unreachable",
  "http-error",
  "not-an-image",
]);
export type OwnSourceGap = z.infer<typeof OwnSourceGapSchema>;

const OWN_SOURCE_GAP_TEXT: Record<OwnSourceGap, string> = {
  blank: "blank tile, outside its coverage",
  unreachable: "not reachable",
  "http-error": "HTTP error",
  "not-an-image": "answer is not an image",
};

/** Note on the own source as a candidate that was not used. */
export function ownSourceGapNote(gap: OwnSourceGap): string {
  return `no image at this location (${OWN_SOURCE_GAP_TEXT[gap]})`;
}

export const ImagerySelectionSchema = z.object({
  mode: z.enum(["auto", "esri", "wms"]),
  chosen: ImageryCandidateSchema,
  reason: ImagerySelectionReasonSchema,
  /** Every source that was considered, including the chosen one. */
  candidates: z.array(ImageryCandidateSchema),
  /**
   * Set when the settings name the own tile source but it has no image
   * here: `chosen` and `reason` are then the automatic choice made instead.
   */
  fallbackFrom: z
    .object({ label: z.string(), gap: OwnSourceGapSchema })
    .optional(),
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
  const line = `Vehicles counted on ${c.label} (${date}${res}, z${c.zoom}; selection: ${selection.reason})`;
  const from = selection.fallbackFrom;
  return from
    ? `${line}; own source "${from.label}" has ${ownSourceGapNote(from.gap)}`
    : line;
}
