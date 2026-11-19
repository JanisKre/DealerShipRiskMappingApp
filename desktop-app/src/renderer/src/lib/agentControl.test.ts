import { describe, expect, it, vi } from "vitest";
import type { AnalyzedDealership } from "@shared/types";
import {
  executeAgentCommand,
  readWindowState,
  type ControlDeps,
} from "./agentControl";

function site(id: string, name: string, analysed = true): AnalyzedDealership {
  return {
    id,
    name,
    address: "Hauptstraße 1, 01067 Dresden",
    notes: "GEHEIM",
    lat: 51,
    lon: 13,
    ...(analysed
      ? {
          risk: {
            overallScore: 1,
            perils: [],
            eal: 1,
            computedAt: "2026-11-01T00:00:00Z",
          },
        }
      : {}),
  } as AnalyzedDealership;
}

function window(overrides: Partial<ReturnType<ControlDeps["app"]>> = {}): {
  deps: ControlDeps;
  app: ReturnType<ControlDeps["app"]>;
  route: () => string;
  details: () => string | null;
} {
  let route = "/dashboard";
  let details: string | null = null;
  const app: ReturnType<ControlDeps["app"]> = {
    sessionId: "p1",
    sessionName: "Bayern",
    dealerships: [
      site("a", "Autohaus Alpha"),
      site("b", "Autohaus Beta"),
      site("c", "Autohaus Gamma", false),
    ],
    selectedId: null,
    analyzing: false,
    progress: null,
    pendingAnalysis: [],
    analysisErrors: {},
    switchSession: vi.fn(async (id: string) => {
      app.sessionId = id;
      app.sessionName = "Sachsen";
    }),
    select: vi.fn((id: string | null) => {
      app.selectedId = id;
    }),
    reanalyzeDealerships: vi.fn(async () => {
      app.analyzing = true;
    }),
    resumeAnalysis: vi.fn(async () => undefined),
    retryFailedAnalyses: vi.fn(async () => undefined),
    cancelAnalysis: vi.fn(),
    ...overrides,
  };
  return {
    app,
    route: () => route,
    details: () => details,
    deps: {
      app: () => app,
      isSaved: () => true,
      detailDialogId: () => details,
      openDetailDialog: (id) => {
        details = id;
      },
      pathname: () => route,
      navigate: (next) => {
        route = next;
      },
      listPortfolios: async () => [{ id: "p1" }, { id: "p2" }],
    },
  };
}

describe("remote control in the window", () => {
  it("reports what is open without notes, addresses or coordinates", () => {
    const { deps, app } = window({ selectedId: "b" });
    const state = readWindowState(deps);
    expect(state).toMatchObject({
      view: "dashboard",
      portfolio: { id: "p1", name: "Bayern", locations: 3, analyzed: 2 },
      selectedLocation: { id: "b", name: "Autohaus Beta" },
    });
    const text = JSON.stringify(state);
    expect(text).not.toContain("GEHEIM");
    expect(text).not.toContain("Hauptstraße");
    expect(text).not.toContain(String(app.dealerships[0].lat));
  });

  it("opens a saved portfolio and refuses an unknown one", async () => {
    const { deps, app } = window();
    const opened = await executeAgentCommand(
      { type: "openPortfolio", portfolioId: "p2" },
      deps,
    );
    expect(app.switchSession).toHaveBeenCalledWith("p2");
    expect(opened).toMatchObject({
      ok: true,
      state: { portfolio: { id: "p2", name: "Sachsen" } },
    });
    expect(
      await executeAgentCommand(
        { type: "openPortfolio", portfolioId: "nope" },
        deps,
      ),
    ).toMatchObject({ ok: false, error: "unknownPortfolio" });
  });

  it("does not switch the portfolio under a running analysis", async () => {
    const { deps, app } = window({ analyzing: true });
    expect(
      await executeAgentCommand(
        { type: "openPortfolio", portfolioId: "p2" },
        deps,
      ),
    ).toEqual({ ok: false, error: "analysisRunning" });
    expect(app.switchSession).not.toHaveBeenCalled();
  });

  it("shows a location by name on the map page, with its details on request", async () => {
    const { deps, app, route, details } = window();
    const result = await executeAgentCommand(
      { type: "showLocation", location: "autohaus beta", details: true },
      deps,
    );
    expect(app.select).toHaveBeenCalledWith("b");
    expect(route()).toBe("/");
    expect(details()).toBe("b");
    expect(result).toMatchObject({
      ok: true,
      state: { view: "map", selectedLocation: { id: "b" } },
    });
    expect(
      await executeAgentCommand(
        { type: "showLocation", location: "Autohaus Omega", details: false },
        deps,
      ),
    ).toMatchObject({ ok: false, error: "unknownLocation" });
  });

  it("changes the page", async () => {
    const { deps, route } = window();
    const result = await executeAgentCommand(
      { type: "openView", view: "settings" },
      deps,
    );
    expect(route()).toBe("/settings");
    expect(result).toMatchObject({ ok: true, state: { view: "settings" } });
  });

  it("analyses the locations without a result by default", async () => {
    const { deps, app } = window();
    const result = await executeAgentCommand(
      { type: "startAnalysis", scope: "unanalysed" },
      deps,
    );
    expect(app.reanalyzeDealerships).toHaveBeenCalledWith(["c"]);
    expect(result).toMatchObject({ ok: true, started: 1 });
  });

  it("continues an interrupted import before anything else", async () => {
    const { deps, app } = window({
      pendingAnalysis: [{ id: "x", name: "Neu", lat: 0, lon: 0 }],
    });
    const result = await executeAgentCommand(
      { type: "startAnalysis", scope: "unanalysed" },
      deps,
    );
    expect(app.resumeAnalysis).toHaveBeenCalled();
    expect(app.reanalyzeDealerships).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, started: 1 });
  });

  it("analyses named locations again and names the one it cannot find", async () => {
    const { deps, app } = window();
    expect(
      await executeAgentCommand(
        {
          type: "startAnalysis",
          locations: ["a", "Autohaus Omega"],
          scope: "unanalysed",
        },
        deps,
      ),
    ).toEqual({
      ok: false,
      error: "unknownLocation",
      detail: "Autohaus Omega",
    });
    expect(app.reanalyzeDealerships).not.toHaveBeenCalled();
    const result = await executeAgentCommand(
      {
        type: "startAnalysis",
        locations: ["a", "Autohaus Alpha", "b"],
        scope: "unanalysed",
      },
      deps,
    );
    expect(app.reanalyzeDealerships).toHaveBeenCalledWith(["a", "b"]);
    expect(result).toMatchObject({ ok: true, started: 2 });
  });

  it("says when there is nothing to analyse and never starts a second run", async () => {
    const done = window({ dealerships: [site("a", "Autohaus Alpha")] });
    expect(
      await executeAgentCommand(
        { type: "startAnalysis", scope: "unanalysed" },
        done.deps,
      ),
    ).toEqual({ ok: false, error: "nothingToAnalyse" });
    const busy = window({ analyzing: true });
    expect(
      await executeAgentCommand(
        { type: "startAnalysis", scope: "all" },
        busy.deps,
      ),
    ).toEqual({ ok: false, error: "analysisRunning" });
    expect(busy.app.reanalyzeDealerships).not.toHaveBeenCalled();
  });

  it("stops a running analysis only", async () => {
    const idle = window();
    expect(
      await executeAgentCommand({ type: "stopAnalysis" }, idle.deps),
    ).toEqual({ ok: false, error: "noAnalysisRunning" });
    const busy = window({ analyzing: true });
    await executeAgentCommand({ type: "stopAnalysis" }, busy.deps);
    expect(busy.app.cancelAnalysis).toHaveBeenCalled();
  });
});
