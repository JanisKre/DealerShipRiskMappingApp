import { pickActiveSession } from "@renderer/lib/portfolioSessions";
import { mergePortfolios } from "@shared/portfolio-merge";
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
import { boundaryEditsOf } from "./helpers";

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
        ...(s.pendingAnalysis.length > 0
          ? { pendingAnalysis: s.pendingAnalysis }
          : {}),
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
      set({ sessionName: session.name });
      get().setDealerships(session.dealerships, session.boundaryEdits);
      get().setParameters(session.parameters);
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
      await window.api.saveSession(session);
      set({
        sessionId: session.id,
        sessionName: session.name,
        lastSavedAt: session.updatedAt,
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
