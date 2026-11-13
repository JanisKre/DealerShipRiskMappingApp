/**
 * Geographic outline of a hailstorm corridor: everything within `widthKm / 2`
 * of the drawn path, the same rule `computeScenarioImpact` uses to count
 * affected sites. The old buffer was a polyline `widthKm * 4` pixels wide,
 * so its drawn width changed with the zoom and did not match the count.
 *
 * The buffer is the union of one rectangle per segment and one circle per
 * vertex. All rings share one winding, so a polygon with `fillRule:
 * "nonzero"` fills their union once, without darker overlaps.
 */

/** Kilometres per degree of latitude (sphere of radius 6371 km). */
const KM_PER_DEG = (6371 * Math.PI) / 180;
/** Vertices per circle around a path vertex. */
const CIRCLE_STEPS = 48;

type LonLat = [number, number];
type LatLng = [number, number];

/** Shoelace area sign in lon/lat space (> 0 = counter-clockwise). */
function signedArea(ring: LatLng[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [lat1, lon1] = ring[i];
    const [lat2, lon2] = ring[(i + 1) % ring.length];
    sum += lon1 * lat2 - lon2 * lat1;
  }
  return sum / 2;
}

/** Counter-clockwise, so every ring adds to the nonzero fill. */
function ccw(ring: LatLng[]): LatLng[] {
  return signedArea(ring) < 0 ? [...ring].reverse() : ring;
}

/** Point `dxKm` east and `dyKm` north of `[lat, lon]`. */
function offset(lat: number, lon: number, dxKm: number, dyKm: number): LatLng {
  const kmPerDegLon = KM_PER_DEG * Math.cos((lat * Math.PI) / 180);
  return [lat + dyKm / KM_PER_DEG, lon + dxKm / kmPerDegLon];
}

/**
 * Rings (`[lat, lon]`, Leaflet order) covering the corridor around `path`
 * (`[lon, lat]`, as stored on the scenario).
 */
export function corridorRings(path: LonLat[], widthKm: number): LatLng[][] {
  const half = widthKm / 2;
  if (path.length === 0 || !(half > 0)) return [];
  const rings: LatLng[][] = [];

  for (const [lon, lat] of path) {
    const circle: LatLng[] = [];
    for (let i = 0; i < CIRCLE_STEPS; i++) {
      const angle = (2 * Math.PI * i) / CIRCLE_STEPS;
      circle.push(
        offset(lat, lon, half * Math.cos(angle), half * Math.sin(angle)),
      );
    }
    rings.push(ccw(circle));
  }

  for (let i = 0; i < path.length - 1; i++) {
    const [aLon, aLat] = path[i];
    const [bLon, bLat] = path[i + 1];
    const midLat = (aLat + bLat) / 2;
    const kmPerDegLon = KM_PER_DEG * Math.cos((midLat * Math.PI) / 180);
    const dx = (bLon - aLon) * kmPerDegLon;
    const dy = (bLat - aLat) * KM_PER_DEG;
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;
    // Unit normal to the segment, scaled to the half width.
    const nx = (-dy / length) * half;
    const ny = (dx / length) * half;
    rings.push(
      ccw([
        offset(aLat, aLon, nx, ny),
        offset(bLat, bLon, nx, ny),
        offset(bLat, bLon, -nx, -ny),
        offset(aLat, aLon, -nx, -ny),
      ]),
    );
  }
  return rings;
}
