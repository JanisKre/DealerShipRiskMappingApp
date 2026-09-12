/**
 * Dependency-free geometry helper for lon/lat rings. Deliberately no
 * `@turf/area`: its default export doesn't reliably resolve in the
 * main process CJS bundle (electron-vite) ("area is not a function").
 */

/** Area of a lon/lat ring in m² (planar approximation, fine for small lots). */
export function polygonAreaSqm(ring: [number, number][]): number {
  if (ring.length < 4) return 0;
  const latRef = ring[0][1];
  const mPerDegLat = 111_320;
  const mPerDegLon = 111_320 * Math.cos((latRef * Math.PI) / 180);
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    area +=
      x1 * mPerDegLon * (y2 * mPerDegLat) - x2 * mPerDegLon * (y1 * mPerDegLat);
  }
  return Math.abs(area / 2);
}
