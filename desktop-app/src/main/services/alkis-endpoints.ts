/** The cadastre services of the federal states and the rough state extents that pick them for a point. */

export interface AlkisEndpoint {
  url: string;
  typeName: string;
  /** EPSG code for BBOX filter and response geometry (states require different CRS). */
  crs: number;
  /**
   * Some services (Thüringen) ignore a geographic BBOX and only filter on
   * their native UTM zone 32 grid; the response still comes in `crs`.
   */
  bboxUtm32?: true;
  /**
   * The service answers in UTM only (EPSG:25832 or 25833): the search box is
   * sent and the geometry returned in that zone, then converted to
   * geographic coordinates. `crs` is ignored.
   */
  utmZone?: 32 | 33;
  /**
   * Parcels are only served through this stored bbox query (parameters
   * CRS, x1, y1, x2, y2; requires `utmZone`). Its answer holds every layer,
   * so only `featureElement` members are read.
   */
  storedQuery?: string;
  /** Element name of a parcel member, where the answer holds other layers. */
  featureElement?: string;
  /**
   * The service also publishes `ave:NutzungFlurstueck`, the land-use
   * sections of each parcel (same host, search box and CRS). Probed live
   * on 19 November 2026; Sachsen-Anhalt and Schleswig-Holstein list the
   * type in their capabilities but reject it.
   */
  landUseSections?: true;
  /**
   * Queried when this endpoint fails. The simplified ALKIS services
   * (`ave:Flurstueck`) carry each parcel's address and land use; the INSPIRE
   * service they replaced stays as the fallback, with geometry only.
   */
  fallback?: AlkisEndpoint;
}

/**
 * Since November 2026 the simplified ALKIS product of the AdV
 * (`ave:Flurstueck`) is preferred wherever a state serves it in geographic
 * coordinates: besides the geometry it carries the parcel's address
 * (`lagebeztxt`) and its actual land use (`tntxt`), which the boundary
 * cascade uses (docs/boundary-model.md, "Cascade v9"). Probed live on
 * 13 November 2026: address and land use in NRW, Rheinland-Pfalz, Thüringen,
 * Sachsen, Niedersachsen, Sachsen-Anhalt and Hamburg; address only in Hessen
 * and Brandenburg. Since cascade v10 (14 November 2026): Mecklenburg-
 * Vorpommern (land use too) and Schleswig-Holstein (address only) in UTM
 * (`utmZone`), Baden-Württemberg from separate layers
 * (bw-parcel-attributes.ts). Berlin and Bremen publish neither field.
 */
export const ALKIS_ENDPOINTS: Record<string, AlkisEndpoint> = {
  NRW: {
    url: "https://www.wfs.nrw.de/geobasis/wfs_nw_alkis_vereinfacht",
    typeName: "ave:Flurstueck",
    landUseSections: true,
    crs: 4326,
  },
  Sachsen: {
    url: "https://geodienste.sachsen.de/aaa/public_alkis/vereinf/wfs",
    typeName: "ave:Flurstueck",
    landUseSections: true,
    crs: 4258,
    fallback: {
      url: "https://geodienste.sachsen.de/aaa/public_inspire/alkis/cp/dls/wfs",
      typeName: "cp:CadastralParcel",
      crs: 4258,
    },
  },
  Niedersachsen: {
    url: "https://opendata.lgln.niedersachsen.de/doorman/noauth/alkis_wfs_einfach",
    typeName: "ave:Flurstueck",
    landUseSections: true,
    crs: 4258,
    fallback: {
      url: "https://www.inspire.niedersachsen.de/doorman/noauth/alkis-dls-cp",
      typeName: "cp:CadastralParcel",
      crs: 4258,
    },
  },
  // The simplified product in SH rejects plain GetFeature on
  // ave:Flurstueck; its bbox stored query works, in EPSG:25832 only, and
  // returns addresses without land use (probed 14 November 2026).
  "Schleswig-Holstein": {
    url: "https://service.gdi-sh.de/WFS_SH_ALKIS_vereinf_OpenGBD",
    typeName: "ave:Flurstueck",
    crs: 25832,
    utmZone: 32,
    storedQuery:
      "http://repository.gdi-de.org/query/adv/produkt/alkis-vereinfacht/2.0/ave-by-bbox",
    featureElement: "Flurstueck",
    fallback: {
      url: "https://service.gdi-sh.de/SH_INSPIREDOWNLOAD_AI_CP_ALKIS",
      typeName: "cp:CadastralParcel",
      crs: 4258,
    },
  },
  "Sachsen-Anhalt": {
    url: "https://www.geodatenportal.sachsen-anhalt.de/wss/service/ST_LVermGeo_ALKIS_WFS_OpenData/guest",
    typeName: "ave:Flurstueck",
    crs: 4258,
    fallback: {
      url: "https://geodatenportal.sachsen-anhalt.de/ows_INSPIRE_LVermGeo_ALKIS_CP_WFS",
      typeName: "cp:CadastralParcel",
      crs: 4258,
    },
  },
  Brandenburg: {
    url: "https://isk.geobasis-bb.de/ows/alkis_vereinf_wfs",
    typeName: "ave:Flurstueck",
    landUseSections: true,
    crs: 4258,
    fallback: {
      url: "https://inspire.brandenburg.de/services/cp_alkis_wfs",
      typeName: "cp:CadastralParcel",
      crs: 4258,
    },
  },
  Berlin: {
    url: "https://gdi.berlin.de/services/wfs/alkis_flurstuecke",
    typeName: "alkis_flurstuecke:flurstuecke",
    crs: 4326,
  },
  Hessen: {
    url: "https://www.gds.hessen.de/wfs2/aaa-suite/cgi-bin/alkis/vereinf/wfs",
    typeName: "ave:Flurstueck",
    landUseSections: true,
    crs: 4258,
    fallback: {
      url: "https://inspire-hessen.de/ows/services/org.2.07247d95-adc7-4c7d-9c7a-ed17af855317_wfs",
      typeName: "cp:CadastralParcel",
      crs: 4258,
    },
  },
  // Its default response CRS is a projected EPSG:25832 (UTM 32N), which this
  // module does not transform — but EPSG:4258 is offered as an alternate and
  // the service honours `srsName`, so requesting that directly needs no
  // projection math here at all.
  "Baden-Württemberg": {
    url: "https://owsproxy.lgl-bw.de/owsproxy/wfs/WFS_INSP_BW_Flst_ALKIS",
    typeName: "cp:CadastralParcel",
    crs: 4258,
  },
  // Saarland moved its INSPIRE parcel service; under the new name it
  // answers with parcels (geometry only, numberReturned="0" like Hessen).
  // Probed 14 November 2026.
  Saarland: {
    url: "https://geoportal.saarland.de/gdi-sl/inspirewfs_Flurstuecke_Grundstuecke_ALKIS",
    typeName: "cp:CadastralParcel",
    crs: 4258,
  },
  // Added November 2026 after probing GetCapabilities and a live GetFeature
  // (docs/boundary-model.md, "Cadastre coverage"). Bayern (login required)
  // is read from the parcel map instead (bavaria-parcels.service.ts).
  Hamburg: {
    url: "https://geodienste.hamburg.de/WFS_HH_ALKIS_vereinfacht",
    typeName: "ave:Flurstueck",
    landUseSections: true,
    crs: 4258,
    fallback: {
      url: "https://geodienste.hamburg.de/HH_WFS_INSPIRE_Flurstuecke",
      typeName: "cp:CadastralParcel",
      crs: 4258,
    },
  },
  Bremen: {
    url: "https://opendata.lgln.niedersachsen.de/doorman/noauth/alkishb_wfs_sf",
    typeName: "adv:AX_Flurstueck",
    crs: 4258,
  },
  // EPSG:25833 only; address and land use (probed 14 November 2026).
  "Mecklenburg-Vorpommern": {
    url: "https://www.geodaten-mv.de/dienste/alkis_wfs_einfach",
    typeName: "ave:Flurstueck",
    landUseSections: true,
    crs: 25833,
    utmZone: 33,
    fallback: {
      url: "https://www.geodaten-mv.de/dienste/inspire_cp_alkis_download",
      typeName: "cp:CadastralParcel",
      crs: 4258,
    },
  },
  Thüringen: {
    url: "https://www.geoproxy.geoportal-th.de/geoproxy/services/adv_alkis_wfs",
    typeName: "ave:Flurstueck",
    crs: 4326,
    bboxUtm32: true,
  },
  "Rheinland-Pfalz": {
    url: "https://geo5.service24.rlp.de/wfs/alkis_rp.fcgi",
    typeName: "ave:Flurstueck",
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
  // City-states first: their boxes lie inside their neighbours' boxes.
  {
    state: "Hamburg",
    minLat: 53.39,
    maxLat: 53.75,
    minLon: 9.73,
    maxLon: 10.33,
  },
  // Bremen city and Bremerhaven.
  { state: "Bremen", minLat: 53.01, maxLat: 53.23, minLon: 8.48, maxLon: 8.99 },
  { state: "Bremen", minLat: 53.46, maxLat: 53.61, minLon: 8.48, maxLon: 8.65 },
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
  {
    state: "Hessen",
    minLat: 49.39,
    maxLat: 51.66,
    minLon: 7.77,
    maxLon: 10.24,
  },
  {
    state: "Baden-Württemberg",
    minLat: 47.53,
    maxLat: 49.79,
    minLon: 7.51,
    maxLon: 10.5,
  },
  {
    state: "Mecklenburg-Vorpommern",
    minLat: 53.11,
    maxLat: 54.69,
    minLon: 10.59,
    maxLon: 14.41,
  },
  {
    state: "Thüringen",
    minLat: 50.2,
    maxLat: 51.65,
    minLon: 9.87,
    maxLon: 12.65,
  },
  // Inside the Rheinland-Pfalz box, so before it.
  {
    state: "Saarland",
    minLat: 49.11,
    maxLat: 49.64,
    minLon: 6.35,
    maxLon: 7.41,
  },
  {
    state: "Rheinland-Pfalz",
    minLat: 48.97,
    maxLat: 50.94,
    minLon: 6.11,
    maxLon: 8.51,
  },
];

/** Candidate states for a coordinate, smallest (enclaves) first — bboxes deliberately overlap. */
export function statesForPoint(lat: number, lon: number): string[] {
  return STATE_BBOXES.filter(
    (b) =>
      lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon,
  ).map((b) => b.state);
}

// --- Circuit breaker (in-memory, per state) --------------------------
// Prevents a permanently unreachable state service from delaying every
// analysis. A valid empty result (service reachable, no parcel at this
// location) does NOT count as a failure — see boundary/circuit-breaker.ts.
