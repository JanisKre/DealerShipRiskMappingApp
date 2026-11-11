import type { DetectionResult } from "@shared/types";
import {
  fetchOfficialBuildings,
  type OfficialBuildingLookup,
} from "../alkis-buildings.service";
import { osmEvidenceBy } from "../boundary/osm-evidence.service";
import {
  excludeRoofDetections,
  officialRoofRings,
  roofRings,
  ROOF_INSET_M,
} from "./roof-mask";

const NO_BUILDINGS: OfficialBuildingLookup = {
  buildings: [],
  state: null,
  truncated: false,
};

/** The official footprints, or none if they have not arrived by `deadline`. */
async function officialBuildingsBy(
  lat: number,
  lon: number,
  deadline: number,
): Promise<OfficialBuildingLookup> {
  const request = fetchOfficialBuildings(lat, lon).catch(() => NO_BUILDINGS);
  if (!Number.isFinite(deadline)) return request;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<OfficialBuildingLookup>((resolve) => {
    timer = setTimeout(
      () => resolve(NO_BUILDINGS),
      Math.max(0, deadline - Date.now()),
    );
  });
  try {
    // A cached answer settles in a microtask and wins even a past deadline.
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Applies the roof mask with the site's OSM buildings and, where the state
 * publishes them, the official ALKIS footprints. OSM joins the one evidence
 * request the boundary step also uses; both sources are asked in parallel
 * and each is skipped if it has not answered by `osmDeadline` (epoch ms).
 * Without any footprints the detection passes through unchanged.
 */
export async function maskRoofDetections(
  detection: DetectionResult,
  lat: number,
  lon: number,
  osmDeadline: number = Infinity,
): Promise<DetectionResult> {
  const [{ evidence }, official] = await Promise.all([
    osmEvidenceBy(lat, lon, osmDeadline),
    officialBuildingsBy(lat, lon, osmDeadline),
  ]);
  const osm = roofRings(evidence);
  const cadastre = officialRoofRings(official.buildings, evidence);
  const sources = [
    ...(osm.length > 0 ? ["OSM buildings"] : []),
    ...(cadastre.length > 0 ? [`ALKIS buildings ${official.state}`] : []),
  ];
  return excludeRoofDetections(
    detection,
    [...osm, ...cadastre],
    ROOF_INSET_M,
    sources.join(" + ") || "OSM buildings",
  );
}
