import type { LonLat } from "../boundary-geometry";

/**
 * Vegetation seen on the aerial image, as a coarse raster.
 *
 * The cadastre says who a parcel belongs to and what it is registered as,
 * not what is on it: a meadow behind the workshop is "Industrie- und
 * Gewerbefläche" under the dealership's address. The image the vehicles are
 * detected on shows the difference, so the cascade asks it before a parcel
 * joins without cars and trims planted fringes off the result
 * (docs/boundary-model.md, "Cascade v9").
 *
 * The test is a colour rule on RGB orthophotos (green clearly above red and
 * blue, with a second rule for shade). It sees grass and trees in leaf; it
 * does not see bare fields, winter imagery or gravel, which simply stay
 * "not vegetation".
 */

/** A raster in geographic coordinates: 1 = vegetation. */
export interface VegetationMask {
  west: number;
  south: number;
  east: number;
  north: number;
  width: number;
  height: number;
  /** Row-major from the north-west corner, one byte per cell. */
  cells: Uint8Array;
}

/** The georeferenced image the mask is read from (an `AerialCapture`). */
export interface GeoImage {
  rgba?: ArrayLike<number> | null;
  width: number;
  height: number;
  originLon: number;
  originLat: number;
  lonSpan: number;
  latSpan: number;
}

/** Edge length of a mask cell in metres. */
export const VEGETATION_CELL_M = 1;

/**
 * Green clearly above red and blue; or, in shade, where orthophotos turn
 * blue, green well above red with blue not far above green. Shaded grass
 * reads about (40, 60, 80), shaded asphalt about (50, 55, 75).
 */
export function isVegetationPixel(r: number, g: number, b: number): boolean {
  const sum = r + g + b;
  if (sum < 45) return false;
  if (g > r * 1.04 && g > b * 1.1 && g / sum > 0.355) return true;
  return sum < 260 && g > r * 1.25 && b < g * 1.45;
}

/**
 * The vegetation raster of an image, one cell per `VEGETATION_CELL_M`; a
 * cell is vegetation when most of the pixels sampled in it are. Null when
 * the image carries no pixels.
 */
export function vegetationMask(image: GeoImage): VegetationMask | null {
  const { rgba } = image;
  if (!rgba || image.width <= 0 || image.height <= 0) return null;
  const midLat = image.originLat - image.latSpan / 2;
  const widthM = image.lonSpan * 111_320 * Math.cos((midLat * Math.PI) / 180);
  const heightM = image.latSpan * 111_320;
  const width = Math.max(1, Math.round(widthM / VEGETATION_CELL_M));
  const height = Math.max(1, Math.round(heightM / VEGETATION_CELL_M));
  const cells = new Uint8Array(width * height);
  const stepX = image.width / width;
  const stepY = image.height / height;
  const offsets = [1 / 6, 1 / 2, 5 / 6];
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      let green = 0;
      for (const oy of offsets) {
        const py = Math.min(image.height - 1, Math.floor((row + oy) * stepY));
        for (const ox of offsets) {
          const px = Math.min(image.width - 1, Math.floor((col + ox) * stepX));
          const i = (py * image.width + px) * 4;
          if (rgba[i + 3] < 128) continue;
          if (isVegetationPixel(rgba[i], rgba[i + 1], rgba[i + 2])) green += 1;
        }
      }
      if (green >= 5) cells[row * width + col] = 1;
    }
  }
  return {
    west: image.originLon,
    north: image.originLat,
    east: image.originLon + image.lonSpan,
    south: image.originLat - image.latSpan,
    width,
    height,
    cells,
  };
}

/** Vegetation at a point; null outside the image. */
export function vegetationAt(
  mask: VegetationMask,
  [lon, lat]: LonLat,
): boolean | null {
  if (
    lon < mask.west ||
    lon >= mask.east ||
    lat <= mask.south ||
    lat > mask.north
  ) {
    return null;
  }
  const col = Math.floor(
    ((lon - mask.west) / (mask.east - mask.west)) * mask.width,
  );
  const row = Math.floor(
    ((mask.north - lat) / (mask.north - mask.south)) * mask.height,
  );
  return mask.cells[row * mask.width + col] === 1;
}
