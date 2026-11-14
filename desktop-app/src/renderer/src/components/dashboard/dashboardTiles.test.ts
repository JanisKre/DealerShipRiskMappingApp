import { describe, expect, it } from "vitest";
import {
  applyDashboardCommand,
  DEFAULT_TILE_ORDER,
  moveDashboardTile,
  parseDashboardCommand,
  parseTileLayout,
  serializeTileLayout,
  tileSpans,
} from "./dashboardTiles";
import de from "../../locales/de.json";
import en from "../../locales/en.json";
import fr from "../../locales/fr.json";

describe("tile layout storage", () => {
  it("keeps a hidden tile hidden after a reload", () => {
    const order = DEFAULT_TILE_ORDER.filter((id) => id !== "zones");
    expect(parseTileLayout(serializeTileLayout(order))).toEqual(order);
    expect(parseTileLayout(serializeTileLayout([]))).toEqual([]);
  });

  it("keeps the order", () => {
    const order = ["table", "summary"] as const;
    expect(parseTileLayout(serializeTileLayout([...order]))).toEqual([
      "table",
      "summary",
    ]);
  });

  it("appends only tiles that did not exist when the layout was saved", () => {
    const raw = JSON.stringify({
      order: ["summary", "table"],
      known: ["summary", "table", "zones"],
    });
    expect(parseTileLayout(raw)).toEqual([
      "summary",
      "table",
      "clusters",
      "topLocations",
      "insights",
      "changes",
    ]);
  });

  it("reads the old bare-array format without reviving hidden tiles", () => {
    expect(parseTileLayout(JSON.stringify(["summary", "table"]))).toEqual([
      "summary",
      "table",
    ]);
  });

  it("falls back to the defaults for missing or broken data", () => {
    expect(parseTileLayout(null)).toEqual(DEFAULT_TILE_ORDER);
    expect(parseTileLayout("{oops")).toEqual(DEFAULT_TILE_ORDER);
    expect(parseTileLayout('{"x":1}')).toEqual(DEFAULT_TILE_ORDER);
    expect(
      parseTileLayout(JSON.stringify(["summary", "bogus", "summary"])),
    ).toEqual(["summary"]);
  });
});

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

  it("understands the example prompt in every language and French commands", () => {
    for (const { dashboard } of [de, en, fr]) {
      expect(parseDashboardCommand(dashboard.examplePromptTable)).toEqual({
        action: "show",
        ids: ["table"],
      });
    }
    expect(parseDashboardCommand("Afficher les cumuls")).toEqual({
      action: "show",
      ids: ["clusters"],
    });
    expect(parseDashboardCommand("Masquer les points à vérifier")).toEqual({
      action: "hide",
      ids: ["insights"],
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
    expect(parseDashboardCommand("Blende die Standorttabelle aus")).toEqual({
      action: "hide",
      ids: ["table"],
    });
    expect(parseDashboardCommand("Blende die Tabelle wieder ein")).toEqual({
      action: "show",
      ids: ["table"],
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

describe("tileSpans", () => {
  it("keeps the default layout: three narrow tiles share a row", () => {
    const spans = tileSpans(DEFAULT_TILE_ORDER);
    expect(spans.get("summary")).toBe("@3xl:col-span-2 @5xl:col-span-3");
    expect(spans.get("zones")).toBe("@3xl:col-span-1 @5xl:col-span-1");
    expect(spans.get("topLocations")).toBe("@3xl:col-span-1 @5xl:col-span-1");
    // Insights and changes share a row at two columns; changes alone at three.
    expect(spans.get("insights")).toBe("@3xl:col-span-1 @5xl:col-span-1");
    expect(spans.get("changes")).toBe("@3xl:col-span-1 @5xl:col-span-3");
  });

  it("stretches a narrow tile left alone after its neighbours are hidden", () => {
    const spans = tileSpans(["summary", "insights", "table"]);
    expect(spans.get("insights")).toBe("@3xl:col-span-2 @5xl:col-span-3");
  });

  it("fills the row when two narrow tiles remain", () => {
    const spans = tileSpans(["summary", "zones", "insights", "table"]);
    expect(spans.get("zones")).toBe("@3xl:col-span-1 @5xl:col-span-1");
    expect(spans.get("insights")).toBe("@3xl:col-span-1 @5xl:col-span-2");
  });
});
