import { describe, expect, it } from "vitest";
import {
  STATE_CADASTRE_SERVICES,
  cadastreAttribution,
  cadastreServicesInView,
  cadastreTileTemplate,
} from "./cadastre-sources";
import { GERMAN_STATES } from "./imagery-sources";
import { validateTileTemplate } from "./tile-template";

const services = Object.values(STATE_CADASTRE_SERVICES);

describe("STATE_CADASTRE_SERVICES", () => {
  it("covers every state except Saarland, which has no open parcel WMS", () => {
    const missing = GERMAN_STATES.filter((s) => !STATE_CADASTRE_SERVICES[s]);
    expect(missing).toEqual(["SL"]);
  });

  it.each(services)("$state: keyed by its own state, with a licence", (s) => {
    expect(STATE_CADASTRE_SERVICES[s.state]).toBe(s);
    expect(s.license).not.toBe("");
    expect(s.attribution).toMatch(/^© /);
  });

  it.each(services)(
    "$state: box is a valid south-west/north-east pair",
    (s) => {
      const [[south, west], [north, east]] = s.bounds;
      expect(south).toBeLessThan(north);
      expect(west).toBeLessThan(east);
      expect(south).toBeGreaterThan(47);
      expect(north).toBeLessThan(55.1);
      expect(west).toBeGreaterThan(5.8);
      expect(east).toBeLessThan(15.1);
    },
  );

  it.each(services)("$state: template is a safe fixed-host HTTPS URL", (s) => {
    const template = cadastreTileTemplate(s);
    expect(validateTileTemplate(template)).toEqual({ ok: true, template });
  });

  it.each(services)("$state: names one style per layer", (s) => {
    expect(s.style.styles.split(",")).toHaveLength(
      s.style.layers.split(",").length,
    );
  });
});

describe("cadastreTileTemplate", () => {
  const bw = STATE_CADASTRE_SERVICES.BW!;
  const nw = STATE_CADASTRE_SERVICES.NW!;

  it("requests one transparent 256 px PNG tile in Web Mercator", () => {
    const url = new URL(
      cadastreTileTemplate(bw).replace("{bbox-epsg-3857}", "0,0,1,1"),
    );
    expect(url.searchParams.get("REQUEST")).toBe("GetMap");
    expect(url.searchParams.get("VERSION")).toBe("1.3.0");
    expect(url.searchParams.get("CRS")).toBe("EPSG:3857");
    expect(url.searchParams.get("FORMAT")).toBe("image/png");
    expect(url.searchParams.get("TRANSPARENT")).toBe("TRUE");
    expect(url.searchParams.get("WIDTH")).toBe("256");
    expect(url.searchParams.get("BBOX")).toBe("0,0,1,1");
  });

  it("asks for the halo-free outline style", () => {
    const params = new URL(cadastreTileTemplate(nw)).searchParams;
    expect(params.get("LAYERS")).toBe("adv_alkis_flurstuecke");
    expect(params.get("STYLES")).toBe("Gelb");
  });
});

describe("cadastreServicesInView", () => {
  const around = (
    lat: number,
    lon: number,
    d = 0.01,
  ): { south: number; north: number; west: number; east: number } => ({
    south: lat - d,
    north: lat + d,
    west: lon - d,
    east: lon + d,
  });

  it("returns only the state boxes the view meets", () => {
    // Munich lies only inside Bavaria's box.
    expect(
      cadastreServicesInView(around(48.137, 11.575)).map((s) => s.state),
    ).toEqual(["BY"]);
  });

  it("includes the enclosing state's box for a city-state", () => {
    const states = cadastreServicesInView(around(52.52, 13.405)).map(
      (s) => s.state,
    );
    expect(states).toContain("BE");
    expect(states).toContain("BB");
  });

  it("returns nothing outside Germany", () => {
    expect(cadastreServicesInView(around(48.857, 2.352))).toEqual([]);
  });
});

describe("cadastreAttribution", () => {
  it("fills the year", () => {
    expect(cadastreAttribution(STATE_CADASTRE_SERVICES.SN!, 2026)).toBe(
      "© GeoSN (2026), dl-de/by-2-0",
    );
  });
});
