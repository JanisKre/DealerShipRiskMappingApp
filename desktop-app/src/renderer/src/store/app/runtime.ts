import type {
  AnalyzedDealership,
  DealershipInput,
  RiskParameters,
  Session,
} from "@shared/types";
import { DEFAULT_RISK_PARAMETERS } from "@shared/parameters";
import { type AppState, type StoreSet } from "./types";
import {
  EMPTY_FILTERS,
  DEFAULT_PORTFOLIO_NAME,
  withoutKey,
  errorMessage,
  createCoalescedSaver,
  withChange,
  analyzedChange,
} from "./helpers";

/**
 * Bumped whenever another portfolio becomes the active one. Work started
 * for the previous portfolio (a batch analysis, a re-analysis, a parameter
 * rescore) compares it before writing its result back and drops the result
 * when it changed, so it can never land in the portfolio opened meanwhile.
 */
let generationCounter = 0;

/** The generation of the active portfolio (see above). */
export const portfolioGeneration = (): number => generationCounter;

/**
 * Locations removed by the user. A batch still analysing one of them drops
 * its result instead of adding the location again; a new batch for the same
 * id clears the mark.
 */
export const removedIds = new Set<string>();

/** How often a vehicle detection follows a boundary edited while it ran. */
export const DETECTION_BOUNDARY_ATTEMPTS = 3;

/** Detaches running work from the portfolio that is being left. */
function abandonRunningAnalysis(): void {
  generationCounter += 1;
  removedIds.clear();
}

/**
 * Whether leaving the active portfolio has to save it first: it has
 * locations, or it is stored already (its last location may just have been
 * deleted, and that must not be undone by leaving it).
 */
export function hasPortfolioToSave(s: AppState): boolean {
  return s.dealerships.length > 0 || s.sessionId != null;
}

/**
 * The parts of the state a saved session holds, by reference: the store
 * replaces them on every change, so equal references mean nothing changed.
 */
interface SavedSnapshot {
  sessionId: string | null;
  sessionName: string;
  dealerships: AppState["dealerships"];
  parameters: AppState["parameters"];
  pendingAnalysis: AppState["pendingAnalysis"];
  boundaryHistory: AppState["boundaryHistory"];
  boundaryEditIds: AppState["boundaryEditIds"];
}

/** State as last loaded or saved; `null` before either happened. */
let savedSnapshot: SavedSnapshot | null = null;

/** Records what was last written to disk. */
export function setSavedSnapshot(snapshot: SavedSnapshot | null): void {
  savedSnapshot = snapshot;
}

export function snapshotOf(s: AppState): SavedSnapshot {
  return {
    sessionId: s.sessionId,
    sessionName: s.sessionName,
    dealerships: s.dealerships,
    parameters: s.parameters,
    pendingAnalysis: s.pendingAnalysis,
    boundaryHistory: s.boundaryHistory,
    boundaryEditIds: s.boundaryEditIds,
  };
}

/** Whether the open portfolio is saved and unchanged since. */
export function isSavedState(s: AppState): boolean {
  const saved = savedSnapshot;
  if (!saved || s.sessionId == null || saved.sessionId !== s.sessionId)
    return false;
  const now = snapshotOf(s);
  return (Object.keys(now) as (keyof SavedSnapshot)[]).every(
    (key) => now[key] === saved[key],
  );
}

/** Makes a loaded session the open portfolio (switching, after a delete). */
export function applyLoadedSession(
  set: (partial: Partial<AppState>) => void,
  get: () => AppState,
  session: Session,
): void {
  // A batch of the portfolio being left was saved as pending and can be
  // resumed there; its late results must not land in this one.
  abandonRunningAnalysis();
  set({
    sessionId: session.id,
    sessionName: session.name,
    sessionSnapshotOf: session.snapshotOf ?? null,
    selectedId: null,
    analyzing: false,
    progress: null,
    analyzingIds: [],
    lastSavedAt: null,
    saveError: null,
    scenario: null,
    nlQueryMatchedIds: null,
    filters: EMPTY_FILTERS,
    pendingAnalysis: session.pendingAnalysis ?? [],
    ...restoredPendingErrors(session),
  });
  get().setDealerships(session.dealerships, session.boundaryEdits);
  get().setParameters(session.parameters, {
    revision: session.parametersRevision,
  });
  get().markSaved();
}

/** Shared by `newPortfolio` and `deleteSavedSession` (when deleting the active one). */
export function resetToBlankPortfolio(
  set: (partial: Partial<AppState>) => void,
  get: () => AppState,
): void {
  abandonRunningAnalysis();
  set({
    sessionId: null,
    sessionName: DEFAULT_PORTFOLIO_NAME,
    sessionSnapshotOf: null,
    selectedId: null,
    analyzing: false,
    progress: null,
    analysisCancelRequested: false,
    analyzingIds: [],
    lastAddedIds: [],
    mapFocusIds: null,
    mapFocusRadiusKm: null,
    lastSavedAt: null,
    saveError: null,
    lastImportReport: null,
    scenario: null,
    nlQueryMatchedIds: null,
    filters: EMPTY_FILTERS,
    pendingAnalysis: [],
  });
  get().setDealerships([]);
  get().setParameters(DEFAULT_RISK_PARAMETERS);
}

/**
 * Keeps an edit that was not saved yet (and its undo steps) on disk. Saving
 * still re-runs the car detection; this only protects the draft.
 */
export async function saveBoundaryDraft(get: () => AppState): Promise<void> {
  await get()
    .saveSession()
    .catch((err: unknown) => {
      console.error("Keeping the boundary edit failed:", err);
    });
}

/**
 * Locations analysed at once. Each analysis is mostly waiting on remote
 * services (boundary sources, imagery, hazard APIs), so a few in parallel cut
 * a 500-row import from many hours to a fraction of that; main paces the
 * shared public services (`http.service.ts` host gates) so this stays within
 * their fair-use limits.
 */
const ANALYSIS_CONCURRENCY = 3;

export async function runAnalysisQueue(
  inputs: DealershipInput[],
  set: StoreSet,
  get: () => AppState,
): Promise<void> {
  let next = 0;
  let done = 0;
  // Results are written back only while this portfolio stays open.
  const generation = portfolioGeneration();
  const stillOpen = (): boolean => generation === portfolioGeneration();
  for (const input of inputs) removedIds.delete(input.id);
  const checkpoint = createCoalescedSaver(
    () => (stillOpen() ? get().saveSession() : Promise.resolve()),
    (err) => console.error("Analysis checkpoint save failed:", err),
  );
  // Everything of this batch counts as pending until it succeeds; earlier
  // pending inputs (another interrupted batch) are kept.
  set((s) => {
    const ids = new Set(inputs.map((input) => input.id));
    return {
      pendingAnalysis: [
        ...s.pendingAnalysis.filter((input) => !ids.has(input.id)),
        ...inputs,
      ],
    };
  });

  async function worker(): Promise<void> {
    while (
      next < inputs.length &&
      !get().analysisCancelRequested &&
      stillOpen()
    ) {
      const input = inputs[next++];
      if (removedIds.has(input.id)) continue;
      // While this one runs, the next location's tiles load into the cache.
      const upcoming = inputs[next];
      if (upcoming?.lat != null && upcoming.lon != null) {
        void window.api
          .prefetchImagery(upcoming.lat, upcoming.lon)
          .catch(() => undefined);
      }
      set((s) => ({
        analyzingIds: [...s.analyzingIds, input.id],
        analysisErrors: withoutKey(s.analysisErrors, input.id),
        failedInputs: withoutKey(s.failedInputs, input.id),
      }));
      try {
        const result = await window.api.analyzeDealership(
          input,
          get().parameters,
        );
        if (!stillOpen()) return;
        // Deleted while it was analysed: leave it deleted.
        if (!removedIds.has(input.id)) {
          // A retried location keeps its site answers.
          const kept = get().dealerships.find((d) => d.id === input.id);
          get().upsertDealership(
            withChange(
              kept?.siteAnswers
                ? { ...result, siteAnswers: kept.siteAnswers }
                : result,
              analyzedChange(result),
            ),
          );
        }
        set((s) => ({
          pendingAnalysis: s.pendingAnalysis.filter((p) => p.id !== input.id),
        }));
      } catch (err) {
        if (!stillOpen()) return;
        const message = errorMessage(err);
        console.error(`Analysis failed for ${input.name}:`, err);
        if (!removedIds.has(input.id)) {
          set((s) => ({
            analysisErrors: { ...s.analysisErrors, [input.id]: message },
            failedInputs: { ...s.failedInputs, [input.id]: input },
          }));
        }
      }
      done++;
      set((s) => ({
        analyzingIds: s.analyzingIds.filter((id) => id !== input.id),
        progress: s.progress ? { ...s.progress, done } : s.progress,
      }));
      if (stillOpen()) checkpoint.request();
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(ANALYSIS_CONCURRENCY, inputs.length) }, () =>
      worker(),
    ),
  );
  await checkpoint.flush();
  // The portfolio that was opened meanwhile has its own analysis state.
  if (!stillOpen()) return;
  // Inputs not analysed yet stay pending, also after "Stop": rows without
  // coordinates are on neither the map nor the list otherwise and would
  // vanish. The resume notice offers to continue or discard them.
  set({
    analyzing: false,
    analyzingIds: [],
    analysisCancelRequested: false,
  });
}

/**
 * Rescores a portfolio with bounded concurrency. Parameter changes used to
 * start one network-heavy weather/risk pipeline per location at once, which
 * could make Electron unresponsive for larger portfolios.
 */
export async function rescoreWithConcurrency(
  dealerships: AnalyzedDealership[],
  parameters: RiskParameters,
  concurrency: number,
): Promise<Array<{ id: string; risk: AnalyzedDealership["risk"] }>> {
  const updates: Array<{ id: string; risk: AnalyzedDealership["risk"] }> = [];
  let next = 0;
  async function worker(): Promise<void> {
    while (next < dealerships.length) {
      const dealership = dealerships[next++];
      try {
        const risk = await window.api.scoreRisk(
          dealership.lat,
          dealership.lon,
          dealership.assetValue,
          dealership.detection,
          dealership.boundary,
          parameters,
          dealership.natCat,
          dealership.hailZone,
        );
        updates.push({ id: dealership.id, risk });
      } catch (err) {
        console.error(`Parameter rescore failed for ${dealership.name}:`, err);
      }
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), dealerships.length) },
      () => worker(),
    ),
  );
  return updates;
}

/**
 * Failed queued inputs as they were before the app closed: the error and
 * the input, so the list says "not found" instead of "queued" and the
 * resume notice does not count them as interrupted.
 */
export function restoredPendingErrors(session: {
  pendingAnalysis?: DealershipInput[];
  pendingErrors?: Record<string, string>;
}): {
  analysisErrors: Record<string, string>;
  failedInputs: Record<string, DealershipInput>;
} {
  const errors = session.pendingErrors ?? {};
  const failed = (session.pendingAnalysis ?? []).filter((i) => errors[i.id]);
  return {
    analysisErrors: Object.fromEntries(failed.map((i) => [i.id, errors[i.id]])),
    failedInputs: Object.fromEntries(failed.map((i) => [i.id, i])),
  };
}
