import { create } from "zustand";
import { DEFAULT_RISK_PARAMETERS } from "@shared/parameters";
import { type AppState } from "./app/types";
import { EMPTY_FILTERS, DEFAULT_PORTFOLIO_NAME } from "./app/helpers";
import { sessionActions } from "./app/sessionActions";
import { parameterActions } from "./app/parameterActions";
import { boundaryActions } from "./app/boundaryActions";
import { dealershipActions } from "./app/dealershipActions";
import { analysisActions } from "./app/analysisActions";

/**
 * Central renderer store. Holds the active portfolio plus derived UI
 * state: hailstorm scenario, comparison session, and an optional NL query
 * hit list (IDs) that filters the dashboard. The chat history lives in a
 * separate store (`conversationStore`, SQLite-persisted).
 *
 * The state shape is in `app/types`, the actions are grouped by topic in
 * `app/*Actions`, pure helpers in `app/helpers`, and the bookkeeping shared
 * by the actions (portfolio generation, saved snapshot, analysis queue) in
 * `app/runtime`. Importers keep using this module.
 */
export * from "./app/types";
export * from "./app/helpers";

export const useAppStore = create<AppState>((set, get) => ({
  sessionId: null,
  sessionName: DEFAULT_PORTFOLIO_NAME,
  sessionSnapshotOf: null,
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
  saveError: null,
  lastImportReport: null,
  scenario: null,
  comparison: null,
  nlQueryMatchedIds: null,
  filters: EMPTY_FILTERS,
  select: (id) => set({ selectedId: id }),
  focusDealerships: (ids, radiusKm) =>
    set({
      mapFocusIds: ids,
      mapFocusRadiusKm: radiusKm ?? null,
      selectedId: null,
    }),
  clearMapFocus: () => set({ mapFocusIds: null, mapFocusRadiusKm: null }),
  setScenario: (scenario) => set({ scenario }),
  setComparison: (comparison) => set({ comparison }),
  setNlQueryMatchedIds: (nlQueryMatchedIds) => set({ nlQueryMatchedIds }),
  setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
  resetFilters: () => set({ filters: EMPTY_FILTERS }),

  ...sessionActions(set, get),
  ...parameterActions(set, get),
  ...boundaryActions(set, get),
  ...dealershipActions(set, get),
  ...analysisActions(set, get),
}));
