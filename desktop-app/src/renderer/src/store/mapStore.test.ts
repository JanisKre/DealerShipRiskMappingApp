import { describe, expect, it } from "vitest";
import {
  countActiveLayers,
  mergePersistedMapState,
  useMapStore,
  type MapLayers,
} from "./mapStore";

const current = (): ReturnType<typeof useMapStore.getState> =>
  useMapStore.getState();

describe("mergePersistedMapState", () => {
  it("keeps the defaults when nothing was saved", () => {
    expect(mergePersistedMapState(undefined, current())).toBe(current());
  });

  it.each(["light", "dark", "unknown"])(
    "moves a removed basemap (%s) to streets",
    (basemap) => {
      expect(mergePersistedMapState({ basemap }, current()).basemap).toBe(
        "streets",
      );
    },
  );

  it.each(["satellite", "official", "streets", "terrain"] as const)(
    "keeps the saved basemap %s",
    (basemap) => {
      expect(mergePersistedMapState({ basemap }, current()).basemap).toBe(
        basemap,
      );
    },
  );

  it("adds layers that did not exist when the state was saved", () => {
    const saved = {
      layers: {
        satellite: true,
        boundaries: false,
        detections: true,
        nearbyInsured: false,
        accumulationClusters: false,
        hailZones: true,
      },
    };
    const merged = mergePersistedMapState(saved, current());
    expect(merged.layers.parcels).toBe(false);
    expect(merged.layers.boundaries).toBe(false);
    expect(merged.layers.hailZones).toBe(true);
  });

  it("restores other saved fields", () => {
    const merged = mergePersistedMapState({ satelliteOpacity: 0.4 }, current());
    expect(merged.satelliteOpacity).toBe(0.4);
    expect(merged.basemap).toBe(current().basemap);
  });
});

describe("countActiveLayers", () => {
  const layers: MapLayers = {
    satellite: true,
    boundaries: true,
    detections: true,
    nearbyInsured: false,
    accumulationClusters: false,
    hailZones: false,
    parcels: false,
  };

  it("does not count the hidden satellite flag as an active layer", () => {
    expect(countActiveLayers(layers)).toBe(2);
  });

  it("counts every panel toggle that is on", () => {
    expect(
      countActiveLayers({ ...layers, parcels: true, hailZones: true }),
    ).toBe(4);
  });

  it("counts only the given toggles", () => {
    expect(countActiveLayers({ ...layers, parcels: true }, ["parcels"])).toBe(
      1,
    );
  });
});
