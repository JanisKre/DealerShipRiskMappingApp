import { describe, expect, it } from "vitest";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { polygon, point } from "@turf/helpers";
import type { AnalyzedDealership, HailstormScenario } from "@shared/types";
import { computeScenarioImpact, haversineKm } from "@shared/risk-math";
import { corridorRings } from "./scenarioCorridor";

/** A path through Hesse with a bend, as drawn on the map ([lon, lat]). */
const PATH: [number, number][] = [
  [8.4, 50.0],
  [8.9, 50.2],
  [9.1, 50.6],
];
const WIDTH_KM = 20;

function insideDrawn(lat: number, lon: number): boolean {
  return corridorRings(PATH, WIDTH_KM).some((ring) =>
    booleanPointInPolygon(
      point([lon, lat]),
      polygon([[...ring, ring[0]].map(([la, lo]) => [lo, la])]),
    ),
  );
}

function site(id: string, lat: number, lon: number): AnalyzedDealership {
  return { id, name: id, lat, lon } as AnalyzedDealership;
}

/** Point `km` to the left of the middle of segment `i` (local metric). */
function besideSegment(i: number, km: number): [number, number] {
  const [aLon, aLat] = PATH[i];
  const [bLon, bLat] = PATH[i + 1];
  const lat = (aLat + bLat) / 2;
  const lon = (aLon + bLon) / 2;
  const kmLat = 111.195;
  const kmLon = kmLat * Math.cos((lat * Math.PI) / 180);
  const dx = (bLon - aLon) * kmLon;
  const dy = (bLat - aLat) * kmLat;
  const len = Math.hypot(dx, dy);
  return [lat + ((dx / len) * km) / kmLat, lon + ((-dy / len) * km) / kmLon];
}

describe("corridorRings", () => {
  it("draws the buffer half the width away from the path, in km", () => {
    const [lat, lon] = corridorRings(PATH, WIDTH_KM)[0][0];
    expect(haversineKm(PATH[0][1], PATH[0][0], lat, lon)).toBeCloseTo(
      WIDTH_KM / 2,
      1,
    );
  });

  // Both segments: the mostly east-west first one and the mostly
  // north-south second one, which the old degree-space projection undercounted.
  it("covers exactly the sites the scenario counts as affected", () => {
    const sites: AnalyzedDealership[] = [];
    for (const i of [0, 1])
      for (const km of [-10.5, -9.5, 0, 9.5, 10.5]) {
        const [lat, lon] = besideSegment(i, km);
        sites.push(site(`s${i}:${km}`, lat, lon));
      }
    // Around the bend and past the ends: the round caps count as well.
    sites.push(site("cap-in", PATH[0][1] - 0.08, PATH[0][0]));
    sites.push(site("cap-out", PATH[0][1] - 0.1, PATH[0][0]));
    const scenario = {
      id: "s",
      name: "Test",
      pathCoordinates: PATH,
      widthKm: WIDTH_KM,
      intensityLevel: "HIGH",
    } as HailstormScenario;

    const counted = new Set(
      computeScenarioImpact(scenario, sites).affectedDealershipIds,
    );
    const drawn = new Set(
      sites.filter((d) => insideDrawn(d.lat, d.lon)).map((d) => d.id),
    );
    expect(drawn).toEqual(counted);
    expect(counted.has("s0:9.5")).toBe(true);
    expect(counted.has("s0:10.5")).toBe(false);
    expect(counted.has("s1:9.5")).toBe(true);
    expect(counted.has("s1:-9.5")).toBe(true);
    expect(counted.has("s1:10.5")).toBe(false);
    expect(counted.has("cap-in")).toBe(true);
    expect(counted.has("cap-out")).toBe(false);
  });

  it("gives every ring the same winding so a nonzero fill unions them", () => {
    const signs = corridorRings(PATH, WIDTH_KM).map((ring) => {
      let sum = 0;
      for (let i = 0; i < ring.length; i++) {
        const [la1, lo1] = ring[i];
        const [la2, lo2] = ring[(i + 1) % ring.length];
        sum += lo1 * la2 - lo2 * la1;
      }
      return Math.sign(sum);
    });
    expect(new Set(signs)).toEqual(new Set([1]));
  });

  it("returns nothing for an empty path or width", () => {
    expect(corridorRings([], 10)).toEqual([]);
    expect(corridorRings(PATH, 0)).toEqual([]);
  });
});
