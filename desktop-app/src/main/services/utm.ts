import type { LonLat } from "./boundary-geometry";

/**
 * ETRS89 geographic ↔ UTM (EPSG:25832 for zone 32, EPSG:25833 for zone 33),
 * Krüger series to third order: millimetre accuracy within a zone.
 */

const A = 6_378_137;
const F = 1 / 298.257222101;
const K0 = 0.9996;
const N = F / (2 - F);
const BIG_A = (A / (1 + N)) * (1 + (N * N) / 4 + N ** 4 / 64);

function centralMeridian(zone: number): number {
  return zone * 6 - 183;
}

/** Easting and northing in metres. */
export function toUtm(
  lat: number,
  lon: number,
  zone: number,
): [number, number] {
  const phi = (lat * Math.PI) / 180;
  const dLam = ((lon - centralMeridian(zone)) * Math.PI) / 180;
  const c = (2 * Math.sqrt(N)) / (1 + N);
  const t = Math.sinh(
    Math.atanh(Math.sin(phi)) - c * Math.atanh(c * Math.sin(phi)),
  );
  const xi = Math.atan(t / Math.cos(dLam));
  const eta = Math.atanh(Math.sin(dLam) / Math.sqrt(1 + t * t));
  const alpha = [
    N / 2 - (2 * N * N) / 3 + (5 * N ** 3) / 16,
    (13 * N * N) / 48 - (3 * N ** 3) / 5,
    (61 * N ** 3) / 240,
  ];
  let e = eta;
  let nn = xi;
  alpha.forEach((al, j) => {
    const k = 2 * (j + 1);
    e += al * Math.cos(k * xi) * Math.sinh(k * eta);
    nn += al * Math.sin(k * xi) * Math.cosh(k * eta);
  });
  return [500_000 + K0 * BIG_A * e, K0 * BIG_A * nn];
}

/** [lon, lat] of an easting and northing in the zone. */
export function fromUtm(east: number, north: number, zone: number): LonLat {
  const xi = north / (K0 * BIG_A);
  const eta = (east - 500_000) / (K0 * BIG_A);
  const beta = [
    N / 2 - (2 * N * N) / 3 + (37 * N ** 3) / 96,
    (N * N) / 48 + N ** 3 / 15,
    (17 * N ** 3) / 480,
  ];
  let xiP = xi;
  let etaP = eta;
  beta.forEach((b, j) => {
    const k = 2 * (j + 1);
    xiP -= b * Math.sin(k * xi) * Math.cosh(k * eta);
    etaP -= b * Math.cos(k * xi) * Math.sinh(k * eta);
  });
  const chi = Math.asin(Math.sin(xiP) / Math.cosh(etaP));
  const delta = [
    2 * N - (2 * N * N) / 3 - 2 * N ** 3,
    (7 * N * N) / 3 - (8 * N ** 3) / 5,
    (56 * N ** 3) / 15,
  ];
  let phi = chi;
  delta.forEach((d, j) => {
    phi += d * Math.sin(2 * (j + 1) * chi);
  });
  const lam = Math.atan2(Math.sinh(etaP), Math.cos(xiP));
  return [centralMeridian(zone) + (lam * 180) / Math.PI, (phi * 180) / Math.PI];
}
