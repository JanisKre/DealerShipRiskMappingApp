import { describe, expect, it } from "vitest";
import { validateTileTemplate } from "@shared/tile-template";
import { TILE_TEMPLATE_OPTIONS } from "./basemapTiles";

/**
 * Leaflet's `L.Util.template`: a placeholder without a value throws, which
 * took the whole map page down for a custom template with `{time}`.
 */
function leafletTemplate(
  template: string,
  data: Record<string, unknown>,
): string {
  return template.replace(/\{ *([\w_ -]+) *\}/g, (_match, key: string) => {
    let value = data[key];
    if (value === undefined) {
      throw new Error(`No value provided for variable {${key}}`);
    }
    if (typeof value === "function") value = value(data);
    return String(value);
  });
}

describe("TILE_TEMPLATE_OPTIONS", () => {
  it("gives Leaflet a value for every placeholder a custom template may use", () => {
    const template =
      "https://wms.example.test/dop?TIME={time}&BBOX={bbox-epsg-3857}&T={z}/{x}/{y}";
    expect(validateTileTemplate(template).ok).toBe(true);
    const url = leafletTemplate(template, {
      ...TILE_TEMPLATE_OPTIONS,
      x: 1,
      y: 2,
      z: 3,
    });
    // `{time}` stays empty, as in the main process for the current image.
    expect(url).toContain("TIME=&BBOX=");
    expect(url).toMatch(/BBOX=-?[\d.]+,-?[\d.]+,-?[\d.]+,-?[\d.]+&T=3\/1\/2$/);
  });
});
