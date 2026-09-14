import type { RiskParameters } from "@shared/types";
import { fetchParcelsNear, PARCEL_SEARCH_RADIUS_M } from "../alkis.service";
import { fetchOsmEvidence } from "./osm-evidence.service";
import { fromNominatimPolygon } from "./nominatim-polygon";
import { OSM_EVIDENCE_RADIUS_M } from "./osm-overpass";
import type { FusionBundle } from "./fusion";
import type { LonLat } from "../boundary-geometry";

/**
 * Network-facing half of the fusion engine.
 *
 * Kept separate from `fusion.ts` so the fusion core stays pure — it never
 * imports the cache (which reaches the database, which reaches Electron), which
 * is what lets the benchmark replay it and the tests run it without mocks.
 *
 * Every source is optional. A source that cannot be reached is recorded as
 * unavailable rather than treated as evidence of absence: "there is no fence
 * here" and "we could not ask about fences" must not reduce to the same thing.
 */
export async function collectEvidence(
  lat: number,
  lon: number,
  context: { name?: string; address?: string; parameters: RiskParameters },
): Promise<FusionBundle> {
  const anchor: LonLat = [lon, lat];
  const radiusM = Math.max(
    OSM_EVIDENCE_RADIUS_M,
    Math.ceil((context.parameters.boundaryGridExtentM * Math.SQRT2) / 2),
  );

  const [osmResult, parcelResult, matchResult] = await Promise.allSettled([
    fetchOsmEvidence(lat, lon, radiusM),
    fetchParcelsNear(lat, lon, PARCEL_SEARCH_RADIUS_M),
    fromNominatimPolygon(lat, lon, context),
  ]);

  const osm =
    osmResult.status === "fulfilled" ? (osmResult.value ?? null) : null;
  const parcels =
    parcelResult.status === "fulfilled"
      ? parcelResult.value
      : { parcels: [], state: null, truncated: false, reachable: false };
  const match =
    matchResult.status === "fulfilled" ? matchResult.value : null;
  const matchedRing = match?.polygon.coordinates[0] as LonLat[] | undefined;

  return {
    anchor,
    name: context.name,
    address: context.address,
    osm,
    parcels: parcels.parcels,
    parcelsTruncated: parcels.truncated,
    ...(matchedRing ? { matchedRing } : {}),
    availability: {
      osm: osm != null,
      alkis: parcels.reachable,
      nominatim: match != null,
    },
  };
}
