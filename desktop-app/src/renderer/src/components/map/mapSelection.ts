import type { AnalyzedDealership, BoundaryGeometry } from "@shared/types";

/**
 * What the map draws: the locations the portfolio filters let through, plus
 * the selected one even when a filter hides it — a site picked in the list,
 * the chat or the review must never be invisible on the map.
 */
export function withSelected(
  visible: AnalyzedDealership[],
  all: AnalyzedDealership[],
  selectedId: string | null,
): AnalyzedDealership[] {
  if (!selectedId || visible.some((d) => d.id === selectedId)) return visible;
  const selected = all.find((d) => d.id === selectedId);
  return selected ? [...visible, selected] : visible;
}

/**
 * Locations whose boundary needs a check, in list order. Only those the map
 * shows: the review must not ask about a site a filter hides.
 */
export function boundaryReviewQueue(visible: AnalyzedDealership[]): string[] {
  return visible.filter((d) => d.boundary?.reviewRequired).map((d) => d.id);
}

/** Bounding box of a boundary as Leaflet `[[south, west], [north, east]]`. */
export function geometryBounds(
  geometry: BoundaryGeometry,
): [[number, number], [number, number]] | null {
  const rings =
    geometry.type === "Polygon"
      ? geometry.coordinates
      : geometry.coordinates.flat();
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const ring of rings)
    for (const [lon, lat] of ring) {
      south = Math.min(south, lat);
      north = Math.max(north, lat);
      west = Math.min(west, lon);
      east = Math.max(east, lon);
    }
  return Number.isFinite(south)
    ? [
        [south, west],
        [north, east],
      ]
    : null;
}

/**
 * Whether every row the list shows is ticked. "Select all" and "Deselect all"
 * follow the visible rows (search and filters applied), not the whole book.
 */
export function allRowsSelected(
  selectedIds: ReadonlySet<string>,
  rowIds: readonly string[],
): boolean {
  return rowIds.length > 0 && rowIds.every((id) => selectedIds.has(id));
}
