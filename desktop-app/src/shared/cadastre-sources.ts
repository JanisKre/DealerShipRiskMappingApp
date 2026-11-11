import type { GermanState } from "./imagery-sources";

/**
 * Cadastral parcel (Flurstück) overlay for the map, drawn from the open
 * ALKIS / INSPIRE "Cadastral Parcels" view services (WMS) of the German
 * states. There is no open nationwide parcel map: insurer tools such as
 * ZÜRS Geo license ALKIS separately, so the app stitches the state services
 * together, each limited to its rough state box.
 *
 * Every entry below was verified live in November 2026: GetCapabilities
 * lists the layer with EPSG:3857, and a 256 px GetMap tile over a city
 * centre returned transparent PNG parcel outlines (docs/cadastre-overlay.md).
 * Saarland publishes no open parcel WMS, so it is not listed.
 *
 * The overlay is a display aid only: it is not the authoritative legal
 * boundary record (that is the certified extract from the Kataster office),
 * and it does not feed any risk calculation.
 */

/** WMS LAYERS and STYLES parameters, comma-separated and index-aligned. */
export interface CadastreLayerSet {
  layers: string;
  styles: string;
}

export interface StateCadastreService {
  state: GermanState;
  /** WMS 1.3.0 endpoint without query string. */
  url: string;
  /**
   * Outline-only style, without the white halos some default styles draw
   * (those vanish on light basemaps). Shown as served over aerial imagery,
   * mostly yellow; recoloured to `CADASTRE_MAP_COLOR` over streets and
   * terrain so every state looks the same there.
   */
  style: CadastreLayerSet;
  /** Required source attribution; `{year}` is replaced with the current year. */
  attribution: string;
  license: string;
  /** Rough WGS84 box [[south, west], [north, east]]; boxes of neighbours overlap. */
  bounds: [[number, number], [number, number]];
}

/**
 * Lowest zoom the overlay is requested at. The services enforce a maximum
 * scale (1:5,000 to 1:20,000) and answer emptier tiles beyond it; at zoom 16
 * the parcel numbers of the services that do draw already overlap, so the
 * overlay starts at 17 (about 1:4,000) everywhere.
 */
export const CADASTRE_MIN_ZOOM = 17;

/**
 * Line colour over the streets and terrain basemaps. Dark lines disappear in
 * OpenTopoMap's black building hatching and yellow ones on OSM's light
 * colours; this red stays readable on both.
 */
export const CADASTRE_MAP_COLOR = "#e11d48";

export const STATE_CADASTRE_SERVICES: Partial<
  Record<GermanState, StateCadastreService>
> = {
  BW: {
    state: "BW",
    url: "https://owsproxy.lgl-bw.de/owsproxy/ows/WMS_LGL-BW_ALKIS_Basis_transparent",
    style: { layers: "nora:ALKIS_Basis_transparent", styles: "" },
    attribution: "© LGL-BW ({year}), dl-de/by-2-0",
    license: "dl-de/by-2-0",
    bounds: [
      [47.53, 7.51],
      [49.79, 10.5],
    ],
  },
  BY: {
    state: "BY",
    url: "https://geoservices.bayern.de/od/wms/alkis/v1/parzellarkarte",
    style: { layers: "by_alkis_parzellarkarte_umr_gelb", styles: "" },
    attribution: "© Bayerische Vermessungsverwaltung ({year}), CC BY 4.0",
    license: "CC BY 4.0",
    bounds: [
      [47.27, 8.97],
      [50.57, 13.84],
    ],
  },
  BE: {
    state: "BE",
    url: "https://gdi.berlin.de/services/wms/alkis_flurstuecke",
    style: { layers: "flurstuecke", styles: "" },
    attribution: "© Geoportal Berlin / ALKIS Berlin ({year}), dl-de/zero-2-0",
    license: "dl-de/zero-2-0",
    bounds: [
      [52.33, 13.09],
      [52.68, 13.76],
    ],
  },
  BB: {
    state: "BB",
    url: "https://isk.geobasis-bb.de/ows/alkis_wms",
    style: { layers: "adv_alkis_flurstuecke", styles: "Gelb" },
    attribution: "© GeoBasis-DE/LGB ({year}), dl-de/by-2-0",
    license: "dl-de/by-2-0",
    bounds: [
      [51.36, 11.27],
      [53.56, 14.77],
    ],
  },
  HB: {
    state: "HB",
    url: "https://opendata.lgln.niedersachsen.de/doorman/noauth/alkishb_wms",
    // The only Bremen layer is the full ALKIS map; its yellow style is the
    // outline-only variant.
    style: { layers: "ALKIS", styles: "Gelb" },
    attribution: "© GeoBremen ({year}), CC BY 4.0",
    license: "CC BY 4.0",
    bounds: [
      [53.01, 8.48],
      [53.61, 8.99],
    ],
  },
  HH: {
    state: "HH",
    url: "https://geodienste.hamburg.de/HH_WMS_INSPIRE_Flurstuecke",
    style: { layers: "CP.CadastralParcel", styles: "" },
    attribution: "© FHH, LGV ({year}), dl-de/by-2-0",
    license: "dl-de/by-2-0",
    bounds: [
      [53.39, 9.73],
      [53.75, 10.33],
    ],
  },
  HE: {
    state: "HE",
    url: "https://inspire-hessen.de/ows/services/org.2.07247d95-adc7-4c7d-9c7a-ed17af855317_wms",
    style: { layers: "CP.CadastralParcel", styles: "" },
    attribution: "© HVBG Hessen ({year}), dl-de/zero-2-0",
    license: "dl-de/zero-2-0",
    bounds: [
      [49.39, 7.77],
      [51.66, 10.24],
    ],
  },
  MV: {
    state: "MV",
    url: "https://www.geodaten-mv.de/dienste/alkis_wms",
    style: { layers: "adv_alkis_flurstuecke", styles: "Gelb" },
    attribution: "© GeoBasis-DE/M-V ({year}), CC BY 4.0",
    license: "CC BY 4.0",
    bounds: [
      [53.11, 10.59],
      [54.69, 14.41],
    ],
  },
  NI: {
    state: "NI",
    url: "https://www.inspire.niedersachsen.de/doorman/noauth/alkis-vs-cp",
    style: { layers: "CP.CadastralParcel", styles: "" },
    attribution: "© LGLN ({year}), CC BY 4.0",
    license: "CC BY 4.0",
    bounds: [
      [51.29, 6.65],
      [53.89, 11.6],
    ],
  },
  NW: {
    state: "NW",
    url: "https://www.wms.nrw.de/geobasis/wms_nw_alkis",
    style: { layers: "adv_alkis_flurstuecke", styles: "Gelb" },
    attribution: "© GeoBasis-DE / NRW ({year}), dl-de/zero-2-0",
    license: "dl-de/zero-2-0",
    bounds: [
      [50.32, 5.87],
      [52.53, 9.46],
    ],
  },
  RP: {
    state: "RP",
    url: "https://geo5.service24.rlp.de/wms/liegenschaften_rp.fcgi",
    style: { layers: "Flurstueck", styles: "" },
    attribution: "© GeoBasis-DE / LVermGeoRP ({year}), dl-de/by-2-0",
    license: "dl-de/by-2-0",
    bounds: [
      [48.97, 6.11],
      [50.94, 8.51],
    ],
  },
  SN: {
    state: "SN",
    url: "https://geodienste.sachsen.de/wms_geosn_flurstuecke/guest",
    style: {
      layers: "Flurstueck,Flurstuecksnummer",
      styles: "flurstueck_gelb,flurstuecksnummer_gelb",
    },
    attribution: "© GeoSN ({year}), dl-de/by-2-0",
    license: "dl-de/by-2-0",
    bounds: [
      [50.17, 11.87],
      [51.68, 15.04],
    ],
  },
  ST: {
    state: "ST",
    url: "https://www.geodatenportal.sachsen-anhalt.de/wss/service/ST_LVermGeo_ALKIS_WMS_AdV_konform_App/guest",
    style: { layers: "st_alkis_flurstuecke", styles: "Gelb" },
    attribution: "© GeoBasis-DE / LVermGeo ST ({year}), dl-de/by-2-0",
    license: "dl-de/by-2-0",
    bounds: [
      [50.94, 10.56],
      [53.06, 13.19],
    ],
  },
  SH: {
    state: "SH",
    url: "https://service.gdi-sh.de/SH_INSPIREVIEW_AI_CP_ALKIS",
    style: { layers: "CP.CadastralParcel", styles: "" },
    attribution: "© GeoBasis-DE/LVermGeo SH ({year}), CC BY 4.0",
    license: "CC BY 4.0",
    bounds: [
      [53.36, 7.86],
      [55.06, 11.32],
    ],
  },
  TH: {
    state: "TH",
    url: "https://www.geoproxy.geoportal-th.de/geoproxy/services/adv_alkis_wms_th",
    style: { layers: "adv_alkis_flurstuecke", styles: "" },
    attribution: "© GDI-Th ({year}), CC BY 4.0",
    license: "CC BY 4.0",
    bounds: [
      [50.2, 9.87],
      [51.65, 12.65],
    ],
  },
};

/**
 * WMS 1.3.0 GetMap template for one transparent 256 px tile, with the same
 * `{bbox-epsg-3857}` placeholder the state orthophotos use (Leaflet fills it
 * per tile in the renderer).
 */
export function cadastreTileTemplate(service: StateCadastreService): string {
  const set = service.style;
  const params = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetMap",
    LAYERS: set.layers,
    STYLES: set.styles,
    CRS: "EPSG:3857",
    WIDTH: "256",
    HEIGHT: "256",
    FORMAT: "image/png",
    TRANSPARENT: "TRUE",
  });
  return `${service.url}?${params.toString()}&BBOX={bbox-epsg-3857}`;
}

/** View box in WGS84 degrees. */
export interface CadastreViewBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/**
 * State services whose box intersects the view. Only these are mounted, so
 * the map shows only the attributions of the services actually drawn.
 */
export function cadastreServicesInView(
  view: CadastreViewBounds,
): StateCadastreService[] {
  return Object.values(STATE_CADASTRE_SERVICES).filter((s) => {
    const [[south, west], [north, east]] = s.bounds;
    return (
      view.south <= north &&
      view.north >= south &&
      view.west <= east &&
      view.east >= west
    );
  });
}

export function cadastreAttribution(
  service: StateCadastreService,
  year: number = new Date().getFullYear(),
): string {
  return service.attribution.replaceAll("{year}", String(year));
}
