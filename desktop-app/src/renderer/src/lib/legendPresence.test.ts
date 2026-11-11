import { describe, expect, it } from "vitest";
import type { AnalyzedDealership } from "@shared/types";
import { legendPresence } from "./legendPresence";

function site(
  id: string,
  lat: number,
  lon: number,
  extra: Partial<AnalyzedDealership> = {},
): AnalyzedDealership {
  return { id, name: id, lat, lon, ...extra } as AnalyzedDealership;
}

const dresden = site("dresden", 51.03, 13.78, {
  insured: true,
  hailZone: 2,
  boundary: { source: "alkis" },
  detection: { boxes: [{}] },
} as unknown as Partial<AnalyzedDealership>);
const mannheim = site("mannheim", 49.45, 8.52, {
  hailZone: 4,
  boundary: { source: "manual" },
} as unknown as Partial<AnalyzedDealership>);

const allLayers = { hailZones: false, boundaries: true, detections: true };
const aroundDresden = { south: 51, west: 13.7, north: 51.1, east: 13.9 };

describe("legendPresence", () => {
  it("lists only what the locations in view use", () => {
    const presence = legendPresence([dresden, mannheim], {
      bounds: aroundDresden,
      zoom: 16,
      selectedId: null,
      layers: allLayers,
    });
    expect(presence).toEqual({
      hailZones: [2],
      business: ["existing"],
      boundarySources: ["alkis"],
      vehicles: true,
    });
  });

  it("lists everything once all locations are in view", () => {
    const presence = legendPresence([dresden, mannheim], {
      bounds: { south: 47, west: 5, north: 55, east: 15 },
      zoom: 6,
      selectedId: null,
      layers: allLayers,
    });
    expect(presence.hailZones.sort()).toEqual([2, 4]);
    expect(presence.business.sort()).toEqual(["existing", "new"]);
    expect(presence.boundarySources.sort()).toEqual(["alkis", "manual"]);
    // Zoomed out, vehicle dots are drawn only for the selected location.
    expect(presence.vehicles).toBe(false);
  });

  it("follows the layers that are switched on", () => {
    const presence = legendPresence([dresden], {
      bounds: aroundDresden,
      zoom: 10,
      selectedId: "dresden",
      layers: { hailZones: true, boundaries: false, detections: true },
    });
    expect(presence.hailZones).toEqual([1, 2, 3, 4, 5, 6]);
    expect(presence.boundarySources).toEqual([]);
    expect(presence.vehicles).toBe(true);
  });

  it("counts every location before the map reported its area", () => {
    const presence = legendPresence([dresden, mannheim], {
      bounds: null,
      zoom: 0,
      selectedId: null,
      layers: allLayers,
    });
    expect(presence.business.sort()).toEqual(["existing", "new"]);
  });
});
