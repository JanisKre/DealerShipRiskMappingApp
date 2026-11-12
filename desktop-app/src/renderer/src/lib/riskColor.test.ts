import { describe, expect, it } from "vitest";
import {
  hailZoneColor,
  hailZoneTextColor,
  riskColor,
  riskLevel,
  riskLevelBadgeClass,
  riskLevelColor,
  riskLevelLabel,
} from "./riskColor";

describe("risk display mapping", () => {
  it.each([
    [0, "#16a34a"],
    [24.99, "#16a34a"],
    [25, "#eab308"],
    [49.99, "#eab308"],
    [50, "#f97316"],
    [74.99, "#f97316"],
    [75, "#dc2626"],
    [100, "#dc2626"],
  ])("maps score %s to traffic-light color %s", (score, color) => {
    expect(riskColor(score)).toBe(color);
  });

  it.each([
    [0, "LOW"],
    [25, "MEDIUM"],
    [50, "HIGH"],
    [75, "EXTREME"],
  ] as const)("maps score %s to level %s", (score, level) => {
    expect(riskLevel(score)).toBe(level);
  });

  it.each([
    ["LOW", "#16a34a", "Low"],
    ["MEDIUM", "#eab308", "Medium"],
    ["HIGH", "#f97316", "High"],
    ["EXTREME", "#dc2626", "Extreme"],
  ] as const)("maps %s to its label and color", (level, color, label) => {
    expect(riskLevelColor(level)).toBe(color);
    expect(riskLevelLabel(level)).toBe(label);
    expect(riskLevelBadgeClass(level)).toContain("text-");
  });
});

/** WCAG 2.x relative luminance of a #rrggbb color. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("hail zone badge colors", () => {
  it.each([1, 2, 3, 4, 5, 6])(
    "zone %i text meets WCAG AA contrast on its badge color",
    (zone) => {
      expect(
        contrast(hailZoneTextColor(zone), hailZoneColor(zone)),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );
});
