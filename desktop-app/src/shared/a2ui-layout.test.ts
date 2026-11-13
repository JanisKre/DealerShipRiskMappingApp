import { describe, expect, it } from "vitest";
import { defaultDashboardSurface, type A2uiSurface } from "./a2ui";
import { dropTarget, moveA2uiComponent } from "./a2ui-layout";

const surface = defaultDashboardSurface({
  title: "Übersicht",
  count: "Standorte",
  eal: "Hagel-EAL",
  exposure: "Exposure",
  vehicles: "Fahrzeuge",
  byZone: "Standorte je Zone",
  topEal: "Höchster EAL",
  table: "Standorte",
});

function children(s: A2uiSurface, id: string): string[] {
  const c = s.components.find((x) => x.id === id);
  return c && (c.component === "Column" || c.component === "Row")
    ? c.children
    : [];
}

describe("moveA2uiComponent", () => {
  it("reorders cards within a row like the standard tiles", () => {
    const next = moveA2uiComponent(surface, "k4", "k1")!;
    expect(children(next, "kpis")).toEqual(["k4", "k1", "k2", "k3"]);
    const back = moveA2uiComponent(next, "k4", "k3")!;
    expect(children(back, "kpis")).toEqual(["k1", "k2", "k3", "k4"]);
  });

  it("reorders sections of the page", () => {
    const next = moveA2uiComponent(surface, "table", "kpis")!;
    expect(children(next, "root")).toEqual(["table", "kpis", "charts"]);
  });

  it("moves a card into another row in front of the card it was dropped on", () => {
    const next = moveA2uiComponent(surface, "k1", "top")!;
    expect(children(next, "kpis")).toEqual(["k2", "k3", "k4"]);
    expect(children(next, "charts")).toEqual(["zones", "k1", "top"]);
  });

  it("takes a card out of a row onto the page", () => {
    const next = moveA2uiComponent(surface, "zones", "table")!;
    expect(children(next, "charts")).toEqual(["top"]);
    expect(children(next, "root")).toEqual([
      "kpis",
      "charts",
      "zones",
      "table",
    ]);
  });

  it("removes a row the move leaves empty", () => {
    let next = moveA2uiComponent(surface, "zones", "table")!;
    next = moveA2uiComponent(next, "top", "table")!;
    expect(next.components.some((c) => c.id === "charts")).toBe(false);
    expect(children(next, "root")).toEqual(["kpis", "zones", "top", "table"]);
  });

  it("refuses a fifth card in a row", () => {
    expect(moveA2uiComponent(surface, "zones", "k1")).toBeNull();
  });

  it("refuses a row inside a row, and a move onto itself or the root", () => {
    expect(moveA2uiComponent(surface, "charts", "k1")).toBeNull();
    expect(moveA2uiComponent(surface, "k1", "k1")).toBeNull();
    expect(moveA2uiComponent(surface, "root", "k1")).toBeNull();
    expect(moveA2uiComponent(surface, "k1", "root")).toBeNull();
    expect(moveA2uiComponent(surface, "missing", "k1")).toBeNull();
  });

  it("leaves the input unchanged", () => {
    const before = JSON.stringify(surface);
    moveA2uiComponent(surface, "k4", "k1");
    expect(JSON.stringify(surface)).toBe(before);
  });
});

describe("dropTarget", () => {
  it("swaps a section with the row it is dropped on, not with a card inside", () => {
    expect(dropTarget(surface, "table", "k1")).toBe("kpis");
    expect(dropTarget(surface, "charts", "k3")).toBe("kpis");
  });

  it("keeps the card a sibling is dropped on", () => {
    expect(dropTarget(surface, "k4", "k1")).toBe("k1");
  });

  it("puts a card into another row when no sibling is around", () => {
    expect(dropTarget(surface, "k1", "top")).toBe("top");
  });
});
