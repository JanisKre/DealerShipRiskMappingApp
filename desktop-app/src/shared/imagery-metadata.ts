import { z } from "zod";

/**
 * Acquisition metadata for the aerial/satellite image shown at a location.
 *
 * Esri World Imagery is a mosaic of many sources (Maxar/Vantor satellite
 * scenes, state orthophotos, ...) whose capture dates differ by location AND
 * by zoom level: the same parking lot can be a 2025 satellite scene at z19
 * and a 2019 state orthophoto at z20. An underwriter counting vehicles needs
 * to know which one they are looking at, so the date is always resolved for
 * a concrete point and zoom.
 */
export const ImageryMetadataSchema = z.object({
  provider: z.enum(["esri", "wms"]),
  /** Zoom level the metadata was resolved for. */
  zoom: z.number().int(),
  /** False when the provider exposes no metadata (custom WMS) or the lookup failed. */
  available: z.boolean(),
  /** Capture date as ISO `YYYY-MM-DD`; null when the source does not publish one. */
  capturedAt: z.string().nullable(),
  /** Data owner/vendor, e.g. "Vantor" or "© GeoBasis-DE/LGB". */
  source: z.string().nullable(),
  /** Product/collection name, e.g. "Vivid Advanced" or "Brandenburg2019". */
  collection: z.string().nullable(),
  /** Sensor code or source description, e.g. "WV02" or "Land Brandenburg". */
  description: z.string().nullable(),
  /** Native ground resolution of the source in metres. */
  resolutionM: z.number().nullable(),
  /** Resolution the source is resampled to in the mosaic, in metres. */
  mosaicResolutionM: z.number().nullable(),
  /** Horizontal positional accuracy of the source in metres. */
  accuracyM: z.number().nullable(),
  /** Zoom range in which this source is drawn. */
  minZoom: z.number().int().nullable(),
  maxZoom: z.number().int().nullable(),
  /** Esri basemap release that published the source, e.g. "Raster Basemaps 2025.R11". */
  release: z.string().nullable(),
});
export type ImageryMetadata = z.infer<typeof ImageryMetadataSchema>;

const ESRI_IDENTIFY_URL =
  "https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/identify";

/**
 * World Imagery publishes one metadata layer per zoom level: layer 5 is the
 * 1.9 cm level (z23) down to layer 18 for z≤10 ("150m Resolution Metadata").
 * Querying the matching layer returns exactly the source drawn at that zoom.
 */
export function esriMetadataLayerForZoom(zoom: number): number {
  return Math.min(18, Math.max(5, 28 - Math.round(zoom)));
}

export function buildEsriIdentifyUrl(
  lat: number,
  lon: number,
  zoom: number,
): string {
  // identify needs a map extent/display even for a point query; a tiny
  // extent around the point keeps the result independent of the viewport.
  const d = 0.0005;
  const params = new URLSearchParams({
    geometry: `${lon},${lat}`,
    geometryType: "esriGeometryPoint",
    sr: "4326",
    layers: `all:${esriMetadataLayerForZoom(zoom)}`,
    tolerance: "0",
    mapExtent: `${lon - d},${lat - d},${lon + d},${lat + d}`,
    imageDisplay: "256,256,96",
    returnGeometry: "false",
    f: "json",
  });
  return `${ESRI_IDENTIFY_URL}?${params.toString()}`;
}

/** Converts Esri's `YYYYMMDD` (with "Null" for unknown) to ISO `YYYY-MM-DD`. */
export function parseEsriDate(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(String(value).trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${y}-${m}-${d}`;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.toLowerCase() !== "null" ? text.slice(0, 120) : null;
}

function cleanNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function cleanZoom(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 25 ? n : null;
}

/** Metadata record for a source that publishes nothing (custom WMS, failed lookup). */
export function emptyImageryMetadata(
  provider: ImageryMetadata["provider"],
  zoom: number,
): ImageryMetadata {
  return {
    provider,
    zoom,
    available: false,
    capturedAt: null,
    source: null,
    collection: null,
    description: null,
    resolutionM: null,
    mosaicResolutionM: null,
    accuracyM: null,
    minZoom: null,
    maxZoom: null,
    release: null,
  };
}

/** Normalizes an Esri identify response; unknown shapes yield `available: false`. */
export function parseEsriIdentify(
  json: unknown,
  zoom: number,
): ImageryMetadata {
  const empty = emptyImageryMetadata("esri", zoom);
  const results = (json as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return empty;

  const layerId = esriMetadataLayerForZoom(zoom);
  const hit = results.find(
    (r): r is { attributes: Record<string, unknown> } =>
      typeof r === "object" &&
      r !== null &&
      (r as { layerId?: unknown }).layerId === layerId &&
      typeof (r as { attributes?: unknown }).attributes === "object",
  );
  if (!hit) return empty;

  const a = hit.attributes;
  return {
    provider: "esri",
    zoom,
    available: true,
    capturedAt: parseEsriDate(a.SRC_DATE),
    source: cleanText(a.NICE_DESC),
    collection: cleanText(a.NICE_NAME),
    description: cleanText(a.SRC_DESC),
    resolutionM: cleanNumber(a.SRC_RES),
    mosaicResolutionM: cleanNumber(a.SAMP_RES),
    accuracyM: cleanNumber(a.SRC_ACC),
    minZoom: cleanZoom(a.MinMapLevel),
    maxZoom: cleanZoom(a.MaxMapLevel),
    release: cleanText(a.ReleaseName),
  };
}

/** Vendor sensor codes used in Esri's SRC_DESC field. */
const SATELLITE_SENSORS: Record<string, string> = {
  WV01: "WorldView-1",
  WV02: "WorldView-2",
  WV03: "WorldView-3",
  WV04: "WorldView-4",
  GE01: "GeoEye-1",
  QB02: "QuickBird-2",
};

/** Full satellite name for a known sensor code, otherwise null (e.g. aerial descriptions). */
export function satelliteSensorName(description: string | null): string | null {
  if (!description) return null;
  return SATELLITE_SENSORS[description.trim().toUpperCase()] ?? null;
}

/** Whole years between a capture date and `now` (floored, never negative). */
export function imageryAgeYears(
  capturedAt: string,
  now: Date = new Date(),
): number {
  const captured = new Date(`${capturedAt}T00:00:00Z`);
  if (Number.isNaN(captured.getTime())) return 0;
  const years =
    (now.getTime() - captured.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  return Math.max(0, Math.floor(years));
}

/**
 * Beyond this age the legend flags the image as outdated. Dealership stock
 * turns over within months, so anything older than this is no longer a
 * reasonable basis for a vehicle count without an on-site check.
 */
export const IMAGERY_STALE_AFTER_YEARS = 2;
