import { pickActiveSession } from "@renderer/lib/portfolioSessions";
import { mergePortfolios } from "@shared/portfolio-merge";
import { PARAMETERS_REVISION } from "@shared/parameters";
import { type AppState, type StoreSet } from "./types";
import {
  hasPortfolioToSave,
  setSavedSnapshot,
  snapshotOf,
  isSavedState,
  applyLoadedSession,
  resetToBlankPortfolio,
  rescoreWithConcurrency,
} from "./runtime";
import { boundaryEditsOf, errorMessage } from "./helpers";

/** Opening, switching, renaming, merging and saving portfolios. */
export function sessionActions(
  set: StoreSet,
  get: () => AppState,
): Pick<
  AppState,
  | "setSession"
  | "newPortfolio"
  | "switchSession"
  | "renameSavedSession"
  | "deleteSavedSession"
  | "setSessionName"
  | "setImportReport"
  | "setDealerships"
  | "currentSession"
  | "openImportedSession"
  | "mergeSession"
  | "saveSession"
  | "saveSessionIfChanged"
  | "markSaved"
> {
  return {
    setSession: (id, name) => set({ sessionId: id, sessionName: name }),

    newPortfolio: async () => {
      if (hasPortfolioToSave(get())) {
        await get()
          .saveSessionIfChanged()
          .catch((err: unknown) => {
            console.error(
              "Saving the current portfolio before starting a new one failed:",
              err,
            );
          });
      }
      resetToBlankPortfolio(set, get);
    },

    switchSession: async (id) => {
      if (get().sessionId === id) return;
      if (hasPortfolioToSave(get())) {
        await get()
          .saveSessionIfChanged()
          .catch((err: unknown) => {
            console.error(
              "Saving the current portfolio before switching failed:",
              err,
            );
          });
      }
      const session = await window.api.loadSession(id);
      if (!session) return;
      applyLoadedSession(set, get, session);
    },

    renameSavedSession: async (id, name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      if (id === get().sessionId) {
        set({ sessionName: trimmed });
        await get().saveSession();
        return;
      }
      const session = await window.api.loadSession(id);
      if (!session) return;
      await window.api.saveSession({ ...session, name: trimmed });
    },

    deleteSavedSession: async (id) => {
      await window.api.deleteSession(id);
      if (get().sessionId !== id) return null;
      // Carry on with the most recent remaining portfolio rather than an empty
      // one (the list is sorted most recent first).
      // A saved state is never opened in its place (UW-09).
      const remaining = await window.api.listSessions().catch(() => []);
      const next = pickActiveSession(remaining, id);
      const session = next
        ? await window.api.loadSession(next.id).catch(() => null)
        : null;
      if (!session) {
        resetToBlankPortfolio(set, get);
        return null;
      }
      applyLoadedSession(set, get, session);
      return session.name;
    },

    setSessionName: (name) => set({ sessionName: name }),

    setImportReport: (lastImportReport) => set({ lastImportReport }),

    setDealerships: (dealerships, boundaryEdits) => {
      const ids = new Set(dealerships.map((d) => d.id));
      const edits = Object.entries(boundaryEdits ?? {}).filter(([id]) =>
        ids.has(id),
      );
      const unsavedIds = edits
        .filter(([, edit]) => edit.unsaved)
        .map(([id]) => id);
      set({
        dealerships,
        boundaryEditIds: unsavedIds,
        boundaryHistory: Object.fromEntries(
          edits
            .filter(([, edit]) => edit.history.length > 0)
            .map(([id, edit]) => [id, edit.history]),
        ),
        // An edit saved before the car count was updated still needs it.
        pendingBoundaryDetectionIds: unsavedIds,
        detectionUpdateIds: [],
        detectionUpdateErrors: {},
        analysisErrors: {},
        failedInputs: {},
        analysisCancelRequested: false,
      });
    },

    currentSession: () => {
      const s = get();
      const now = new Date().toISOString();
      return {
        id: s.sessionId ?? crypto.randomUUID(),
        name: s.sessionName,
        createdAt: now,
        updatedAt: now,
        dealerships: s.dealerships,
        parameters: s.parameters,
        parametersRevision: PARAMETERS_REVISION,
        ...(s.pendingAnalysis.length > 0
          ? { pendingAnalysis: s.pendingAnalysis }
          : {}),
        ...pendingErrorsOf(s),
        ...(s.sessionSnapshotOf ? { snapshotOf: s.sessionSnapshotOf } : {}),
        ...boundaryEditsOf(s),
      };
    },

    openImportedSession: async (session) => {
      if (hasPortfolioToSave(get())) {
        await get()
          .saveSession()
          .catch((err: unknown) => {
            console.error(
              "Saving the current portfolio before opening a file failed:",
              err,
            );
          });
      }
      resetToBlankPortfolio(set, get);
      // A file without a name keeps the name of a new portfolio.
      if (session.name.trim()) set({ sessionName: session.name.trim() });
      get().setDealerships(session.dealerships, session.boundaryEdits);
      get().setParameters(session.parameters, {
        revision: session.parametersRevision,
      });
      // Rows the other side had not located yet come along and are offered
      // for resuming, as after a restart.
      set({ pendingAnalysis: session.pendingAnalysis ?? [] });
      await get().saveSession();
    },

    mergeSession: async (session) => {
      const result = mergePortfolios(get().dealerships, session.dealerships);
      set({ dealerships: result.dealerships });
      // Merged data was scored under the other portfolio's parameters.
      const changedIds = new Set([...result.addedIds, ...result.updatedIds]);
      const changed = get().dealerships.filter((d) => changedIds.has(d.id));
      if (changed.length > 0) {
        const updates = await rescoreWithConcurrency(
          changed,
          get().parameters,
          4,
        );
        set((s) => ({
          dealerships: s.dealerships.map((d) => {
            const update = updates.find((x) => x.id === d.id);
            return update ? { ...d, risk: update.risk } : d;
          }),
        }));
      }
      await get().saveSession();
      return result;
    },

    saveSession: async () => {
      const snapshot = snapshotOf(get());
      const session = get().currentSession();
      try {
        await window.api.saveSession(session);
      } catch (err) {
        // Shown in the header: a failed autosave must not look like a save.
        set({ saveError: errorMessage(err) });
        throw err;
      }
      set({
        sessionId: session.id,
        sessionName: session.name,
        lastSavedAt: session.updatedAt,
        saveError: null,
      });
      setSavedSnapshot({ ...snapshot, sessionId: session.id });
    },

    saveSessionIfChanged: async () => {
      if (isSavedState(get())) return;
      await get().saveSession();
    },

    markSaved: () => {
      setSavedSnapshot(snapshotOf(get()));
    },
  };
}

/** Errors of queued inputs, kept with the session (see `pendingErrors`). */
function pendingErrorsOf(s: {
  pendingAnalysis: { id: string }[];
  analysisErrors: Record<string, string>;
}): { pendingErrors?: Record<string, string> } {
  const queued = new Set(s.pendingAnalysis.map((input) => input.id));
  const entries = Object.entries(s.analysisErrors)
    .filter(([id]) => queued.has(id))
    .map(([id, message]) => [id, message.slice(0, 500)] as const);
  return entries.length > 0
    ? { pendingErrors: Object.fromEntries(entries) }
    : {};
}
