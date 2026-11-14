export interface TileCoords {
  x: number;
  y: number;
  z: number;
}

/**
 * How far up the pyramid a missing tile is looked for. Three levels (8×
 * upscaling) cover the gaps seen in practice: archived Esri versions often
 * end one or two levels above the newest one.
 */
export const TILE_FALLBACK_LEVELS = 3;

/**
 * The tile `levels` above `coords` and the part of it that covers `coords`,
 * as a CSS `object-view-box` value. Null when there is no such ancestor.
 */
export function ancestorTile(
  coords: TileCoords,
  levels: number,
  tileSize = 256,
): { coords: TileCoords; viewBox: string } | null {
  if (!Number.isInteger(levels) || levels < 1 || coords.z - levels < 0) {
    return null;
  }
  const scale = 2 ** levels;
  const size = tileSize / scale;
  const x = Math.floor(coords.x / scale);
  const y = Math.floor(coords.y / scale);
  const left = (coords.x - x * scale) * size;
  const top = (coords.y - y * scale) * size;
  return {
    coords: { x, y, z: coords.z - levels },
    viewBox: `xywh(${left}px ${top}px ${size}px ${size}px)`,
  };
}
