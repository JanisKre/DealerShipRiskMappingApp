import type {
  BoundaryResult,
  DetectionResult,
  TemporalChangeResult,
} from "@shared/types";
import { wmsTemplateSupportsTime } from "@shared/constants";
import { detectBoundary } from "./boundary.service";
import { detectVehicles } from "./detection.service";
import { getSettings } from "./settings.service";
import { aerialImageForBoundary } from "./tiles.service";

/**
 * Temporal change detection: compares the vehicle detection of two points in time
 * over the same lot and returns the deltas (total + per class).
 *
 * Requires a date-capable tile source — Esri World Imagery has
 * no public history, so a WMS/WMTS template with a {time}
 * placeholder is needed (e.g. Sentinel-2 via Sentinel Hub WMS or a state
 * DOP service with a time dimension). Without such a provider the
 * function aborts with a clear message instead of comparing two
 * identical images (which would fake a delta of 0).
 */
export async function compareTemporal(
  lat: number,
  lon: number,
  fromDate: string,
  toDate: string,
  boundary?: BoundaryResult,
): Promise<TemporalChangeResult> {
  const settings = getSettings();
  const provider = settings.satelliteProvider ?? "esri";

  if (provider !== "wms" || !wmsTemplateSupportsTime(settings.wmsTileUrl)) {
    throw new Error(
      "Temporal change requires a date-capable tile source: in Settings, " +
        "select the 'WMS' provider and configure a template with a {time} placeholder " +
        "(e.g. Sentinel-2/DOP history).",
    );
  }

  // Ensure a boundary (for georeference clipping of the detection).
  const bound = boundary ?? (await detectBoundary(lat, lon));

  const [fromImg, toImg] = await Promise.all([
    aerialImageForBoundary(lat, lon, bound, undefined, fromDate),
    aerialImageForBoundary(lat, lon, bound, undefined, toDate),
  ]);
  const [from, to] = await Promise.all([
    detectVehicles(fromImg, bound),
    detectVehicles(toImg, bound),
  ]);

  const deltaCount = to.vehicleCount - from.vehicleCount;
  const deltaPct =
    from.vehicleCount > 0 ? deltaCount / from.vehicleCount : null;

  return {
    fromDate,
    toDate,
    fromCount: from.vehicleCount,
    toCount: to.vehicleCount,
    deltaCount,
    deltaPct,
    classDeltas: classDeltas(from, to),
    fromConfidence: from.confidence,
    toConfidence: to.confidence,
    provider,
  };
}

/** Difference per vehicle class (to − from), 0 if one side has no count. */
function classDeltas(
  from: DetectionResult,
  to: DetectionResult,
): TemporalChangeResult["classDeltas"] {
  const f = from.classCounts ?? { car: 0, van: 0, truck: 0, bus: 0 };
  const t = to.classCounts ?? { car: 0, van: 0, truck: 0, bus: 0 };
  return {
    car: t.car - f.car,
    van: t.van - f.van,
    truck: t.truck - f.truck,
    bus: t.bus - f.bus,
  };
}
