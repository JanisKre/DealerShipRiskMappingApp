import { create } from "zustand";
import type {
  AnalyzedDealership,
  DealershipInput,
  HailstormScenario,
  ImportReport,
  NlQueryDealership,
  Session,
} from "@shared/types";
import { dedupeDealerships } from "@shared/dedupe";
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
  selectedId: string | null;
  analyzing: boolean;
  progress: { done: number; total: number } | null;
  /** IDs whose background analysis is currently running (pin feedback). */
  analyzingIds: string[];
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
  select: (id: string | null) => void;
  /** Permanently removes a location from the portfolio. */
  removeDealership: (id: string) => void;
  /** Re-analyzes an existing location (recomputes boundary/detection/risk). */
  reanalyzeDealership: (id: string) => Promise<void>;
  analyzeAll: (inputs: DealershipInput[]) => Promise<void>;
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
}

const EMPTY_FILTERS: PortfolioFilters = {
  subPortfolio: null,
  salesPartner: null,
  group: null,
  clusterId: null,
};

export const useAppStore = create<AppState>((set, get) => ({
  sessionId: null,
  sessionName: "New Portfolio",
  dealerships: [],
  selectedId: null,
  analyzing: false,
  progress: null,
  analyzingIds: [],
  lastAddedIds: [],
  lastSavedAt: null,
  lastImportReport: null,
  scenario: null,
  comparison: null,
  nlQueryMatchedIds: null,
  filters: EMPTY_FILTERS,

  setSession: (id, name) => set({ sessionId: id, sessionName: name }),
  setSessionName: (name) => set({ sessionName: name }),
  setImportReport: (lastImportReport) => set({ lastImportReport }),
  setDealerships: (dealerships) => set({ dealerships }),
  upsertDealership: (d) =>
    set((s) => {
      const idx = s.dealerships.findIndex((x) => x.id === d.id);
      if (idx === -1) return { dealerships: [...s.dealerships, d] };
      const copy = [...s.dealerships];
      copy[idx] = d;
      return { dealerships: copy };
    }),
  updateBoundary: (id, boundary) =>
    set((s) => {
      const copy = s.dealerships.map((d) =>
        d.id === id ? { ...d, boundary } : d,
      );
      return { dealerships: copy };
    }),
  updateBoundaryAndRescore: async (id, boundary) => {
    // 1) Write the boundary + area back immediately so it's visible.
    get().updateBoundary(id, boundary);
    const d = get().dealerships.find((x) => x.id === id);
    if (!d) return;
    // 2) Recompute risk with the new area (capacity/utilisation/EAL).
    try {
      const risk = await window.api.scoreRisk(
        d.lat,
        d.lon,
        d.assetValue,
        d.detection,
        boundary,
      );
      get().upsertDealership({ ...get().dealerships.find((x) => x.id === id)!, risk });
    } catch (err) {
      console.error(`Rescoring after boundary edit failed (${id}):`, err);
    }
  },
  updateDealershipMeta: (id, patch) =>
    set((s) => {
      const copy = s.dealerships.map((d) =>
        d.id === id ? { ...d, ...patch } : d,
      );
      return { dealerships: copy };
    }),
  select: (id) => set({ selectedId: id }),

  removeDealership: (id) =>
    set((s) => ({
      dealerships: s.dealerships.filter((d) => d.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    })),

  reanalyzeDealership: async (id) => {
    const d = get().dealerships.find((x) => x.id === id);
    if (!d) return;
    set((s) => ({ analyzingIds: [...s.analyzingIds, id] }));
    try {
      const result = await window.api.analyzeDealership(d);
      get().upsertDealership(result);
    } catch (err) {
      console.error(`Re-analysis failed for ${d.name}:`, err);
    } finally {
      set((s) => ({ analyzingIds: s.analyzingIds.filter((x) => x !== id) }));
    }
  },

  analyzeAll: async (inputs) => {
    set({
      analyzing: true,
      progress: { done: 0, total: inputs.length },
      dealerships: [],
    });
    for (let i = 0; i < inputs.length; i++) {
      try {
        const result = await window.api.analyzeDealership(inputs[i]);
        get().upsertDealership(result);
      } catch (err) {
        console.error(`Analysis failed for ${inputs[i].name}:`, err);
      }
      set({ progress: { done: i + 1, total: inputs.length } });
    }
    set({ analyzing: false });
  },

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
    }));

    for (let i = 0; i < fresh.length; i++) {
      const input = fresh[i];
      set((s) => ({ analyzingIds: [...s.analyzingIds, input.id] }));
      try {
        const result = await window.api.analyzeDealership(input);
        get().upsertDealership(result);
      } catch (err) {
        console.error(`Analysis failed for ${input.name}:`, err);
      }
      set((s) => ({
        analyzingIds: s.analyzingIds.filter((id) => id !== input.id),
        progress: { done: i + 1, total: fresh.length },
      }));
    }
    set({ analyzing: false });
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
    vehicleCount: d.detection?.vehicleCount,
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
