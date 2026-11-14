/**
 * Remaining time of a batch analysis as a coarse range (UW-04): the
 * per-site time varies a lot (imagery, cadastre lookups), so a single
 * extrapolated figure jumped between 59 min, 1 h 05 and 42 min. A ±25 %
 * band, rounded to steps that grow with the duration, stays put.
 */
export function etaRangeMinutes(
  done: number,
  total: number,
  elapsedMs: number,
): [number, number] | null {
  if (done < 3 || total <= done || elapsedMs <= 0) return null;
  const minutes = ((elapsedMs / done) * (total - done)) / 60_000;
  const step = minutes < 10 ? 1 : minutes < 60 ? 5 : 15;
  const low = Math.max(1, Math.floor((minutes * 0.75) / step) * step);
  const high = Math.max(low + step, Math.ceil((minutes * 1.25) / step) * step);
  return [low, high];
}
