import type { TFunction } from "i18next";
import { tileBboxEpsg3857 } from "@shared/imagery-sources";
import { type Basemap } from "@renderer/store/mapStore";

/** Tile URLs per basemap type. */
export const TILE_URLS: Record<Basemap, string> = {
  satellite:
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  // basemap.de Web Raster (BKG/AdV): the official German topographic map,
  // built from ALKIS buildings, so it lines up with the parcel overlay.
  // Germany only; elsewhere the tiles are empty.
  official:
    "https://sgx.geodatenzentrum.de/wmts_basemapde/tile/1.0.0/de_basemapde_web_raster_farbe/default/GLOBAL_WEBMERCATOR/{z}/{y}/{x}.png",
  streets: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  terrain: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
};

/** Tile attributions per basemap type, translated. */
export function tileAttributions(t: TFunction): Record<Basemap, string> {
  const osm = t("map.page.attributionOsm");
  return {
    satellite: "&copy; Esri World Imagery",
    official: `&copy; GeoBasis-DE / BKG (${new Date().getFullYear()}) CC BY 4.0`,
    streets: `&copy; ${osm}`,
    terrain: `&copy; ${osm}, SRTM; &copy; OpenTopoMap`,
  };
}

/**
 * Leaflet fills template keys from layer options and calls function values
 * with the tile coords — this resolves the `{bbox-epsg-3857}` placeholder of
 * WMS templates (state orthophotos, custom WMS) per tile. `{time}` of a
 * custom template is left empty, as the main process does for a capture of
 * the current image; Leaflet throws on a placeholder without a value.
 */
export const TILE_TEMPLATE_OPTIONS = {
  "bbox-epsg-3857": (d: { x: number; y: number; z: number }) =>
    tileBboxEpsg3857(d.z, d.x, d.y).join(","),
  time: "",
};

/** Max zoom of the base TileLayer; imagery metadata is resolved at the level actually drawn. */
export const BASEMAP_MAX_ZOOM = 19;

/**
 * A selected site this close to the map centre counts as "in view", and the
 * map keeps showing the image its vehicles were counted on. About one and a
 * half viewports: at half a viewport, an ordinary pan around the site switched
 * the basemap back and forth between the counted and the automatic image.
 */
export const SITE_IN_VIEW_PX = 1500;

/** Ground size of one screen pixel in Web Mercator at the given latitude and zoom. */
export function metersPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}
