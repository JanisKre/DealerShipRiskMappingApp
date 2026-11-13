import { describe, expect, it } from "vitest";
import { defaultDashboardSurface, type A2uiSurface } from "./a2ui";
import { dropComponent } from "./a2ui-layout";

// root: kpis (k1–k4), charts (zones, top), table
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

function parentOf(s: A2uiSurface, id: string): string | undefined {
  return s.components.find(
    (c) =>
      (c.component === "Column" || c.component === "Row") &&
      c.children.includes(id),
  )?.id;
}

describe("dropComponent", () => {
  it("reorders cards within a row like the standard tiles", () => {
    const next = dropComponent(surface, "k4", "k1")!;
    expect(children(next, "kpis")).toEqual(["k4", "k1", "k2", "k3"]);
    const back = dropComponent(next, "k4", "k3")!;
    expect(children(back, "kpis")).toEqual(["k1", "k2", "k3", "k4"]);
  });

  it("gives a card dragged out of a row a row of its own", () => {
    const next = dropComponent(surface, "k2", "table")!;
    expect(children(next, "kpis")).toEqual(["k1", "k3", "k4"]);
    const own = parentOf(next, "k2")!;
    expect(own).not.toBe("root");
    expect(children(next, own)).toEqual(["k2"]);
    expect(children(next, "root")).toEqual(["kpis", "charts", own, "table"]);
  });

  it("lets the card be dragged back into its four-up row", () => {
    const out = dropComponent(surface, "k2", "table")!;
    const back = dropComponent(out, "k2", "k3")!;
    expect(children(back, "kpis")).toEqual(["k1", "k2", "k3", "k4"]);
    // The row it had on its own is gone again.
    expect(children(back, "root")).toEqual(["kpis", "charts", "table"]);
    expect(back.components).toHaveLength(surface.components.length);
  });

  it("appends a card dropped between the cards of a row", () => {
    const out = dropComponent(surface, "k2", "table")!;
    const back = dropComponent(out, "k2", "kpis")!;
    expect(children(back, "kpis")).toEqual(["k1", "k3", "k4", "k2"]);
  });

  it("gathers loose key figures into one row", () => {
    let s = dropComponent(surface, "k1", "table")!;
    s = dropComponent(s, "k2", "table")!;
    const own = parentOf(s, "k1")!;
    s = dropComponent(s, "k2", own)!;
    expect(children(s, own)).toEqual(["k1", "k2"]);
  });

  it("keeps key figures out of chart rows: the card goes above the row", () => {
    const next = dropComponent(surface, "k1", "top")!;
    expect(children(next, "charts")).toEqual(["zones", "top"]);
    const own = parentOf(next, "k1")!;
    expect(children(next, "root")).toEqual(["kpis", own, "charts", "table"]);
  });

  it("moves a chart back into its chart row", () => {
    let s = dropComponent(surface, "zones", "table")!;
    expect(children(s, "charts")).toEqual(["top"]);
    s = dropComponent(s, "zones", "top")!;
    expect(children(s, "charts")).toEqual(["zones", "top"]);
  });

  it("swaps a section with the row it is dropped on, not with a card inside", () => {
    const next = dropComponent(surface, "table", "k1")!;
    expect(children(next, "root")).toEqual(["table", "kpis", "charts"]);
    const rows = dropComponent(surface, "charts", "k3")!;
    expect(children(rows, "root")).toEqual(["charts", "kpis", "table"]);
  });

  it("refuses a fifth card in a row", () => {
    const five: A2uiSurface = {
      ...surface,
      components: [
        ...surface.components.map((c) =>
          c.id === "root" && c.component === "Column"
            ? { ...c, children: [...c.children, "solo"] }
            : c,
        ),
        { id: "solo", component: "Row", children: ["k5"] },
        {
          id: "k5",
          component: "KpiCard",
          title: "Fünfte",
          value: { "@call": "aggregate", args: { measure: "count" } },
        },
      ],
    };
    expect(dropComponent(five, "k5", "k1")).toBeNull();
    expect(dropComponent(five, "k5", "kpis")).toBeNull();
  });

  it("does nothing for a drop on the part itself or its own row", () => {
    expect(dropComponent(surface, "k1", "k1")).toBe(surface);
    expect(dropComponent(surface, "k1", "kpis")).toBe(surface);
  });

  it("refuses moving the root or an unknown part", () => {
    expect(dropComponent(surface, "root", "k1")).toBeNull();
    expect(dropComponent(surface, "missing", "k1")).toBeNull();
  });

  it("leaves the input unchanged", () => {
    const before = JSON.stringify(surface);
    dropComponent(surface, "k2", "table");
    expect(JSON.stringify(surface)).toBe(before);
  });
});
