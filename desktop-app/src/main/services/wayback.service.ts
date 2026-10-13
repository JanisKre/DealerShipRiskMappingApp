import {
  buildMetadataIdentifyUrl,
  emptyImageryMetadata,
  parseEsriIdentify,
  type ImageryMetadata,
} from "@shared/imagery-metadata";
import {
  lat2tile,
  lon2tile,
  type ImageryCandidate,
} from "@shared/imagery-sources";
import {
  buildWaybackTilemapUrl,
  parseWaybackConfig,
  parseWaybackTilemap,
  WAYBACK_ATTRIBUTION,
  WAYBACK_CONFIG_URL,
  waybackMetadataLayerForZoom,
  type ImageryTimeline,
  type WaybackRelease,
} from "@shared/imagery-wayback";
import { cached, TTL } from "./cache.service";
import { fetchWithResilience } from "./http.service";

/**
 * Dated history of the Esri World Imagery basemap at a point (Wayback).
 * Only versions whose image actually changed there are listed: the tilemap
 * service names the release that holds the tile a version shows, and the
 * walk continues just below that release. Methodology: docs/imagery-sources.md.
 */

const HEADERS = { "User-Agent": "DealershipRiskMapping/1.0 (desktop)" };

/** Versions shown per location; older ones are reported as `truncated`. */
export const WAYBACK_TIMELINE_LIMIT = 8;
/** Upper bound on tilemap requests per lookup, independent of the data. */
const MAX_TILEMAP_STEPS = 24;

export async function getWaybackReleases(): Promise<WaybackRelease[]> {
  return cached("wayback:config:v1", TTL.waybackConfig, async () => {
    const res = await fetchWithResilience(WAYBACK_CONFIG_URL, {
      headers: HEADERS,
    });
    if (!res.ok) throw new Error(`Wayback config ${res.status}`);
    const releases = parseWaybackConfig(await res.json());
    if (releases.length === 0) throw new Error("Wayback config is empty");
    return releases;
  });
}

async function tilemapAt(
  release: number,
  z: number,
  y: number,
  x: number,
): Promise<{ hasTile: boolean; release: number | null }> {
  // A published version never changes, so its tilemap is safe to keep.
  return cached(
    `wayback:tilemap:v1:${release}:${z}/${y}/${x}`,
    TTL.waybackArchive,
    async () => {
      const res = await fetchWithResilience(
        buildWaybackTilemapUrl(release, z, y, x),
        { headers: HEADERS },
      );
      if (!res.ok) throw new Error(`Wayback tilemap ${res.status}`);
      return parseWaybackTilemap(await res.json());
    },
  );
}

/** Capture metadata of the image a version shows; never throws. */
async function waybackMetadata(
  release: WaybackRelease,
  lat: number,
  lon: number,
  zoom: number,
): Promise<ImageryMetadata> {
  const metadataUrl = release.metadataLayerUrl;
  if (!metadataUrl) return emptyImageryMetadata("esri", zoom);
  const layerId = waybackMetadataLayerForZoom(zoom);
  // ~100 m buckets like the live metadata lookup (imagery-metadata.service).
  const key = `imagery-meta:v1:wayback:${release.release}:${zoom}:${lat.toFixed(3)},${lon.toFixed(3)}`;
  try {
    return await cached(key, TTL.waybackArchive, async () => {
      const res = await fetchWithResilience(
        buildMetadataIdentifyUrl(metadataUrl, layerId, lat, lon),
        { headers: HEADERS },
      );
      if (!res.ok) throw new Error(`Wayback metadata ${res.status}`);
      return parseEsriIdentify(await res.json(), zoom, layerId);
    });
  } catch {
    return emptyImageryMetadata("esri", zoom);
  }
}

/**
 * Releases holding a distinct image of the tile at a point, newest first.
 * `hasTile` is false when even the newest version has no imagery at `zoom`.
 */
async function releasesWithLocalChanges(
  releases: WaybackRelease[],
  lat: number,
  lon: number,
  zoom: number,
  limit: number,
): Promise<{ holders: WaybackRelease[]; hasTile: boolean; truncated: boolean }> {
  const indexOf = new Map(releases.map((r, i) => [r.release, i]));
  const x = lon2tile(lon, zoom);
  const y = lat2tile(lat, zoom);
  const holders: WaybackRelease[] = [];
  let hasTile = false;
  let i = 0;
  for (let step = 0; i < releases.length; step++) {
    if (holders.length >= limit || step >= MAX_TILEMAP_STEPS) {
      return { holders, hasTile, truncated: true };
    }
    const map = await tilemapAt(releases[i].release, zoom, y, x);
    // Older versions do not gain imagery the newer ones lack at this zoom.
    if (!map.hasTile) break;
    hasTile = true;
    const holderIndex = indexOf.get(map.release ?? releases[i].release);
    // Holders are never newer than the version asked; anything else would loop.
    if (holderIndex == null || holderIndex < i) break;
    holders.push(releases[holderIndex]);
    i = holderIndex + 1;
  }
  return { holders, hasTile, truncated: false };
}

function waybackCandidate(
  release: WaybackRelease,
  meta: ImageryMetadata,
  zoom: number,
): ImageryCandidate {
  const name = `Esri Wayback ${release.publishedAt}`;
  return {
    id: `wayback:${release.release}:z${zoom}`,
    kind: "esri-wayback",
    label: meta.collection ? `${name} (${meta.collection})` : name,
    capturedAt: meta.capturedAt,
    dateSource: meta.capturedAt ? "esri-wayback-metadata" : "none",
    resolutionM: meta.resolutionM,
    zoom,
    attribution: meta.source
      ? `${WAYBACK_ATTRIBUTION}, ${meta.source}`
      : WAYBACK_ATTRIBUTION,
    esri: meta,
    wayback: { release: release.release, publishedAt: release.publishedAt },
  };
}

/**
 * Distinct, dated World Imagery versions at a point. Where the newest
 * version has no imagery at `zoom` (Esri publishes z20 only in parts of
 * Germany), the lookup drops one zoom level once.
 */
export async function waybackTimeline(
  lat: number,
  lon: number,
  zoom: number,
  limit = WAYBACK_TIMELINE_LIMIT,
): Promise<ImageryTimeline> {
  const releases = await getWaybackReleases();
  let z = Math.min(23, Math.max(0, Math.round(zoom)));
  let walk = await releasesWithLocalChanges(releases, lat, lon, z, limit);
  if (!walk.hasTile && z > 0) {
    z -= 1;
    walk = await releasesWithLocalChanges(releases, lat, lon, z, limit);
  }

  const metas = await Promise.all(
    walk.holders.map((r) => waybackMetadata(r, lat, lon, z)),
  );
  // A re-published version can show the very same scene; keep the newest.
  const seen = new Set<string>();
  const candidates: ImageryCandidate[] = [];
  walk.holders.forEach((release, i) => {
    const meta = metas[i];
    const sceneKey = meta.capturedAt
      ? `${meta.capturedAt}|${meta.collection ?? ""}|${meta.resolutionM ?? ""}`
      : `release:${release.release}`;
    if (seen.has(sceneKey)) return;
    seen.add(sceneKey);
    candidates.push(waybackCandidate(release, meta, z));
  });
  return { candidates, zoom: z, truncated: walk.truncated };
}
