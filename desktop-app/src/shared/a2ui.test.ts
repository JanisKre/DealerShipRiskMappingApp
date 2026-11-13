import { describe, expect, it } from "vitest";
import {
  applyAgentMessage,
  containsFigure,
  defaultDashboardSurface,
  DRM_DASHBOARD_CATALOG_ID,
  surfaceIssues,
  type A2uiSurface,
} from "./a2ui";

const create = (
  components: unknown[],
  title = "Zone 4+",
): { version: string; createSurface: Record<string, unknown> } => ({
  version: "1.0",
  createSurface: {
    surfaceId: "dashboard",
    catalogId: DRM_DASHBOARD_CATALOG_ID,
    metadata: { title },
    components,
  },
});

const kpi = {
  id: "k1",
  component: "KpiCard",
  title: "Hagel-EAL",
  value: {
    "@call": "aggregate",
    args: { measure: "eal", filter: { minHailZone: 4 } },
  },
};
const valid = [{ id: "root", component: "Column", children: ["k1"] }, kpi];

function ok(result: ReturnType<typeof applyAgentMessage>): A2uiSurface {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.surface;
}

describe("A2UI messages", () => {
  it("accepts a createSurface with catalog components", () => {
    const surface = ok(applyAgentMessage(create(valid), null));
    expect(surface.title).toBe("Zone 4+");
    expect(surface.components.map((c) => c.id)).toEqual(["root", "k1"]);
  });

  it("rejects unknown components, unknown filter keys and other catalogs", () => {
    const unknown = applyAgentMessage(
      create([
        { id: "root", component: "Column", children: ["x"] },
        { id: "x", component: "Iframe", src: "https://x" },
      ]),
      null,
    );
    expect(unknown.ok).toBe(false);
    const typo = applyAgentMessage(
      create([
        valid[0],
        {
          ...kpi,
          value: {
            "@call": "aggregate",
            args: { measure: "eal", filter: { minZone: 4 } },
          },
        },
      ]),
      null,
    );
    expect(typo.ok).toBe(false);
    const other = applyAgentMessage(
      {
        ...create(valid),
        createSurface: {
          ...create(valid).createSurface,
          catalogId: "https://a2ui.org/basic",
        },
      },
      null,
    );
    expect(other.ok).toBe(false);
  });

  it("rejects titles that carry figures", () => {
    expect(containsFigure("Hagel-EAL 120.000 €")).toBe(true);
    expect(containsFigure("Anteil 35 %")).toBe(true);
    expect(containsFigure("Top 10 Standorte")).toBe(false);
    const result = applyAgentMessage(create(valid, "EAL 2 Mio"), null);
    expect(result.ok).toBe(false);
  });

  it("checks the tree: root, children, cycles", () => {
    expect(surfaceIssues([kpi as never]).map((i) => i.message)).toEqual([
      'a component with id "root" is required',
    ]);
    const missing = applyAgentMessage(
      create([
        { id: "root", component: "Column", children: ["k1", "ghost"] },
        kpi,
      ]),
      null,
    );
    expect(!missing.ok && missing.issues[0].message).toMatch(
      /unknown child "ghost"/,
    );
    const cycle = applyAgentMessage(
      create([
        { id: "root", component: "Column", children: ["a"] },
        { id: "a", component: "Row", children: ["root"] },
      ]),
      null,
    );
    expect(!cycle.ok && cycle.issues[0].message).toMatch(/cycle/);
    const leafRoot = applyAgentMessage(create([{ ...kpi, id: "root" }]), null);
    expect(leafRoot.ok).toBe(false);
  });

  it("applies updateComponents as upsert, deletion and prune", () => {
    const current = ok(applyAgentMessage(create(valid), null));
    const updated = ok(
      applyAgentMessage(
        {
          version: "1.0",
          updateComponents: {
            surfaceId: "dashboard",
            title: "Neu",
            deleteIds: ["k1"],
            components: [
              { id: "root", component: "Column", children: ["t"] },
              {
                id: "t",
                component: "Table",
                title: "Top 10",
                rows: {
                  "@call": "locations",
                  args: { sortBy: "exposure", limit: 10 },
                },
              },
            ],
          },
        },
        current,
      ),
    );
    expect(updated.title).toBe("Neu");
    expect(updated.components.map((c) => c.id)).toEqual(["root", "t"]);
    // Without a surface there is nothing to update.
    expect(
      applyAgentMessage(
        {
          version: "1.0",
          updateComponents: { surfaceId: "x", components: [kpi] },
        },
        null,
      ).ok,
    ).toBe(false);
  });

  it("builds a valid starter template", () => {
    const surface = defaultDashboardSurface({
      title: "Überblick",
      count: "Standorte",
      eal: "Hagel-EAL",
      exposure: "Exposure",
      vehicles: "Fahrzeuge",
      byZone: "Je Zone",
      topEal: "Top EAL",
      table: "Tabelle",
    });
    expect(surfaceIssues(surface.components)).toEqual([]);
    expect(surface.components).toHaveLength(10);
  });
});
