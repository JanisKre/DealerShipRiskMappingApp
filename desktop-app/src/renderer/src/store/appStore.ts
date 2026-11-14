import { create } from "zustand";
import { DEALERSHIP_HISTORY_MAX } from "@shared/constants";
import { BOUNDARY_UNDO_LIMIT } from "@shared/types";
import type {
  AnalyzedDealership,
  BoundaryEditState,
  BoundaryResult,
  DealershipInput,
  HailstormScenario,
  ImportReport,
  NlQueryDealership,
  ManualVehiclePoint,
  RiskParameters,
  Session,
  DealershipChange,
} from "@shared/types";
import {
  DEFAULT_RISK_PARAMETERS,
  normalizeRiskParameters,
} from "@shared/parameters";
import { boundaryNeedsReview } from "@shared/boundary-review";
import { dedupeDealerships } from "@shared/dedupe";
import {
  mergePortfolios,
  type PortfolioMergeResult,
} from "@shared/portfolio-merge";
import { dealershipHailZone, effectiveVehicleCount } from "@shared/risk-math";
import { attachVehicleTimeline } from "@shared/vehicle-timeline";
import { isUserWebsiteSource, normalizeWebsiteUrl } from "@shared/website";

/**
 * Central renderer store. Holds the active portfolio plus derived UI
 * state: hailstorm scenario, comparison session, and an optional NL query
 * hit list (IDs) that filters the dashboard. The chat history lives in a
 * separate store (`conversationStore`, SQLite-persisted).
 */

interface AppState {
  sessionId: string | null;
  sessionName: string;
  dealerships: AnalyzedDealership[];
  parameters: RiskParameters;
  parametersUpdating: boolean;
  selectedId: string | null;
  analyzing: boolean;
  /** Batch progress; `startedAt` (epoch ms) drives the remaining-time estimate. */
  progress: { done: number; total: number; startedAt: number } | null;
  /** Last error per location from a batch analysis. */
  analysisErrors: Record<string, string>;
  /**
   * The input of every failed analysis, by id. A row that never got
   * coordinates is not in `dealerships`, so its name and its retry need it.
   */
  failedInputs: Record<string, DealershipInput>;
  /** Analyses every failed location again (also those never placed on the map). */
  retryFailedAnalyses: () => Promise<void>;
  /** Requests that the current batch stop after the active item. */
  analysisCancelRequested: boolean;
  /**
   * Inputs of the current or an interrupted batch that are not analysed
   * yet. Saved with the session, so a restart can resume the batch.
   */
  pendingAnalysis: DealershipInput[];
  /** Continues an interrupted batch analysis. */
  resumeAnalysis: () => Promise<void>;
  /** Drops an interrupted batch without analysing it. */
  discardPendingAnalysis: () => void;
  /** IDs whose background analysis is currently running (pin feedback). */
  analyzingIds: string[];
  /** Locations whose manually edited boundary has not been re-detected yet. */
  pendingBoundaryDetectionIds: string[];
  /** Locations currently running vehicle detection after a boundary edit. */
  detectionUpdateIds: string[];
  /** Last boundary-detection error per location, shown next to its CTA. */
  detectionUpdateErrors: Record<string, string>;
  /** Locations with unsaved manual boundary edits. */
  boundaryEditIds: string[];
  /** Previous manual boundary states, newest state last. */
  boundaryHistory: Record<string, BoundaryResult[]>;
  /** Most recently added location IDs — drives map focus. */
  lastAddedIds: string[];
  /** Locations the map should fit into view once (e.g. an accumulation). */
  mapFocusIds: string[] | null;
  /** Radius drawn around the focused locations' centre, kept fully in view. */
  mapFocusRadiusKm: number | null;
  /** Timestamp of the last successful save (manual or autosave). */
  lastSavedAt: string | null;
  /** Quality report from the most recent CSV/XLSX import. */
  lastImportReport: ImportReport | null;

  // Map: active hailstorm scenario (corridor) + comparison session
  scenario: HailstormScenario | null;
  comparison: Session | null;

  // NL query: filtered hit IDs highlighted in the dashboard
  nlQueryMatchedIds: string[] | null;

  /** Structured portfolio filters (sub-portfolio, partner, group, cluster). */
  filters: PortfolioFilters;

  setSession: (id: string | null, name: string) => void;
  setSessionName: (name: string) => void;
  /**
   * Saves the current portfolio (if it has locations or is stored) and resets to a
   * fresh, empty, unsaved one — the next `saveSession()` creates a new row
   * rather than overwriting the one just left.
   */
  newPortfolio: () => Promise<void>;
  /**
   * Saves the current portfolio (if it has locations or is stored), then loads a
   * different saved one by id and makes it the active portfolio.
   */
  switchSession: (id: string) => Promise<void>;
  /**
   * Renames any saved portfolio by id — including ones other than the
   * currently active one, for the portfolio-switcher list.
   */
  renameSavedSession: (id: string, name: string) => Promise<void>;
  /**
   * Permanently deletes a saved portfolio by id. If it's the active one,
   * opens the most recent remaining portfolio (or a fresh empty one when
   * none is left) and returns its name; otherwise returns null.
   */
  deleteSavedSession: (id: string) => Promise<string | null>;
  setImportReport: (report: ImportReport | null) => void;
  /**
   * Replaces the portfolio. `boundaryEdits` restores the undo steps and
   * unsaved boundary edits stored with a session.
   */
  setDealerships: (
    d: AnalyzedDealership[],
    boundaryEdits?: Record<string, BoundaryEditState>,
  ) => void;
  setParameters: (parameters?: Partial<RiskParameters> | null) => void;
  updateParameters: (patch: Partial<RiskParameters>) => Promise<void>;
  resetParameters: () => Promise<void>;
  upsertDealership: (d: AnalyzedDealership) => void;
  updateBoundary: (
    id: string,
    boundary: AnalyzedDealership["boundary"],
  ) => void;
  /**
   * Writes back a (typically manually edited) boundary and rescores the
   * risk — capacity, utilisation, and EAL depend on the area, so a plain
   * area update is not enough.
   */
  updateBoundaryAndRescore: (
    id: string,
    boundary: NonNullable<AnalyzedDealership["boundary"]>,
  ) => Promise<void>;
  /** Re-runs vehicle detection and risk scoring using the current boundary. */
  updateDetectionForBoundary: (id: string) => Promise<void>;
  /**
   * Saves a manual boundary edit and re-runs the car detection for it in one
   * step. The edit stays marked (and the error visible) if detection fails.
   */
  saveBoundaryEdit: (id: string) => Promise<void>;
  /** Marks the detected boundary as visually confirmed, clears its review flag and rescores. */
  confirmBoundary: (id: string) => Promise<void>;
  /** Records that the underwriter checked the location's open review points. */
  markReviewed: (id: string) => Promise<void>;
  /** Restores the previous manual boundary state and rescored risk. */
  undoBoundaryEdit: (id: string) => Promise<void>;
  /** Restores the original boundary from before manual editing started. */
  revertBoundaryToDefault: (id: string) => Promise<void>;
  /** Updates portfolio metadata (insured, partner, group, limit, …). */
  updateDealershipMeta: (
    id: string,
    patch: Partial<
      Pick<
        AnalyzedDealership,
        | "insured"
        | "salesPartner"
        | "subPortfolio"
        | "group"
        | "productLimitEur"
        | "deductibleEur"
      >
    >,
  ) => void;
  /**
   * Saves a location's free-text notes (empty clears them), stamps the
   * change time and persists the session right away.
   */
  updateDealershipNotes: (id: string, notes: string) => Promise<void>;
  /**
   * Stores a location's website and persists the session. `null` clears it
   * (back to automatic lookup). An OSM link never replaces a manual one.
   * Returns false when the URL isn't a usable http(s) website.
   */
  updateDealershipWebsite: (
    id: string,
    website: string | null,
    source: "osm" | "manual",
  ) => Promise<boolean>;
  /** Bulk-sets the insured flag for multiple locations at once. */
  setInsuredForDealerships: (ids: string[], insured: boolean) => void;
  /** Saves an optional human-reviewed vehicle count and recalculates risk. */
  updateManualVehicleCount: (id: string, count: number | null) => Promise<void>;
  /** Persists a completed map-based vehicle review and recalculates risk. */
  saveManualVehicleDetection: (
    id: string,
    count: number,
    points: ManualVehiclePoint[],
    removedPoints: ManualVehiclePoint[],
  ) => Promise<void>;
  /**
   * Counts vehicles on archived Esri images of the lot, stores the result
   * on the detection and rescores, so the hail EAL detail carries the
   * stock range. The point EAL keeps the current count.
   */
  countVehicleTimeline: (id: string) => Promise<void>;
  /**
   * Counts the stock over time for several locations, one after another
   * (each is several detector runs). `onProgress` gets done/total after
   * each; `shouldStop` is checked between locations. Returns how many were
   * counted and how many failed.
   */
  countVehicleTimelines: (
    ids: string[],
    onProgress?: (done: number, total: number) => void,
    shouldStop?: () => boolean,
  ) => Promise<{ counted: number; failed: number }>;
  select: (id: string | null) => void;
  /**
   * Asks the map to fit these locations into view the next time it renders;
   * with `radiusKm`, the whole circle of that radius around their centre.
   */
  focusDealerships: (ids: string[], radiusKm?: number) => void;
  /** Called by the map once it has applied `mapFocusIds`. */
  clearMapFocus: () => void;
  /** Permanently removes a location from the portfolio. */
  removeDealership: (id: string) => void;
  /** Permanently removes multiple locations from the portfolio at once. */
  removeDealerships: (ids: string[]) => void;
  /** Re-analyzes an existing location (recomputes boundary/detection/risk). */
  reanalyzeDealership: (id: string) => Promise<void>;
  /** Re-resolves the routed NatCat sources and rescores one location. */
  refreshNatCat: (id: string) => Promise<void>;
  analyzeAll: (inputs: DealershipInput[]) => Promise<void>;
  cancelAnalysis: () => void;
  /**
   * Adds locations to the portfolio (deduplicated against existing
   * entries), shows them immediately as pins, and analyzes them in the
   * background. Returns the number of skipped duplicates.
   */
  addAndAnalyze: (inputs: DealershipInput[]) => Promise<number>;
  /**
   * Imports an uploaded portfolio file: into a new portfolio named `name`
   * (the current one is saved first) or the current one, with the business
   * type taken from the file or set for every row. Returns the number of
   * skipped duplicates.
   */
  importPortfolio: (options: PortfolioImportOptions) => Promise<number>;

  setScenario: (s: HailstormScenario | null) => void;
  setComparison: (s: Session | null) => void;
  setNlQueryMatchedIds: (ids: string[] | null) => void;
  setFilters: (patch: Partial<PortfolioFilters>) => void;
  resetFilters: () => void;

  /** Opens a portfolio file as a new, separate portfolio. */
  openImportedSession: (session: Session) => Promise<void>;
  /**
   * Merges a portfolio file into the open one (added locations, edited
   * boundaries) and rescores what changed with the current parameters.
   */
  mergeSession: (session: Session) => Promise<PortfolioMergeResult>;

  currentSession: () => Session;
  /** Persists the current session in SQLite (manually or via autosave). */
  saveSession: () => Promise<void>;
  /**
   * Like `saveSession`, but skips a saved portfolio nothing changed in since
   * it was loaded or saved — switching portfolios or an idle autosave must
   * not bump its "last changed" time.
   */
  saveSessionIfChanged: () => Promise<void>;
  /** Records the current state as saved (after loading a session). */
  markSaved: () => void;
}

/** How an import classifies its rows as existing or new business. */
export type ImportBusinessMode = "file" | "existing" | "new";

export interface PortfolioImportOptions {
  rows: DealershipInput[];
  target: "new" | "current";
  /**
   * Name of the new portfolio. For `target: "current"` it only names an
   * empty current portfolio (the first import of a fresh start).
   */
  name: string;
  business: ImportBusinessMode;
  /** Parser report, kept for the import-quality notice. */
  report?: ImportReport;
}

/**
 * Applies the import's business classification: `file` keeps each row's
 * own value (unknown stays unknown), otherwise every row is set.
 */
export function applyBusinessClassification(
  rows: DealershipInput[],
  mode: ImportBusinessMode,
): DealershipInput[] {
  if (mode === "file") return rows;
  const insured = mode === "existing";
  return rows.map((row) => ({ ...row, insured }));
}

/** Existing business = marked insured; everything else counts as new business. */
export function businessType(d: { insured?: boolean }): "existing" | "new" {
  return d.insured === true ? "existing" : "new";
}

/** Active portfolio filters. `null`/`undefined` = no restriction. */
export interface PortfolioFilters {
  /** Existing vs. new business. */
  business: "existing" | "new" | null;
  subPortfolio: string | null;
  salesPartner: string | null;
  group: string | null;
  clusterId: string | null;
  boundarySource: "fallback" | null;
  /** Hail zone 1–6, or "none" for locations without a zone yet. */
  hailZone: number | "none" | null;
  /** Where a location stands: analysed, still to analyse, or to check. */
  status: LocationStatus | null;
}

/** Processing state of a location, for filtering large portfolios. */
export type LocationStatus = "analyzed" | "pending" | "review";

export function locationStatus(d: {
  risk?: unknown;
  boundary?: { reviewRequired?: boolean };
}): "analyzed" | "pending" {
  return d.risk ? "analyzed" : "pending";
}

const EMPTY_FILTERS: PortfolioFilters = {
  business: null,
  subPortfolio: null,
  salesPartner: null,
  group: null,
  clusterId: null,
  boundarySource: null,
  hailZone: null,
  status: null,
};

/**
 * Everything still to analyse: the saved queue plus every location without
 * a result, so an analysis cut short (reload, crash) can always continue.
 */
export function unanalyzedInputs(s: {
  pendingAnalysis: DealershipInput[];
  dealerships: AnalyzedDealership[];
}): DealershipInput[] {
  const byId = new Map(s.pendingAnalysis.map((input) => [input.id, input]));
  for (const d of s.dealerships)
    if (!d.risk && !byId.has(d.id)) byId.set(d.id, d);
  return [...byId.values()];
}

/** Default name for a freshly created, not-yet-renamed portfolio. */
export const DEFAULT_PORTFOLIO_NAME = "New Portfolio";

export const useAppStore = create<AppState>((set, get) => ({
  sessionId: null,
  sessionName: DEFAULT_PORTFOLIO_NAME,
  dealerships: [],
  parameters: DEFAULT_RISK_PARAMETERS,
  parametersUpdating: false,
  selectedId: null,
  analyzing: false,
  progress: null,
  analysisErrors: {},
  failedInputs: {},
  analysisCancelRequested: false,
  pendingAnalysis: [],
  analyzingIds: [],
  pendingBoundaryDetectionIds: [],
  detectionUpdateIds: [],
  detectionUpdateErrors: {},
  boundaryEditIds: [],
  boundaryHistory: {},
  lastAddedIds: [],
  mapFocusIds: null,
  mapFocusRadiusKm: null,
  lastSavedAt: null,
  lastImportReport: null,
  scenario: null,
  comparison: null,
  nlQueryMatchedIds: null,
  filters: EMPTY_FILTERS,

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
    const remaining = await window.api.listSessions().catch(() => []);
    const next = remaining.find((summary) => summary.id !== id);
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
  setParameters: (parameters) =>
    set({ parameters: normalizeRiskParameters(parameters) }),
  updateParameters: async (patch) => {
    const parameters = normalizeRiskParameters({
      ...get().parameters,
      ...patch,
    });
    set({ parameters, parametersUpdating: true });
    const generation = portfolioGeneration;
    try {
      const current = get().dealerships.filter(
        (d) => d.lat != null && d.lon != null,
      );
      const updates = await rescoreWithConcurrency(current, parameters, 4);
      // Another portfolio was opened meanwhile: it has its own parameters.
      if (generation !== portfolioGeneration) return;
      set((s) => ({
        dealerships: s.dealerships.map((d) => {
          const update = updates.find((x) => x.id === d.id);
          const boundary = d.boundary
            ? {
                ...d.boundary,
                reviewRequired: boundaryNeedsReview(d.boundary, parameters),
              }
            : d.boundary;
          return update
            ? { ...d, boundary, risk: update.risk }
            : { ...d, boundary };
        }),
      }));
    } catch (err) {
      console.error("Parameter recalculation failed:", err);
    } finally {
      if (generation === portfolioGeneration) {
        await get()
          .saveSession()
          .catch((err: unknown) => {
            console.error("Saving parameters failed:", err);
          });
      }
      set({ parametersUpdating: false });
    }
  },
  resetParameters: async () => {
    await get().updateParameters(DEFAULT_RISK_PARAMETERS);
  },
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
  upsertDealership: (d) =>
    set((s) => {
      const idx = s.dealerships.findIndex((x) => x.id === d.id);
      const analysisErrors = d.risk
        ? withoutKey(s.analysisErrors, d.id)
        : s.analysisErrors;
      if (idx === -1)
        return { dealerships: [...s.dealerships, d], analysisErrors };
      const copy = [...s.dealerships];
      copy[idx] = d;
      return { dealerships: copy, analysisErrors };
    }),
  updateBoundary: (id, boundary) =>
    set((s) => {
      const copy = s.dealerships.map((d) =>
        d.id === id ? { ...d, boundary } : d,
      );
      return { dealerships: copy };
    }),
  updateBoundaryAndRescore: async (id, boundary) => {
    const before = get().dealerships.find((x) => x.id === id);
    if (!before?.boundary) return;
    // A reviewer's earlier change (a manual edit, or a confirmed choice of
    // another suggestion) must not become the revert target: keep the
    // original automatic boundary across several changes.
    const reviewed =
      before.boundary.source === "manual" ||
      before.boundary.confirmedAt != null;
    const baseBoundary = reviewed
      ? (before.boundaryBeforeManualEdit ?? before.boundary)
      : before.boundary;

    // 1) Write the boundary + area back immediately so it's visible and keep
    // the first non-manual boundary as the durable revert target.
    set((s) => ({
      dealerships: s.dealerships.map((d) =>
        d.id === id
          ? {
              ...d,
              boundary,
              boundaryBeforeManualEdit: baseBoundary,
            }
          : d,
      ),
      boundaryEditIds: s.boundaryEditIds.includes(id)
        ? s.boundaryEditIds
        : [...s.boundaryEditIds, id],
      boundaryHistory: {
        ...s.boundaryHistory,
        [id]: [...(s.boundaryHistory[id] ?? []), before.boundary!].slice(
          -BOUNDARY_UNDO_LIMIT,
        ),
      },
    }));
    const d = get().dealerships.find((x) => x.id === id);
    if (!d) return;
    set((s) => ({
      pendingBoundaryDetectionIds: s.pendingBoundaryDetectionIds.includes(id)
        ? s.pendingBoundaryDetectionIds
        : [...s.pendingBoundaryDetectionIds, id],
      detectionUpdateErrors: withoutKey(s.detectionUpdateErrors, id),
    }));
    // 2) Recompute risk with the new area (capacity/utilisation/EAL).
    try {
      const risk = await window.api.scoreRisk(
        d.lat,
        d.lon,
        d.assetValue,
        d.detection,
        boundary,
        get().parameters,
        d.natCat,
        d.hailZone,
      );
      const latest = get().dealerships.find((x) => x.id === id);
      if (latest) get().upsertDealership({ ...latest, risk });
    } catch (err) {
      console.error(`Rescoring after boundary edit failed (${id}):`, err);
    }
    await saveBoundaryDraft(get);
  },
  updateDetectionForBoundary: async (id) => {
    const d = get().dealerships.find((x) => x.id === id);
    if (!d?.boundary) return;
    if (get().detectionUpdateIds.includes(id)) return;

    set((s) => ({
      detectionUpdateIds: [...s.detectionUpdateIds, id],
      detectionUpdateErrors: withoutKey(s.detectionUpdateErrors, id),
    }));
    try {
      // The boundary may be edited again while the detection runs; a count
      // for the outline it replaced must not be stored as the current one.
      let boundary = d.boundary;
      for (let attempt = 1; ; attempt++) {
        const detected = await window.api.detectVehicles(
          d.lat,
          d.lon,
          boundary,
          get().parameters,
        );
        const before = get().dealerships.find((x) => x.id === id);
        if (!before?.boundary) return;
        if (before.boundary.polygon !== boundary.polygon) {
          if (attempt >= DETECTION_BOUNDARY_ATTEMPTS) return;
          boundary = before.boundary;
          continue;
        }
        // Manual counts are read now: they may have been set meanwhile.
        const manual = before.detection;
        const detection =
          manual?.manualVehicleCount == null
            ? detected
            : {
                ...detected,
                manualVehicleCount: manual.manualVehicleCount,
                manualVehiclePoints: manual.manualVehiclePoints,
                manualVehicleRemovedPoints: manual.manualVehicleRemovedPoints,
              };
        const risk = await window.api.scoreRisk(
          d.lat,
          d.lon,
          d.assetValue,
          detection,
          boundary,
          get().parameters,
          d.natCat,
          d.hailZone,
        );
        const current = get().dealerships.find((x) => x.id === id);
        if (!current?.boundary) return;
        if (current.boundary.polygon !== boundary.polygon) {
          if (attempt >= DETECTION_BOUNDARY_ATTEMPTS) return;
          boundary = current.boundary;
          continue;
        }
        get().upsertDealership({ ...current, detection, risk });
        set((s) => ({
          pendingBoundaryDetectionIds: s.pendingBoundaryDetectionIds.filter(
            (pendingId) => pendingId !== id,
          ),
          detectionUpdateErrors: withoutKey(s.detectionUpdateErrors, id),
        }));
        return;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `Vehicle detection after boundary edit failed (${id}):`,
        err,
      );
      set((s) => ({
        detectionUpdateErrors: { ...s.detectionUpdateErrors, [id]: message },
      }));
    } finally {
      set((s) => ({
        detectionUpdateIds: s.detectionUpdateIds.filter(
          (runningId) => runningId !== id,
        ),
      }));
    }
  },
  markReviewed: async (id) => {
    const d = get().dealerships.find((x) => x.id === id);
    if (!d) return;
    get().upsertDealership(withChange(d, { kind: "reviewed" }));
    await get().saveSession();
  },

  confirmBoundary: async (id) => {
    const d = get().dealerships.find((x) => x.id === id);
    if (!d?.boundary) return;
    const boundary = {
      ...d.boundary,
      confirmedAt: new Date().toISOString(),
      reviewRequired: false,
    };
    get().upsertDealership(
      withChange(
        { ...d, boundary },
        {
          kind: "boundaryConfirmed",
          value: boundary.provider ?? boundary.source,
          area: Math.round(boundary.areaSqm),
        },
      ),
    );
    // Evidence limitations depend on the review flag, so rescore.
    try {
      const risk = await window.api.scoreRisk(
        d.lat,
        d.lon,
        d.assetValue,
        d.detection,
        boundary,
        get().parameters,
        d.natCat,
        d.hailZone,
      );
      const latest = get().dealerships.find((x) => x.id === id);
      if (latest) get().upsertDealership({ ...latest, risk });
    } catch (err) {
      console.error(
        `Rescoring after boundary confirmation failed (${id}):`,
        err,
      );
    }
    await get()
      .saveSession()
      .catch((err: unknown) => {
        console.error("Saving boundary confirmation failed:", err);
      });
  },
  saveBoundaryEdit: async (id) => {
    if (!get().boundaryEditIds.includes(id)) return;
    if (get().detectionUpdateIds.includes(id)) return;
    // Persist the edited boundary first so it survives a failing detection.
    await get().saveSession();
    await get().updateDetectionForBoundary(id);
    if (get().detectionUpdateErrors[id]) return;
    const saved = get().dealerships.find((d) => d.id === id);
    if (saved?.boundary) {
      get().upsertDealership(
        withChange(saved, {
          kind: "boundaryChanged",
          value: saved.boundary.provider ?? saved.boundary.source,
          area: Math.round(saved.boundary.areaSqm),
          ...(saved.detection ? { to: saved.detection.vehicleCount } : {}),
        }),
      );
    }
    // Close the edit before saving, so it is not stored as still open.
    set((s) => ({
      boundaryEditIds: s.boundaryEditIds.filter((editId) => editId !== id),
    }));
    await get().saveSession();
  },
  undoBoundaryEdit: async (id) => {
    const current = get().dealerships.find((d) => d.id === id);
    const history = get().boundaryHistory[id] ?? [];
    const previous = history.at(-1);
    if (!current || !previous) return;

    const remaining = history.slice(0, -1);
    const baseBoundary =
      previous.source === "manual"
        ? current.boundaryBeforeManualEdit
        : undefined;
    set((s) => ({
      dealerships: s.dealerships.map((d) =>
        d.id === id
          ? {
              ...d,
              boundary: previous,
              boundaryBeforeManualEdit: baseBoundary,
            }
          : d,
      ),
      boundaryHistory: { ...s.boundaryHistory, [id]: remaining },
      boundaryEditIds: s.boundaryEditIds.includes(id)
        ? s.boundaryEditIds
        : [...s.boundaryEditIds, id],
      pendingBoundaryDetectionIds: s.pendingBoundaryDetectionIds.includes(id)
        ? s.pendingBoundaryDetectionIds
        : [...s.pendingBoundaryDetectionIds, id],
      detectionUpdateErrors: withoutKey(s.detectionUpdateErrors, id),
    }));
    const risk = await window.api.scoreRisk(
      current.lat,
      current.lon,
      current.assetValue,
      current.detection,
      previous,
      get().parameters,
      current.natCat,
      current.hailZone,
    );
    const latest = get().dealerships.find((d) => d.id === id);
    if (latest) get().upsertDealership({ ...latest, risk });
    await saveBoundaryDraft(get);
  },
  revertBoundaryToDefault: async (id) => {
    const current = get().dealerships.find((d) => d.id === id);
    const baseBoundary = current?.boundaryBeforeManualEdit;
    if (!current || !baseBoundary) return;

    set((s) => ({
      dealerships: s.dealerships.map((d) =>
        d.id === id
          ? {
              ...d,
              boundary: baseBoundary,
              boundaryBeforeManualEdit: undefined,
            }
          : d,
      ),
      boundaryHistory: { ...s.boundaryHistory, [id]: [] },
      boundaryEditIds: s.boundaryEditIds.includes(id)
        ? s.boundaryEditIds
        : [...s.boundaryEditIds, id],
      pendingBoundaryDetectionIds: s.pendingBoundaryDetectionIds.includes(id)
        ? s.pendingBoundaryDetectionIds
        : [...s.pendingBoundaryDetectionIds, id],
      detectionUpdateErrors: withoutKey(s.detectionUpdateErrors, id),
    }));
    const risk = await window.api.scoreRisk(
      current.lat,
      current.lon,
      current.assetValue,
      current.detection,
      baseBoundary,
      get().parameters,
      current.natCat,
      current.hailZone,
    );
    const latest = get().dealerships.find((d) => d.id === id);
    if (latest) get().upsertDealership({ ...latest, risk });
    await saveBoundaryDraft(get);
  },
  updateDealershipMeta: (id, patch) =>
    set((s) => {
      const copy = s.dealerships.map((d) => {
        if (d.id !== id) return d;
        const next = { ...d, ...patch };
        return patch.insured !== undefined &&
          Boolean(patch.insured) !== Boolean(d.insured)
          ? withChange(next, {
              kind: "businessTypeChanged",
              value: patch.insured ? "existing" : "new",
            })
          : next;
      });
      return { dealerships: copy };
    }),
  updateDealershipNotes: async (id, notes) => {
    const current = get().dealerships.find((d) => d.id === id);
    if (!current) return;
    const next = notes.trim() === "" ? undefined : notes;
    if (next === current.notes) return;
    const notesUpdatedAt =
      next === undefined ? undefined : new Date().toISOString();
    set((s) => ({
      dealerships: s.dealerships.map((d) =>
        d.id === id ? { ...d, notes: next, notesUpdatedAt } : d,
      ),
    }));
    await get().saveSession();
  },
  updateDealershipWebsite: async (id, website, source) => {
    const current = get().dealerships.find((d) => d.id === id);
    if (!current) return false;
    const next = website === null ? undefined : normalizeWebsiteUrl(website);
    if (website !== null && !next) return false;
    // A typed or imported link is never replaced by an automatic lookup.
    if (source === "osm" && isUserWebsiteSource(current.websiteSource))
      return true;
    const websiteSource = next ? source : undefined;
    if (next === current.website && websiteSource === current.websiteSource)
      return true;
    set((s) => ({
      dealerships: s.dealerships.map((d) =>
        d.id === id ? { ...d, website: next, websiteSource } : d,
      ),
    }));
    await get().saveSession();
    return true;
  },
  setInsuredForDealerships: (ids, insured) =>
    set((s) => {
      const idSet = new Set(ids);
      return {
        dealerships: s.dealerships.map((d) =>
          idSet.has(d.id) && Boolean(d.insured) !== insured
            ? withChange(
                { ...d, insured },
                {
                  kind: "businessTypeChanged",
                  value: insured ? "existing" : "new",
                },
              )
            : d,
        ),
      };
    }),
  updateManualVehicleCount: async (id, count) => {
    if (count != null && (!Number.isInteger(count) || count < 0)) return;
    const current = get().dealerships.find((d) => d.id === id);
    if (!current?.detection) return;
    const detection = {
      ...current.detection,
      ...(count == null
        ? {
            manualVehicleCount: undefined,
            manualVehiclePoints: undefined,
            manualVehicleRemovedPoints: undefined,
          }
        : { manualVehicleCount: count }),
    };
    const risk = await window.api.scoreRisk(
      current.lat,
      current.lon,
      current.assetValue,
      detection,
      current.boundary,
      get().parameters,
      current.natCat,
      current.hailZone,
    );
    const latest = get().dealerships.find((d) => d.id === id);
    if (latest)
      get().upsertDealership(
        withChange(
          { ...latest, detection, risk },
          {
            kind: "vehicleCountChanged",
            from:
              current.detection.manualVehicleCount ??
              current.detection.vehicleCount,
            ...(count != null ? { to: count } : {}),
          },
        ),
      );
    await get().saveSession();
  },
  saveManualVehicleDetection: async (id, count, points, removedPoints) => {
    if (!Number.isInteger(count) || count < 0) return;
    const current = get().dealerships.find((d) => d.id === id);
    if (!current?.detection) return;
    const detection = {
      ...current.detection,
      manualVehicleCount: count,
      manualVehiclePoints: points.length > 0 ? points : undefined,
      manualVehicleRemovedPoints:
        removedPoints.length > 0 ? removedPoints : undefined,
    };
    const risk = await window.api.scoreRisk(
      current.lat,
      current.lon,
      current.assetValue,
      detection,
      current.boundary,
      get().parameters,
      current.natCat,
      current.hailZone,
    );
    const latest = get().dealerships.find((d) => d.id === id);
    if (latest)
      get().upsertDealership(
        withChange(
          { ...latest, detection, risk },
          {
            kind: "vehiclesReviewed",
            from: current.detection.vehicleCount,
            to: count,
          },
        ),
      );
    await get().saveSession();
  },
  countVehicleTimeline: async (id) => {
    const current = get().dealerships.find((d) => d.id === id);
    if (!current?.detection) return;
    const timeline = await window.api.countVehiclesOverTime(
      current.lat,
      current.lon,
      current.boundary,
      get().parameters,
    );
    const latest = get().dealerships.find((d) => d.id === id);
    if (!latest?.detection) return;
    const detection = attachVehicleTimeline(latest.detection, timeline);
    // The risk carries the stock range; a failed rescore keeps the counts.
    let risk = latest.risk;
    try {
      risk = await window.api.scoreRisk(
        latest.lat,
        latest.lon,
        latest.assetValue,
        detection,
        latest.boundary,
        get().parameters,
        latest.natCat,
        latest.hailZone,
      );
    } catch (err) {
      console.error(`Rescoring after the stock count failed (${id}):`, err);
    }
    const after = get().dealerships.find((d) => d.id === id);
    if (!after?.detection) return;
    // A re-detection meanwhile replaced the counts this timeline belongs to.
    if (after.detection !== latest.detection) return;
    get().upsertDealership({ ...after, detection, risk });
    await get().saveSession();
  },
  countVehicleTimelines: async (ids, onProgress, shouldStop) => {
    let counted = 0;
    let failed = 0;
    for (let i = 0; i < ids.length; i++) {
      if (shouldStop?.()) break;
      try {
        await get().countVehicleTimeline(ids[i]);
        counted++;
      } catch (err) {
        console.error(`Stock count failed (${ids[i]}):`, err);
        failed++;
      }
      onProgress?.(i + 1, ids.length);
    }
    return { counted, failed };
  },
  select: (id) => set({ selectedId: id }),
  focusDealerships: (ids, radiusKm) =>
    set({
      mapFocusIds: ids,
      mapFocusRadiusKm: radiusKm ?? null,
      selectedId: null,
    }),
  clearMapFocus: () => set({ mapFocusIds: null, mapFocusRadiusKm: null }),

  removeDealership: (id) => get().removeDealerships([id]),

  removeDealerships: (ids) =>
    set((s) => {
      const idSet = new Set(ids);
      // A running analysis of a removed location must not bring it back.
      for (const id of ids) removedIds.add(id);
      return {
        dealerships: s.dealerships.filter((d) => !idSet.has(d.id)),
        pendingAnalysis: s.pendingAnalysis.filter((p) => !idSet.has(p.id)),
        selectedId:
          s.selectedId && idSet.has(s.selectedId) ? null : s.selectedId,
        analysisErrors: Object.fromEntries(
          Object.entries(s.analysisErrors).filter(([id]) => !idSet.has(id)),
        ),
        failedInputs: Object.fromEntries(
          Object.entries(s.failedInputs).filter(([id]) => !idSet.has(id)),
        ),
      };
    }),

  reanalyzeDealership: async (id) => {
    const d = get().dealerships.find((x) => x.id === id);
    if (!d) return;
    const generation = portfolioGeneration;
    set((s) => ({ analyzingIds: [...s.analyzingIds, id] }));
    try {
      const result = await window.api.analyzeDealership(d, get().parameters);
      if (d.detection && result.detection) {
        result.detection = {
          ...result.detection,
          manualVehicleCount: d.detection.manualVehicleCount,
          manualVehiclePoints: d.detection.manualVehiclePoints,
          manualVehicleRemovedPoints: d.detection.manualVehicleRemovedPoints,
        };
      }
      // A manually-confirmed boundary must survive re-analysis
      // (docs/boundary-improvement-plan.de.md P7): re-running detection is
      // useful, but it must never silently discard a human's correction —
      // neither an edited outline nor a suggestion the reviewer confirmed.
      // Vehicles and risk are recomputed against the *preserved* boundary
      // rather than the freshly (re-)detected one that `result` carries.
      if (d.boundary?.source === "manual" || d.boundary?.confirmedAt != null) {
        result.boundary = d.boundary;
        result.boundaryBeforeManualEdit = d.boundaryBeforeManualEdit;
        try {
          const detection = await window.api.detectVehicles(
            d.lat,
            d.lon,
            d.boundary,
            get().parameters,
          );
          result.detection = d.detection
            ? {
                ...detection,
                manualVehicleCount: d.detection.manualVehicleCount,
                manualVehiclePoints: d.detection.manualVehiclePoints,
                manualVehicleRemovedPoints:
                  d.detection.manualVehicleRemovedPoints,
              }
            : detection;
          result.risk = await window.api.scoreRisk(
            d.lat,
            d.lon,
            d.assetValue,
            result.detection,
            d.boundary,
            get().parameters,
            result.natCat,
            result.hailZone ?? d.hailZone,
          );
        } catch (err) {
          console.error(
            `Re-detecting vehicles for the preserved manual boundary failed (${id}):`,
            err,
          );
        }
      }
      // Notes and website edited while the re-analysis ran must not be
      // overwritten by the snapshot `result` was built from. A location
      // deleted meanwhile (or another portfolio opened) stays gone.
      const latest = get().dealerships.find((x) => x.id === id);
      if (!latest || generation !== portfolioGeneration) return;
      get().upsertDealership({
        ...withChange(
          { ...result, history: latest.history },
          analyzedChange(result),
        ),
        notes: latest.notes,
        notesUpdatedAt: latest.notesUpdatedAt,
        // A link found by this run fills an empty slot only.
        website: latest.website ?? result.website,
        websiteSource: latest.website
          ? latest.websiteSource
          : result.websiteSource,
      });
    } catch (err) {
      console.error(`Re-analysis failed for ${d.name}:`, err);
    } finally {
      set((s) => ({ analyzingIds: s.analyzingIds.filter((x) => x !== id) }));
    }
  },

  refreshNatCat: async (id) => {
    const d = get().dealerships.find((x) => x.id === id);
    if (!d) return;
    try {
      const natCat =
        (await window.api.resolveNatCat(d.lat, d.lon)) ?? undefined;
      const risk = await window.api.scoreRisk(
        d.lat,
        d.lon,
        d.assetValue,
        d.detection,
        d.boundary,
        get().parameters,
        natCat,
        d.hailZone,
      );
      const latest = get().dealerships.find((x) => x.id === id);
      if (latest) {
        get().upsertDealership({ ...latest, natCat, risk });
        await get().saveSession();
      }
    } catch (err) {
      console.error(`NatCat refresh failed for ${d.name}:`, err);
      throw err;
    }
  },

  analyzeAll: async (inputs) => {
    set({
      analyzing: true,
      progress: { done: 0, total: inputs.length, startedAt: Date.now() },
      dealerships: [],
      analyzingIds: [],
      analysisErrors: {},
      failedInputs: {},
      analysisCancelRequested: false,
    });
    await runAnalysisQueue(inputs, set, get);
  },

  cancelAnalysis: () => set({ analysisCancelRequested: true }),

  resumeAnalysis: async () => {
    const inputs = unanalyzedInputs(get());
    if (inputs.length === 0 || get().analyzing) return;
    set({
      analyzing: true,
      progress: { done: 0, total: inputs.length, startedAt: Date.now() },
      analysisCancelRequested: false,
    });
    await runAnalysisQueue(inputs, set, get);
  },

  discardPendingAnalysis: () => {
    // Only forgets the queue; imported locations are never deleted here.
    set({ pendingAnalysis: [] });
    void get()
      .saveSession()
      .catch((err: unknown) => {
        console.error(
          "Saving after discarding the pending analysis failed:",
          err,
        );
      });
  },

  retryFailedAnalyses: async () => {
    const { analysisErrors, failedInputs, dealerships } = get();
    const inputs = Object.keys(analysisErrors).flatMap((id) => {
      const input = failedInputs[id] ?? dealerships.find((d) => d.id === id);
      return input ? [input] : [];
    });
    if (inputs.length === 0 || get().analyzing) return;
    set({
      analyzing: true,
      progress: { done: 0, total: inputs.length, startedAt: Date.now() },
      analysisCancelRequested: false,
    });
    await runAnalysisQueue(inputs, set, get);
  },

  addAndAnalyze: async (inputs) => {
    // Deduplicate new locations against the existing set: existing entries
    // are already unique and come first, so the newly accepted ones are
    // exactly the tail of `unique` after the existing entries.
    const existing = get().dealerships;
    const { unique, duplicates } = dedupeDealerships([...existing, ...inputs]);
    const fresh = unique.slice(existing.length);
    if (fresh.length === 0) return duplicates.length;

    // Make pending pins with coordinates visible immediately — in one update,
    // not one store write (and map rebuild) per imported row.
    const pendingPins = fresh.filter(
      (input) => input.lat != null && input.lon != null,
    ) as AnalyzedDealership[];
    if (pendingPins.length > 0) {
      set((s) => ({ dealerships: [...s.dealerships, ...pendingPins] }));
    }

    const freshIds = fresh.map((f) => f.id);
    set((s) => ({
      lastAddedIds: freshIds,
      // Single address → select directly so the map flies to it.
      selectedId: freshIds.length === 1 ? freshIds[0] : s.selectedId,
      analyzing: true,
      progress: { done: 0, total: fresh.length, startedAt: Date.now() },
      analysisCancelRequested: false,
      analysisErrors: fresh.reduce<Record<string, string>>(
        (errors, input) => {
          delete errors[input.id];
          return errors;
        },
        { ...get().analysisErrors },
      ),
    }));

    await runAnalysisQueue(fresh, set, get);
    return duplicates.length;
  },

  importPortfolio: async ({ rows, target, name, business, report }) => {
    const classified = applyBusinessClassification(rows, business);
    if (target === "new") {
      // A new portfolio keeps the parameter set in use (e.g. calibrated
      // hail EAL values) instead of falling back to the defaults.
      const parameters = get().parameters;
      await get().newPortfolio();
      const trimmed = name.trim();
      set({ sessionName: trimmed || DEFAULT_PORTFOLIO_NAME });
      get().setParameters(parameters);
    } else if (get().dealerships.length === 0 && name.trim()) {
      // The first import into the empty start portfolio names it, as the
      // dialog's name field promises; otherwise it stayed "New Portfolio".
      set({ sessionName: name.trim() });
    }
    if (report) set({ lastImportReport: report });
    // addAndAnalyze adds the pins and the pending queue synchronously and
    // then analyses for a while; save right away so the rows are listed
    // (and survive closing the app) before the analysis finishes. On the
    // next start the "resume analysis" notice takes over.
    const analysis = get().addAndAnalyze(classified);
    await get()
      .saveSession()
      .catch((err: unknown) => {
        console.error("Saving the imported portfolio failed:", err);
      });
    return analysis;
  },

  setScenario: (scenario) => set({ scenario }),
  setComparison: (comparison) => set({ comparison }),
  setNlQueryMatchedIds: (nlQueryMatchedIds) => set({ nlQueryMatchedIds }),
  setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
  resetFilters: () => set({ filters: EMPTY_FILTERS }),

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
    savedSnapshot = { ...snapshot, sessionId: session.id };
  },

  saveSessionIfChanged: async () => {
    if (isSavedState(get())) return;
    await get().saveSession();
  },

  markSaved: () => {
    savedSnapshot = snapshotOf(get());
  },
}));

/**
 * Bumped whenever another portfolio becomes the active one. Work started
 * for the previous portfolio (a batch analysis, a re-analysis, a parameter
 * rescore) compares it before writing its result back and drops the result
 * when it changed, so it can never land in the portfolio opened meanwhile.
 */
let portfolioGeneration = 0;

/**
 * Locations removed by the user. A batch still analysing one of them drops
 * its result instead of adding the location again; a new batch for the same
 * id clears the mark.
 */
const removedIds = new Set<string>();

/** How often a vehicle detection follows a boundary edited while it ran. */
const DETECTION_BOUNDARY_ATTEMPTS = 3;

/** Detaches running work from the portfolio that is being left. */
function abandonRunningAnalysis(): void {
  portfolioGeneration += 1;
  removedIds.clear();
}

/**
 * Whether leaving the active portfolio has to save it first: it has
 * locations, or it is stored already (its last location may just have been
 * deleted, and that must not be undone by leaving it).
 */
function hasPortfolioToSave(s: AppState): boolean {
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

function snapshotOf(s: AppState): SavedSnapshot {
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
function isSavedState(s: AppState): boolean {
  const saved = savedSnapshot;
  if (!saved || s.sessionId == null || saved.sessionId !== s.sessionId)
    return false;
  const now = snapshotOf(s);
  return (Object.keys(now) as (keyof SavedSnapshot)[]).every(
    (key) => now[key] === saved[key],
  );
}

/** Makes a loaded session the open portfolio (switching, after a delete). */
function applyLoadedSession(
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
    selectedId: null,
    analyzing: false,
    progress: null,
    analyzingIds: [],
    lastSavedAt: null,
    scenario: null,
    nlQueryMatchedIds: null,
    filters: EMPTY_FILTERS,
    pendingAnalysis: session.pendingAnalysis ?? [],
  });
  get().setDealerships(session.dealerships, session.boundaryEdits);
  get().setParameters(session.parameters);
  get().markSaved();
}

/** Shared by `newPortfolio` and `deleteSavedSession` (when deleting the active one). */
function resetToBlankPortfolio(
  set: (partial: Partial<AppState>) => void,
  get: () => AppState,
): void {
  abandonRunningAnalysis();
  set({
    sessionId: null,
    sessionName: DEFAULT_PORTFOLIO_NAME,
    selectedId: null,
    analyzing: false,
    progress: null,
    analysisCancelRequested: false,
    analyzingIds: [],
    lastAddedIds: [],
    mapFocusIds: null,
    mapFocusRadiusKm: null,
    lastSavedAt: null,
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
 * Undo steps and unsaved boundary edits as stored with the session, so
 * closing the app loses neither.
 */
function boundaryEditsOf(
  s: Pick<AppState, "dealerships" | "boundaryEditIds" | "boundaryHistory">,
): { boundaryEdits?: Record<string, BoundaryEditState> } {
  const edits: Record<string, BoundaryEditState> = {};
  for (const d of s.dealerships) {
    const history = (s.boundaryHistory[d.id] ?? []).slice(-BOUNDARY_UNDO_LIMIT);
    const unsaved = s.boundaryEditIds.includes(d.id);
    if (history.length > 0 || unsaved) edits[d.id] = { history, unsaved };
  }
  return Object.keys(edits).length > 0 ? { boundaryEdits: edits } : {};
}

/**
 * Keeps an edit that was not saved yet (and its undo steps) on disk. Saving
 * still re-runs the car detection; this only protects the draft.
 */
async function saveBoundaryDraft(get: () => AppState): Promise<void> {
  await get()
    .saveSession()
    .catch((err: unknown) => {
      console.error("Keeping the boundary edit failed:", err);
    });
}

function withoutKey<T>(
  values: Record<string, T>,
  key: string,
): Record<string, T> {
  if (!(key in values)) return values;
  const copy = { ...values };
  delete copy[key];
  return copy;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Locations analysed at once. Each analysis is mostly waiting on remote
 * services (boundary sources, imagery, hazard APIs), so a few in parallel cut
 * a 500-row import from many hours to a fraction of that; main paces the
 * shared public services (`http.service.ts` host gates) so this stays within
 * their fair-use limits.
 */
const ANALYSIS_CONCURRENCY = 3;

type StoreSet = (
  partial: Partial<AppState> | ((s: AppState) => Partial<AppState>),
) => void;
/** Persist a running batch every this many finished locations… */
const ANALYSIS_CHECKPOINT_EVERY = 25;
/** …or at least this often, so a small batch closed midway keeps its results. */
const ANALYSIS_CHECKPOINT_MS = 15_000;

/**
 * Runs `analyzeDealership` for every input with bounded concurrency, updating
 * pins, errors and progress as results arrive. Autosave is paused during a
 * batch, so it checkpoints the session periodically — a crash hours into a
 * large import must not lose everything already analysed.
 */
/** Appends a change-history entry, keeping the last DEALERSHIP_HISTORY_MAX. */
export function withChange(
  d: AnalyzedDealership,
  change: Omit<DealershipChange, "at">,
  at: string = new Date().toISOString(),
): AnalyzedDealership {
  return {
    ...d,
    history: [...(d.history ?? []), { at, ...change }].slice(
      -DEALERSHIP_HISTORY_MAX,
    ),
  };
}

/** History entry for a finished analysis. */
function analyzedChange(d: AnalyzedDealership): Omit<DealershipChange, "at"> {
  return {
    kind: "analyzed",
    value: d.boundary?.provider ?? d.boundary?.source,
    ...(d.boundary ? { area: Math.round(d.boundary.areaSqm) } : {}),
    ...(d.detection ? { to: d.detection.vehicleCount } : {}),
  };
}

async function runAnalysisQueue(
  inputs: DealershipInput[],
  set: StoreSet,
  get: () => AppState,
): Promise<void> {
  let next = 0;
  let done = 0;
  let checkpoint: Promise<void> | null = null;
  // Results are written back only while this portfolio stays open.
  const generation = portfolioGeneration;
  const stillOpen = (): boolean => generation === portfolioGeneration;
  for (const input of inputs) removedIds.delete(input.id);
  let lastCheckpointAt = Date.now();
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
          get().upsertDealership(withChange(result, analyzedChange(result)));
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
      const due =
        done % ANALYSIS_CHECKPOINT_EVERY === 0 ||
        Date.now() - lastCheckpointAt >= ANALYSIS_CHECKPOINT_MS;
      if (due && !checkpoint && stillOpen()) {
        lastCheckpointAt = Date.now();
        checkpoint = get()
          .saveSession()
          .catch((err: unknown) => {
            console.error("Analysis checkpoint save failed:", err);
          })
          .finally(() => {
            checkpoint = null;
          });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(ANALYSIS_CONCURRENCY, inputs.length) }, () =>
      worker(),
    ),
  );
  if (checkpoint) await checkpoint;
  // The portfolio that was opened meanwhile has its own analysis state.
  if (!stillOpen()) return;
  set((s) => {
    // A cancelled batch is not offered for resuming; failed inputs stay
    // pending so they can be retried after a restart as well.
    const failed = new Set(Object.keys(s.analysisErrors));
    return {
      analyzing: false,
      analyzingIds: [],
      analysisCancelRequested: false,
      pendingAnalysis: s.analysisCancelRequested
        ? s.pendingAnalysis.filter((p) => failed.has(p.id))
        : s.pendingAnalysis,
    };
  });
}

/**
 * Rescores a portfolio with bounded concurrency. Parameter changes used to
 * start one network-heavy weather/risk pipeline per location at once, which
 * could make Electron unresponsive for larger portfolios.
 */
async function rescoreWithConcurrency(
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

/** Flat NL query projection of a dealership (for the filter evaluator in main). */
export function toNlQueryDealership(d: AnalyzedDealership): NlQueryDealership {
  return {
    id: d.id,
    name: d.name,
    hailZone: dealershipHailZone(d)?.zone,
    vehicleCount: d.detection ? effectiveVehicleCount(d.detection) : undefined,
    utilisation: d.risk?.utilisation,
    eal: d.risk?.eal,
    exposureEur: d.risk?.exposureEur,
    boundarySource: d.boundary?.source,
    boundaryConfidence: d.boundary?.confidence,
    insured: d.insured,
    salesPartner: d.salesPartner,
    subPortfolio: d.subPortfolio,
    group: d.group,
  };
}
