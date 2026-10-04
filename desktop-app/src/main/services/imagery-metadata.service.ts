import {
  buildEsriIdentifyUrl,
  emptyImageryMetadata,
  parseEsriIdentify,
  type ImageryMetadata,
} from "@shared/imagery-metadata";
import { cached, TTL } from "./cache.service";
import { fetchWithResilience } from "./http.service";

/**
 * Resolves when/where the Esri World Imagery image at a point and zoom was
 * captured, via Esri's per-zoom metadata layers. Never throws: a metadata
 * outage yields `available: false` so callers can fall back gracefully.
 */
export async function getEsriImageryMetadata(
  lat: number,
  lon: number,
  zoom: number,
): Promise<ImageryMetadata> {
  // ~100 m buckets: source footprints are km-sized, and panning the map by a
  // few metres should not trigger a new request.
  // v2: records gained sensor, accuracy, zoom range and release fields.
  const key = `imagery-meta:v2:esri:${zoom}:${lat.toFixed(3)},${lon.toFixed(3)}`;
  try {
    return await cached(key, TTL.imageryMetadata, async () => {
      const res = await fetchWithResilience(
        buildEsriIdentifyUrl(lat, lon, zoom),
        { headers: { "User-Agent": "DealershipRiskMapping/1.0 (desktop)" } },
      );
      if (!res.ok) throw new Error(`Esri imagery metadata ${res.status}`);
      return parseEsriIdentify(await res.json(), zoom);
    });
  } catch {
    return emptyImageryMetadata("esri", zoom);
  }
}
