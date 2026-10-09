import { describe, expect, it } from "vitest";
import {
  applyDashboardCommand,
  DEFAULT_TILE_ORDER,
  moveDashboardTile,
  parseDashboardCommand,
} from "./dashboardTiles";

describe("parseDashboardCommand", () => {
  it("recognizes localized show commands", () => {
    expect(parseDashboardCommand("Add the accumulation list")).toEqual({
      action: "show",
      ids: ["clusters"],
    });
    expect(parseDashboardCommand("Kumulationen hinzufügen")).toEqual({
      action: "show",
      ids: ["clusters"],
    });
    expect(parseDashboardCommand("Zeige die Hagelzonen-Verteilung")).toEqual({
      action: "show",
      ids: ["zones"],
    });
  });

  it("recognizes removal and reset commands", () => {
    expect(parseDashboardCommand("Remove the review notes")).toEqual({
      action: "hide",
      ids: ["insights"],
    });
    expect(parseDashboardCommand("Prüfhinweise ausblenden")).toEqual({
      action: "hide",
      ids: ["insights"],
    });
    expect(parseDashboardCommand("Reset dashboard layout")).toEqual({
      action: "reset",
    });
  });

  it("does not intercept normal portfolio questions", () => {
    expect(
      parseDashboardCommand("Which location has the highest hail EAL?"),
    ).toBeNull();
  });

  it("supports the assistant examples", () => {
    expect(parseDashboardCommand("Show the location table")).toEqual({
      action: "show",
      ids: ["table"],
    });
    expect(parseDashboardCommand("Show hail zone distribution")).toEqual({
      action: "show",
      ids: ["zones"],
    });
    expect(parseDashboardCommand("Show the top locations")).toEqual({
      action: "show",
      ids: ["topLocations"],
    });
    expect(parseDashboardCommand("Afficher la répartition des zones")).toEqual({
      action: "show",
      ids: ["zones"],
    });
  });

  it("shows every tile for 'all'", () => {
    expect(parseDashboardCommand("Show all tiles")).toEqual({
      action: "show",
      ids: DEFAULT_TILE_ORDER,
    });
  });

  it("applies assistant commands to the visible tile order", () => {
    expect(
      applyDashboardCommand(["summary", "zones"], {
        action: "show",
        ids: ["table"],
      }),
    ).toEqual(["summary", "zones", "table"]);
    expect(
      applyDashboardCommand(["summary", "zones", "table"], {
        action: "hide",
        ids: ["zones"],
      }),
    ).toEqual(["summary", "table"]);
  });

  it("moves tiles while preserving the remaining order", () => {
    expect(
      moveDashboardTile(
        ["summary", "zones", "clusters"],
        "clusters",
        "summary",
      ),
    ).toEqual(["clusters", "summary", "zones"]);
    expect(moveDashboardTile(["summary", "zones"], "zones", "zones")).toEqual([
      "summary",
      "zones",
    ]);
  });
});
