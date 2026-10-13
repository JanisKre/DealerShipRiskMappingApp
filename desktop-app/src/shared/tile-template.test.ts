import { describe, expect, it } from "vitest";
import { buildTileUrl } from "./constants";
import { isUsableTileTemplate, validateTileTemplate } from "./tile-template";

describe("validateTileTemplate", () => {
  it.each([
    "https://tiles.example.com/{z}/{x}/{y}.png",
    "https://wms.example.com/service?SERVICE=WMS&REQUEST=GetMap&BBOX={bbox-epsg-3857}&TIME={time}",
    "https://example.com:8443/xyz/{z}/{y}/{x}.jpg",
  ])("accepts %s", (template) => {
    expect(validateTileTemplate(template)).toEqual({ ok: true, template });
  });

  it("trims surrounding whitespace", () => {
    expect(
      validateTileTemplate("  https://t.example.com/{z}/{x}/{y}.png \n"),
    ).toEqual({ ok: true, template: "https://t.example.com/{z}/{x}/{y}.png" });
  });

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    [`https://t.example.com/${"a".repeat(2050)}/{z}/{x}/{y}`, "too-long"],
    ["http://t.example.com/{z}/{x}/{y}.png", "not-https"],
    ["file:///etc/{z}/{x}/{y}", "not-https"],
    ["javascript:alert(1)//{z}/{x}/{y}", "not-https"],
    ["https://user:pw@t.example.com/{z}/{x}/{y}.png", "credentials"],
    ["https://{s}.tile.example.com/{z}/{x}/{y}.png", "unknown-placeholder"],
    ["https://{z}.example.com/{x}/{y}.png", "placeholder-in-host"],
    ["https://t.example.com/{z}/{x}/{y}.png?k={key}", "unknown-placeholder"],
    ["https://t.example.com/{z}/{x}/{y.png", "unknown-placeholder"],
    ["https://t.example.com/{z}/{x}.png", "missing-placeholders"],
    ["https://t.example.com/tile.png", "missing-placeholders"],
    ["not a url {z}/{x}/{y}", "invalid-url"],
  ])("rejects %s (%s)", (template, problem) => {
    expect(validateTileTemplate(template)).toEqual({ ok: false, problem });
  });

  it("guards non-string input", () => {
    expect(isUsableTileTemplate(undefined)).toBe(false);
    expect(isUsableTileTemplate(42)).toBe(false);
    expect(isUsableTileTemplate("https://t.example.com/{z}/{x}/{y}")).toBe(
      true,
    );
  });
});

describe("buildTileUrl with a custom template", () => {
  it("fills a valid template", () => {
    expect(
      buildTileUrl("wms", 5, 10, 17, {
        wmsTemplate: "https://t.example.com/{z}/{x}/{y}.png?t={time}",
        time: "2020-01-01",
      }),
    ).toBe("https://t.example.com/5/17/10.png?t=2020-01-01");
  });

  it("falls back to Esri for an invalid template", () => {
    expect(
      buildTileUrl("wms", 5, 10, 17, {
        wmsTemplate: "http://insecure.example.com/{z}/{x}/{y}.png",
      }),
    ).toContain("server.arcgisonline.com");
  });
});
