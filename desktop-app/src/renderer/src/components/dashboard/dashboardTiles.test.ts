import { describe, expect, it } from "vitest";
import {
  applyDashboardCommand,
  moveDashboardTile,
  parseDashboardCommand,
} from "./dashboardTiles";

describe("parseDashboardCommand", () => {
  it("recognizes localized show commands", () => {
    expect(parseDashboardCommand("Add the seasonal profile")).toEqual({
      action: "show",
      ids: ["seasonal"],
    });
    expect(parseDashboardCommand("Saisonprofil hinzufügen")).toEqual({
      action: "show",
      ids: ["seasonal"],
    });
  });

  it("recognizes removal and reset commands", () => {
    expect(parseDashboardCommand("Remove PML from the dashboard")).toEqual({
      action: "hide",
      ids: ["pml"],
    });
    expect(parseDashboardCommand("Reset dashboard layout")).toEqual({
      action: "reset",
    });
  });

  it("does not intercept normal portfolio questions", () => {
    expect(
      parseDashboardCommand("Which location has the highest hail score?"),
    ).toBeNull();
  });

  it("supports the three assistant examples", () => {
    expect(parseDashboardCommand("Show the location table")).toEqual({
      action: "show",
      ids: ["table"],
    });
    expect(parseDashboardCommand("Add seasonal profile")).toEqual({
      action: "show",
      ids: ["seasonal"],
    });
    expect(parseDashboardCommand("Show risk distribution")).toEqual({
      action: "show",
      ids: ["risk"],
    });
    expect(parseDashboardCommand("Ajouter le profil saisonnier")).toEqual({
      action: "show",
      ids: ["seasonal"],
    });
    expect(
      parseDashboardCommand("Afficher la répartition des risques"),
    ).toEqual({
      action: "show",
      ids: ["risk"],
    });
  });

  it("applies assistant commands to the visible tile order", () => {
    expect(
      applyDashboardCommand(["summary", "risk"], {
        action: "show",
        ids: ["table"],
      }),
    ).toEqual(["summary", "risk", "table"]);
    expect(
      applyDashboardCommand(["summary", "risk", "table"], {
        action: "hide",
        ids: ["risk"],
      }),
    ).toEqual(["summary", "table"]);
  });

  it("moves tiles while preserving the remaining order", () => {
    expect(
      moveDashboardTile(["summary", "risk", "pml"], "pml", "summary"),
    ).toEqual(["pml", "summary", "risk"]);
    expect(moveDashboardTile(["summary", "risk"], "risk", "risk")).toEqual([
      "summary",
      "risk",
    ]);
  });
});
