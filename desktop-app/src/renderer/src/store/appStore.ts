import { create } from "zustand";
import type {
  AnalyzedDealership,
  BoundaryResult,
  DealershipInput,
  HailstormScenario,
  ImportReport,
  NlQueryDealership,
  ManualVehiclePoint,
  RiskParameters,
  Session,
} from "@shared/types";
import {
  DEFAULT_RISK_PARAMETERS,
  normalizeRiskParameters,
} from "@shared/parameters";
import { dedupeDealerships } from "@shared/dedupe";
import { effectiveVehicleCount } from "@shared/risk-math";
import { riskLevel } from "@renderer/lib/riskColor";

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
  progress: { done: number; total: number } | null;
  /** Last error per location from a batch analysis. */
  analysisErrors: Record<string, string>;
  /** Requests that the current batch stop after the active item. */
  analysisCancelRequested: boolean;
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
  setImportReport: (report: ImportReport | null) => void;
  setDealerships: (d: AnalyzedDealership[]) => void;
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
  /** Persists a manual boundary edit and clears its unsaved marker. */
  saveBoundaryEdit: (id: string) => Promise<void>;
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
      >
    >,
  ) => void;
  /** Saves an optional human-reviewed vehicle count and recalculates risk. */
  updateManualVehicleCount: (id: string, count: number | null) => Promise<void>;
  /** Persists a completed map-based vehicle review and recalculates risk. */
  saveManualVehicleDetection: (
    id: string,
    count: number,
    points: ManualVehiclePoint[],
    removedPoints: ManualVehiclePoint[],
  ) => Promise<void>;
  select: (id: string | null) => void;
  /** Permanently removes a location from the portfolio. */
  removeDealership: (id: string) => void;
  /** Re-analyzes an existing location (recomputes boundary/detection/risk). */
  reanalyzeDealership: (id: string) => Promise<void>;
  /** Fetches a configured CatNet assessment and rescores one location. */
  refreshCatNet: (id: string) => Promise<void>;
  analyzeAll: (inputs: DealershipInput[]) => Promise<void>;
  cancelAnalysis: () => void;
  /**
   * Adds locations to the portfolio (deduplicated against existing
   * entries), shows them immediately as pins, and analyzes them in the
   * background. Returns the number of skipped duplicates.
   */
  addAndAnalyze: (inputs: DealershipInput[]) => Promise<number>;

  setScenario: (s: HailstormScenario | null) => void;
  setComparison: (s: Session | null) => void;
  setNlQueryMatchedIds: (ids: string[] | null) => void;
  setFilters: (patch: Partial<PortfolioFilters>) => void;
  resetFilters: () => void;

  currentSession: () => Session;
  /** Persists the current session in SQLite (manually or via autosave). */
  saveSession: () => Promise<void>;
}

/** Active portfolio filters. `null`/`undefined` = no restriction. */
export interface PortfolioFilters {
  subPortfolio: string | null;
  salesPartner: string | null;
  group: string | null;
  clusterId: string | null;
  boundarySource: "fallback" | null;
}

const EMPTY_FILTERS: PortfolioFilters = {
  subPortfolio: null,
  salesPartner: null,
  group: null,
  clusterId: null,
  boundarySource: null,
};

export const useAppStore = create<AppState>((set, get) => ({
  sessionId: null,
  sessionName: "New Portfolio",
  dealerships: [],
  parameters: DEFAULT_RISK_PARAMETERS,
  parametersUpdating: false,
  selectedId: null,
  analyzing: false,
  progress: null,
  analysisErrors: {},
  analysisCancelRequested: false,
  analyzingIds: [],
  pendingBoundaryDetectionIds: [],
  detectionUpdateIds: [],
  detectionUpdateErrors: {},
  boundaryEditIds: [],
  boundaryHistory: {},
  lastAddedIds: [],
  lastSavedAt: null,
  lastImportReport: null,
  scenario: null,
  comparison: null,
  nlQueryMatchedIds: null,
  filters: EMPTY_FILTERS,

  setSession: (id, name) => set({ sessionId: id, sessionName: name }),
  setSessionName: (name) => set({ sessionName: name }),
  setParameters: (parameters) =>
    set({ parameters: normalizeRiskParameters(parameters) }),
  updateParameters: async (patch) => {
    const parameters = normalizeRiskParameters({
      ...get().parameters,
      ...patch,
    });
    set({ parameters, parametersUpdating: true });
    try {
      const current = get().dealerships.filter(
        (d) => d.lat != null && d.lon != null,
      );
      const updates = await rescoreWithConcurrency(current, parameters, 4);
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
      await get()
        .saveSession()
        .catch((err: unknown) => {
          console.error("Saving parameters failed:", err);
        });
      set({ parametersUpdating: false });
    }
  },
  resetParameters: async () => {
    await get().updateParameters(DEFAULT_RISK_PARAMETERS);
  },
  setImportReport: (lastImportReport) => set({ lastImportReport }),
  setDealerships: (dealerships) =>
    set({
      dealerships,
      boundaryEditIds: [],
      boundaryHistory: {},
      pendingBoundaryDetectionIds: [],
      detectionUpdateIds: [],
      detectionUpdateErrors: {},
      analysisErrors: {},
      analysisCancelRequested: false,
    }),
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
    const baseBoundary =
      before.boundary.source === "manual"
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
        [id]: [...(s.boundaryHistory[id] ?? []), before.boundary!],
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
      );
      get().upsertDealership({
        ...get().dealerships.find((x) => x.id === id)!,
        risk,
      });
    } catch (err) {
      console.error(`Rescoring after boundary edit failed (${id}):`, err);
    }
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
      const detected = await window.api.detectVehicles(
        d.lat,
        d.lon,
        d.boundary,
        get().parameters,
      );
      const detection =
        d.detection?.manualVehicleCount == null
          ? detected
          : {
              ...detected,
              manualVehicleCount: d.detection.manualVehicleCount,
              manualVehiclePoints: d.detection.manualVehiclePoints,
              manualVehicleRemovedPoints:
                d.detection.manualVehicleRemovedPoints,
            };
      const risk = await window.api.scoreRisk(
        d.lat,
        d.lon,
        d.assetValue,
        detection,
        d.boundary,
        get().parameters,
        d.natCat,
      );
      const current = get().dealerships.find((x) => x.id === id);
      if (current) get().upsertDealership({ ...current, detection, risk });
      set((s) => ({
        pendingBoundaryDetectionIds: s.pendingBoundaryDetectionIds.filter(
          (pendingId) => pendingId !== id,
        ),
        detectionUpdateErrors: withoutKey(s.detectionUpdateErrors, id),
      }));
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
  saveBoundaryEdit: async (id) => {
    if (!get().boundaryEditIds.includes(id)) return;
    await get().saveSession();
    set((s) => ({
      boundaryEditIds: s.boundaryEditIds.filter((editId) => editId !== id),
    }));
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
    );
    const latest = get().dealerships.find((d) => d.id === id);
    if (latest) get().upsertDealership({ ...latest, risk });
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
    );
    const latest = get().dealerships.find((d) => d.id === id);
    if (latest) get().upsertDealership({ ...latest, risk });
    await get().saveSession();
    set((s) => ({
      boundaryEditIds: s.boundaryEditIds.filter((editId) => editId !== id),
    }));
  },
  updateDealershipMeta: (id, patch) =>
    set((s) => {
      const copy = s.dealerships.map((d) =>
        d.id === id ? { ...d, ...patch } : d,
      );
      return { dealerships: copy };
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
    );
    const latest = get().dealerships.find((d) => d.id === id);
    if (latest) get().upsertDealership({ ...latest, detection, risk });
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
    );
    const latest = get().dealerships.find((d) => d.id === id);
    if (latest) get().upsertDealership({ ...latest, detection, risk });
    await get().saveSession();
  },
  select: (id) => set({ selectedId: id }),

  removeDealership: (id) =>
    set((s) => ({
      dealerships: s.dealerships.filter((d) => d.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
      analysisErrors: withoutKey(s.analysisErrors, id),
    })),

  reanalyzeDealership: async (id) => {
    const d = get().dealerships.find((x) => x.id === id);
    if (!d) return;
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
      get().upsertDealership(result);
    } catch (err) {
      console.error(`Re-analysis failed for ${d.name}:`, err);
    } finally {
      set((s) => ({ analyzingIds: s.analyzingIds.filter((x) => x !== id) }));
    }
  },

  refreshCatNet: async (id) => {
    const d = get().dealerships.find((x) => x.id === id);
    if (!d) return;
    try {
      const natCat = await window.api.fetchCatNet(d.lat, d.lon);
      const risk = await window.api.scoreRisk(
        d.lat,
        d.lon,
        d.assetValue,
        d.detection,
        d.boundary,
        get().parameters,
        natCat,
      );
      const latest = get().dealerships.find((x) => x.id === id);
      if (latest) {
        get().upsertDealership({ ...latest, natCat, risk });
        await get().saveSession();
      }
    } catch (err) {
      console.error(`CatNet refresh failed for ${d.name}:`, err);
      throw err;
    }
  },

  analyzeAll: async (inputs) => {
    set({
      analyzing: true,
      progress: { done: 0, total: inputs.length },
      dealerships: [],
      analyzingIds: [],
      analysisErrors: {},
      analysisCancelRequested: false,
    });
    for (let i = 0; i < inputs.length && !get().analysisCancelRequested; i++) {
      const input = inputs[i];
      set((s) => ({
        analyzingIds: [...s.analyzingIds, input.id],
        analysisErrors: withoutKey(s.analysisErrors, input.id),
      }));
      try {
        const result = await window.api.analyzeDealership(
          input,
          get().parameters,
        );
        get().upsertDealership(result);
      } catch (err) {
        const message = errorMessage(err);
        console.error(`Analysis failed for ${input.name}:`, err);
        set((s) => ({
          analysisErrors: { ...s.analysisErrors, [input.id]: message },
        }));
      }
      set((s) => ({
        analyzingIds: s.analyzingIds.filter((id) => id !== input.id),
        progress: { done: i + 1, total: inputs.length },
      }));
    }
    set({ analyzing: false, analyzingIds: [], analysisCancelRequested: false });
  },

  cancelAnalysis: () => set({ analysisCancelRequested: true }),

  addAndAnalyze: async (inputs) => {
    // Deduplicate new locations against the existing set: existing entries
    // are already unique and come first, so the newly accepted ones are
    // exactly the tail of `unique` after the existing entries.
    const existing = get().dealerships;
    const { unique, duplicates } = dedupeDealerships([...existing, ...inputs]);
    const fresh = unique.slice(existing.length);
    if (fresh.length === 0) return duplicates.length;

    // Make pending pins with coordinates visible immediately.
    for (const input of fresh) {
      if (input.lat != null && input.lon != null) {
        get().upsertDealership({ ...input } as AnalyzedDealership);
      }
    }

    const freshIds = fresh.map((f) => f.id);
    set((s) => ({
      lastAddedIds: freshIds,
      // Single address → select directly so the map flies to it.
      selectedId: freshIds.length === 1 ? freshIds[0] : s.selectedId,
      analyzing: true,
      progress: { done: 0, total: fresh.length },
      analysisCancelRequested: false,
      analysisErrors: fresh.reduce<Record<string, string>>(
        (errors, input) => {
          delete errors[input.id];
          return errors;
        },
        { ...get().analysisErrors },
      ),
    }));

    for (let i = 0; i < fresh.length && !get().analysisCancelRequested; i++) {
      const input = fresh[i];
      set((s) => ({ analyzingIds: [...s.analyzingIds, input.id] }));
      try {
        const result = await window.api.analyzeDealership(
          input,
          get().parameters,
        );
        get().upsertDealership(result);
      } catch (err) {
        const message = errorMessage(err);
        console.error(`Analysis failed for ${input.name}:`, err);
        set((s) => ({
          analysisErrors: { ...s.analysisErrors, [input.id]: message },
        }));
      }
      set((s) => ({
        analyzingIds: s.analyzingIds.filter((id) => id !== input.id),
        progress: { done: i + 1, total: fresh.length },
      }));
    }
    set({ analyzing: false, analyzingIds: [], analysisCancelRequested: false });
    return duplicates.length;
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
    };
  },

  saveSession: async () => {
    const session = get().currentSession();
    await window.api.saveSession(session);
    set({
      sessionId: session.id,
      sessionName: session.name,
      lastSavedAt: session.updatedAt,
    });
  },
}));

function withoutKey(
  values: Record<string, string>,
  key: string,
): Record<string, string> {
  if (!(key in values)) return values;
  const copy = { ...values };
  delete copy[key];
  return copy;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function boundaryNeedsReview(
  boundary: NonNullable<AnalyzedDealership["boundary"]>,
  parameters: RiskParameters,
): boolean {
  return (
    boundary.source === "synthetic" ||
    boundary.role !== "operationalLot" ||
    boundary.confidence < parameters.boundaryReviewConfidence ||
    (boundary.quality?.top2Margin ?? 1) < parameters.boundaryReviewTop2Margin ||
    boundary.quality?.pointRelation === "outside" ||
    (boundary.quality?.sourceAgreement ?? 0) <
      parameters.boundaryReviewSourceAgreement ||
    (boundary.quality?.areaPlausibility ?? 0) < 0.5
  );
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
  const peril = (name: string): number | undefined =>
    d.risk?.perils.find((p) => p.peril === name)?.score;
  const score = d.risk?.overallScore;
  return {
    id: d.id,
    name: d.name,
    riskLevel: score == null ? undefined : riskLevel(score),
    overallScore: score,
    vehicleCount: d.detection ? effectiveVehicleCount(d.detection) : undefined,
    utilisation: d.risk?.utilisation,
    eal: d.risk?.eal,
    exposureEur: d.risk?.exposureEur,
    hailScore: peril("hail"),
    windScore: peril("wind"),
    floodScore: peril("flood"),
    snowScore: peril("snow"),
    lightningScore: peril("lightning"),
    heatScore: peril("heat"),
    boundarySource: d.boundary?.source,
    boundaryConfidence: d.boundary?.confidence,
    insured: d.insured,
    salesPartner: d.salesPartner,
    subPortfolio: d.subPortfolio,
    group: d.group,
  };
}
