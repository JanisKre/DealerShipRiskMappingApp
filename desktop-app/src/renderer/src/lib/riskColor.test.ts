import { describe, expect, it } from "vitest";
import {
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
