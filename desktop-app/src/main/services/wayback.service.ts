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

// The app-wide User-Agent is set by http.service.
const HEADERS = {};

/** Versions shown per location; older ones are reported as `truncated`. */
export const WAYBACK_TIMELINE_LIMIT = 8;
/**
 * How long a quick timeline waits for capture metadata before it returns
 * the versions without it. Long enough for cached and fast answers.
 */
export const WAYBACK_QUICK_METADATA_MS = 1_500;
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

/**
 * Metadata lookups under way. The quick timeline returns before they
 * finish; the full one that follows waits for the same requests instead of
 * sending them again.
 */
const metadataLookups = new Map<string, Promise<ImageryMetadata>>();

/** Capture metadata of the image a version shows; never throws. */
function waybackMetadata(
  release: WaybackRelease,
  lat: number,
  lon: number,
  zoom: number,
): Promise<ImageryMetadata> {
  const metadataUrl = release.metadataLayerUrl;
  if (!metadataUrl) return Promise.resolve(emptyImageryMetadata("esri", zoom));
  const layerId = waybackMetadataLayerForZoom(zoom);
  // ~100 m buckets like the live metadata lookup (imagery-metadata.service).
  const key = `imagery-meta:v1:wayback:${release.release}:${zoom}:${lat.toFixed(3)},${lon.toFixed(3)}`;
  const running = metadataLookups.get(key);
  if (running) return running;
  const lookup = cached(key, TTL.waybackArchive, async () => {
    const res = await fetchWithResilience(
      buildMetadataIdentifyUrl(metadataUrl, layerId, lat, lon),
      { headers: HEADERS },
    );
    if (!res.ok) throw new Error(`Wayback metadata ${res.status}`);
    return parseEsriIdentify(await res.json(), zoom, layerId);
  })
    .catch(() => emptyImageryMetadata("esri", zoom))
    .finally(() => metadataLookups.delete(key));
  metadataLookups.set(key, lookup);
  return lookup;
}

/** Each result that arrives within `ms`; `null` for those still running. */
function settledWithin<T>(
  lookups: Promise<T>[],
  ms: number,
): Promise<(T | null)[]> {
  const timeUp = new Promise<null>((resolve) => {
    setTimeout(resolve, ms, null);
  });
  return Promise.all(lookups.map((lookup) => Promise.race([lookup, timeUp])));
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
): Promise<{
  holders: WaybackRelease[];
  hasTile: boolean;
  truncated: boolean;
  /** Index of the first release the walk did not reach (end: all done). */
  stoppedAt: number;
}> {
  const indexOf = new Map(releases.map((r, i) => [r.release, i]));
  const x = lon2tile(lon, zoom);
  const y = lat2tile(lat, zoom);
  const holders: WaybackRelease[] = [];
  let hasTile = false;
  let i = 0;
  for (let step = 0; i < releases.length; step++) {
    if (holders.length >= limit || step >= MAX_TILEMAP_STEPS) {
      return { holders, hasTile, truncated: true, stoppedAt: i };
    }
    const map = await tilemapAt(releases[i].release, zoom, y, x);
    // Older versions do not gain imagery the newer ones lack at this zoom.
    if (!map.hasTile)
      return { holders, hasTile, truncated: false, stoppedAt: i };
    hasTile = true;
    const holderIndex = indexOf.get(map.release ?? releases[i].release);
    // Holders are never newer than the version asked; anything else would loop.
    if (holderIndex == null || holderIndex < i) break;
    holders.push(releases[holderIndex]);
    i = holderIndex + 1;
  }
  return { holders, hasTile, truncated: false, stoppedAt: releases.length };
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
 *
 * With `metadataWithinMs`, the versions are returned once that time has
 * passed, whatever metadata has arrived by then: Esri's metadata service
 * at times takes half a minute per version, and the list of versions is of
 * use before their capture dates are. Versions still waiting are named in
 * `pendingIds`; their lookups go on and are shared with the next call.
 */
export async function waybackTimeline(
  lat: number,
  lon: number,
  zoom: number,
  limit = WAYBACK_TIMELINE_LIMIT,
  metadataWithinMs?: number,
): Promise<ImageryTimeline> {
  const releases = await getWaybackReleases();
  let z = Math.min(23, Math.max(0, Math.round(zoom)));
  let walk = await releasesWithLocalChanges(releases, lat, lon, z, limit);
  if (!walk.hasTile && z > 0) {
    z -= 1;
    walk = await releasesWithLocalChanges(releases, lat, lon, z, limit);
  }

  // Esri published z20 only from some year on: older versions still have
  // z19 imagery. Continue there instead of ending the timeline.
  const steps: Array<{ release: WaybackRelease; zoom: number }> =
    walk.holders.map((release) => ({ release, zoom: z }));
  let truncated = walk.truncated;
  if (
    walk.hasTile &&
    !walk.truncated &&
    walk.stoppedAt < releases.length &&
    z > 0 &&
    steps.length < limit
  ) {
    const older = await releasesWithLocalChanges(
      releases.slice(walk.stoppedAt),
      lat,
      lon,
      z - 1,
      limit - steps.length,
    );
    for (const release of older.holders) steps.push({ release, zoom: z - 1 });
    truncated = older.truncated;
  }

  const lookups = steps.map((s) =>
    waybackMetadata(s.release, lat, lon, s.zoom),
  );
  const metas =
    metadataWithinMs == null
      ? await Promise.all(lookups)
      : await settledWithin(lookups, metadataWithinMs);
  // A re-published version can show the very same scene; keep the newest.
  const seen = new Set<string>();
  const candidates: ImageryCandidate[] = [];
  const pendingIds: string[] = [];
  steps.forEach(({ release, zoom: stepZoom }, i) => {
    const meta = metas[i];
    const sceneKey = meta?.capturedAt
      ? `${meta.capturedAt}|${meta.collection ?? ""}|${meta.resolutionM ?? ""}`
      : `release:${release.release}`;
    if (seen.has(sceneKey)) return;
    seen.add(sceneKey);
    const candidate = waybackCandidate(
      release,
      meta ?? emptyImageryMetadata("esri", stepZoom),
      stepZoom,
    );
    candidates.push(candidate);
    if (!meta) pendingIds.push(candidate.id);
  });
  return {
    candidates,
    zoom: z,
    truncated,
    ...(pendingIds.length > 0 ? { pendingIds } : {}),
  };
}
