import {
  APP_VIEW_ROUTES,
  resolveLocationRef,
  viewOfRoute,
  type AgentCommand,
  type AgentCommandResult,
  type AppState as WindowState,
} from "@shared/agent-control";
import type { AppState } from "@renderer/store/appStore";

/**
 * Carries out a remote-control command from the agent gateway (MCP) in the
 * window, with the same store actions the buttons use. Kept free of React
 * and of the stores themselves so it is unit-tested on its own; the bridge
 * component (`AgentControlBridge`) supplies the live stores and the router.
 *
 * Nothing here takes a path, a URL or free text: a command names a saved
 * portfolio, locations of the open portfolio and a page.
 */

type AppActions = Pick<
  AppState,
  | "sessionId"
  | "sessionName"
  | "dealerships"
  | "selectedId"
  | "analyzing"
  | "progress"
  | "pendingAnalysis"
  | "analysisErrors"
  | "switchSession"
  | "select"
  | "reanalyzeDealerships"
  | "resumeAnalysis"
  | "retryFailedAnalyses"
  | "cancelAnalysis"
>;

export interface ControlDeps {
  /** Current state and actions of the app store. */
  app: () => AppActions;
  /** Whether the open portfolio is saved and unchanged since. */
  isSaved: () => boolean;
  detailDialogId: () => string | null;
  openDetailDialog: (id: string) => void;
  pathname: () => string;
  navigate: (route: string) => void;
  listPortfolios: () => Promise<Array<{ id: string }>>;
}

export function readWindowState(deps: ControlDeps): WindowState {
  const s = deps.app();
  const selected = s.dealerships.find((d) => d.id === s.selectedId);
  return {
    view: viewOfRoute(deps.pathname()),
    portfolio: {
      id: s.sessionId,
      name: s.sessionName.slice(0, 300),
      locations: s.dealerships.length,
      analyzed: s.dealerships.filter((d) => d.risk != null).length,
      saved: deps.isSaved(),
    },
    selectedLocation: selected
      ? { id: selected.id, name: selected.name.slice(0, 300) }
      : null,
    detailsOpenFor: deps.detailDialogId(),
    analysis: {
      running: s.analyzing,
      done: s.progress?.done ?? 0,
      total: s.progress?.total ?? 0,
      waiting: s.analyzing ? 0 : s.pendingAnalysis.length,
      failed: Object.keys(s.analysisErrors).length,
      startedAt: s.progress?.startedAt ?? 0,
    },
  };
}

/** A started run reports its own errors in the app; here it must not reject. */
function inBackground(run: Promise<unknown>): void {
  run.catch((error: unknown) => {
    console.error("Analysis started by remote control failed:", error);
  });
}

export async function executeAgentCommand(
  command: AgentCommand,
  deps: ControlDeps,
): Promise<AgentCommandResult> {
  const done = (started?: number): AgentCommandResult => ({
    ok: true,
    state: readWindowState(deps),
    ...(started == null ? {} : { started }),
  });
  const s = deps.app();
  switch (command.type) {
    case "getState":
      return done();

    case "openPortfolio": {
      if (command.portfolioId === s.sessionId) return done();
      if (s.analyzing) return { ok: false, error: "analysisRunning" };
      const saved = await deps.listPortfolios();
      if (!saved.some((p) => p.id === command.portfolioId)) {
        return {
          ok: false,
          error: "unknownPortfolio",
          detail: command.portfolioId.slice(0, 300),
        };
      }
      await s.switchSession(command.portfolioId);
      // The portfolio could not be loaded although it is listed.
      if (deps.app().sessionId !== command.portfolioId) {
        return { ok: false, error: "failed" };
      }
      return done();
    }

    case "showLocation": {
      const match = resolveLocationRef(s.dealerships, command.location);
      if ("error" in match) {
        return {
          ok: false,
          error: match.error,
          detail: command.location.slice(0, 300),
        };
      }
      // The map and the detail dialog live on the workspace page.
      if (viewOfRoute(deps.pathname()) !== "map") {
        deps.navigate(APP_VIEW_ROUTES.map);
      }
      s.select(match.found.id);
      if (command.details) deps.openDetailDialog(match.found.id);
      return done();
    }

    case "openView":
      deps.navigate(APP_VIEW_ROUTES[command.view]);
      return done();

    case "startAnalysis": {
      if (s.analyzing) return { ok: false, error: "analysisRunning" };
      if (command.locations) {
        const ids = new Set<string>();
        for (const ref of command.locations) {
          const match = resolveLocationRef(s.dealerships, ref);
          if ("error" in match) {
            return { ok: false, error: match.error, detail: ref.slice(0, 300) };
          }
          ids.add(match.found.id);
        }
        inBackground(s.reanalyzeDealerships([...ids]));
        return done(ids.size);
      }
      if (command.scope === "all") {
        if (s.dealerships.length === 0) {
          return { ok: false, error: "nothingToAnalyse" };
        }
        inBackground(s.reanalyzeDealerships(s.dealerships.map((d) => d.id)));
        return done(s.dealerships.length);
      }
      // Unanalysed: an interrupted import first, then failed locations,
      // then locations that never got a result.
      if (s.pendingAnalysis.length > 0) {
        const waiting = s.pendingAnalysis.length;
        inBackground(s.resumeAnalysis());
        return done(waiting);
      }
      const failed = Object.keys(s.analysisErrors).length;
      if (failed > 0) {
        inBackground(s.retryFailedAnalyses());
        return done(failed);
      }
      const open = s.dealerships.filter((d) => d.risk == null).map((d) => d.id);
      if (open.length === 0) return { ok: false, error: "nothingToAnalyse" };
      inBackground(s.reanalyzeDealerships(open));
      return done(open.length);
    }

    case "stopAnalysis":
      if (!s.analyzing) return { ok: false, error: "noAnalysisRunning" };
      s.cancelAnalysis();
      return done();
  }
}
