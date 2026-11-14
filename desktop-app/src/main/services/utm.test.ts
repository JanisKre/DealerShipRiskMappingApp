import { describe, expect, it } from "vitest";
import { toUtm32 } from "./alkis.service";
import { fromUtm, toUtm } from "./utm";

describe("UTM zones 32 and 33", () => {
  it("matches the zone-32 conversion already in use", () => {
    const [e1, n1] = toUtm(54.3205, 10.131, 32);
    const [e2, n2] = toUtm32(54.3205, 10.131);
    expect(e1).toBeCloseTo(e2, 6);
    expect(n1).toBeCloseTo(n2, 6);
  });

  it("puts Schwerin where the MV parcel service has it (zone 33)", () => {
    // A parcel vertex returned for a 120 m box around 53.6295, 11.41
    // (EPSG:25833); it must lie inside that box.
    const [lon, lat] = fromUtm(262_656.515, 5_948_260.155, 33);
    expect(Math.abs(lat - 53.6295)).toBeLessThan(0.0006);
    expect(Math.abs(lon - 11.41)).toBeLessThan(0.0009);
  });

  it("round-trips within a millimetre", () => {
    for (const zone of [32, 33]) {
      const [east, north] = toUtm(53.5, zone === 32 ? 9.5 : 13.4, zone);
      const [lon, lat] = fromUtm(east, north, zone);
      const [e2, n2] = toUtm(lat, lon, zone);
      expect(Math.abs(e2 - east)).toBeLessThan(0.001);
      expect(Math.abs(n2 - north)).toBeLessThan(0.001);
    }
  });
});
