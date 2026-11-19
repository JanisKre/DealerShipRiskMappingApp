/**
 * Cascade v15: the land-use sections of the simplified ALKIS product cut
 * open land off a parcel along the cadastre's own lines, and fill in land
 * use where the parcel carries none (Hessen, Brandenburg).
 */
import { describe, expect, it } from "vitest";
import { ringAreaSqm, type LonLat } from "./boundary-geometry";
import type { ParcelFeature } from "./alkis.service";
import { splitParcelsByLandUse, type LandUseSection } from "./parcel-sections";

const LAT = 52;
const M_LAT = 1 / 111_320;
const M_LON = 1 / (111_320 * Math.cos((LAT * Math.PI) / 180));

/** A ring from points in metres east and north of the origin. */
function poly(points: Array<[number, number]>): LonLat[] {
  return points.map(([x, y]) => [13 + x * M_LON, LAT + y * M_LAT]);
}

/** Rectangle from (x0, y0) to (x1, y1) metres east and north of the origin. */
function rect(x0: number, y0: number, x1: number, y1: number): LonLat[] {
  return poly([
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
  ]);
}

function parcel(
  ring: LonLat[],
  extra: Partial<ParcelFeature> = {},
): ParcelFeature {
  return { ring, areaSqm: ringAreaSqm(ring), state: "NRW", ...extra };
}

/** A 60 × 40 m plot: yard in the south 25 m, meadow in the north 15 m. */
const plot = parcel(rect(0, 0, 60, 40), {
  address: "Musterstraße 1",
  landUse: { commercial: 0.625, open: 0.375 },
});
const yard: LandUseSection = { ring: rect(0, 0, 60, 25), use: "commercial" };
const meadow: LandUseSection = { ring: rect(0, 25, 60, 40), use: "open" };

describe("splitParcelsByLandUse", () => {
  it("cuts the meadow off the yard along the section line", () => {
    const { parcels, cut } = splitParcelsByLandUse([plot], [yard, meadow]);
    expect(cut).toBe(1);
    expect(parcels).toHaveLength(2);
    const [rest, open] = parcels;
    expect(rest.areaSqm).toBeCloseTo(1500, -1);
    expect(rest.address).toBe("Musterstraße 1");
    expect(rest.landUse).toEqual({ commercial: 1 });
    expect(open.areaSqm).toBeCloseTo(900, -1);
    // The meadow is open land without the dealership's address.
    expect(open.address).toBeUndefined();
    expect(open.landUse).toEqual({ open: 1 });
  });

  it("joins adjacent open sections into one patch", () => {
    const wood: LandUseSection = { ring: rect(0, 25, 30, 40), use: "open" };
    const field: LandUseSection = { ring: rect(30, 25, 60, 40), use: "open" };
    const { parcels } = splitParcelsByLandUse([plot], [yard, wood, field]);
    expect(parcels).toHaveLength(2);
    expect(parcels[1].areaSqm).toBeCloseTo(900, -1);
  });

  it("leaves a lawn under 100 m² with its parcel", () => {
    const lawn: LandUseSection = { ring: rect(0, 38, 40, 40), use: "open" };
    // The L-shaped rest around the 80 m² lawn in the north-west corner.
    const rest: LandUseSection = {
      ring: poly([
        [0, 0],
        [60, 0],
        [60, 40],
        [40, 40],
        [40, 38],
        [0, 38],
        [0, 0],
      ]),
      use: "commercial",
    };
    const { parcels, cut } = splitParcelsByLandUse([plot], [rest, lawn]);
    expect(cut).toBe(0);
    expect(parcels).toEqual([plot]);
  });

  it("keeps a parcel whole when its sections do not add up to it", () => {
    // The meadow section is missing (capped answer): 1,500 of 2,400 m².
    const { parcels, cut, filled } = splitParcelsByLandUse([plot], [yard]);
    expect(cut).toBe(0);
    expect(filled).toBe(0);
    expect(parcels).toEqual([plot]);
  });

  it("keeps a parcel whole when the meadow is enclosed by the yard", () => {
    const pond: LandUseSection = { ring: rect(20, 10, 40, 30), use: "open" };
    const around: LandUseSection[] = [
      { ring: rect(0, 0, 60, 10), use: "commercial" },
      { ring: rect(0, 30, 60, 40), use: "commercial" },
      { ring: rect(0, 10, 20, 30), use: "commercial" },
      { ring: rect(40, 10, 60, 30), use: "commercial" },
    ];
    const { parcels, cut } = splitParcelsByLandUse([plot], [pond, ...around]);
    expect(cut).toBe(0);
    expect(parcels).toHaveLength(1);
  });

  it("fills in land use where the parcel has none (Hessen, Brandenburg)", () => {
    const bare = parcel(rect(0, 0, 60, 40), { state: "Hessen" });
    const filledOnly = splitParcelsByLandUse([bare], [yard, meadow], {
      cut: false,
    });
    expect(filledOnly.filled).toBe(1);
    expect(filledOnly.cut).toBe(0);
    expect(filledOnly.parcels).toHaveLength(1);
    expect(filledOnly.parcels[0].landUse?.commercial).toBeCloseTo(0.625, 2);
    expect(filledOnly.parcels[0].landUse?.open).toBeCloseTo(0.375, 2);

    const both = splitParcelsByLandUse([bare], [yard, meadow]);
    expect(both.filled).toBe(1);
    expect(both.cut).toBe(1);
  });

  it("assigns sections to the parcel they lie in", () => {
    const neighbour = parcel(rect(60, 0, 100, 40), {
      landUse: { residential: 1 },
    });
    const house: LandUseSection = {
      ring: rect(60, 0, 100, 40),
      use: "residential",
    };
    const { parcels, cut } = splitParcelsByLandUse(
      [plot, neighbour],
      [house, yard, meadow],
    );
    expect(cut).toBe(1);
    expect(parcels).toHaveLength(3);
    expect(parcels[2]).toBe(neighbour);
  });

  it("passes parcels without sections through unchanged", () => {
    const { parcels } = splitParcelsByLandUse([plot], []);
    expect(parcels).toEqual([plot]);
    expect(parcels[0]).toBe(plot);
  });
});
