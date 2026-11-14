/**
 * True when a resize takes the window from wide to narrow. The layout then
 * gives the map room once (sidebar to icons, assistant closed) — at
 * 1024×700 the map was squeezed to ~270 px because the start-up check only
 * ran for the first window size (UW-13). Widening again changes nothing,
 * and panels the user reopens while narrow stay open.
 */
export function crossedIntoNarrow(
  previousWidth: number,
  width: number,
  limit: number,
): boolean {
  return previousWidth >= limit && width < limit;
}
