import type {
  AnalyzedDealership,
  BoundaryEditState,
  BoundaryResult,
  DealershipInput,
  HailstormScenario,
  ImportReport,
  ManualVehiclePoint,
  RiskParameters,
  Session,
} from "@shared/types";
import { type PortfolioMergeResult } from "@shared/portfolio-merge";

/** State and actions of the central renderer store (`appStore`). */

export interface AppState {
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
  /**
   * Drops one imported row that never reached the map (no coordinates,
   * address not found) from the queue and the error list.
   */
  discardUnlocatedInput: (id: string) => void;
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
  /** Message of the last failed save; null once a save succeeds again. */
  saveError: string | null;
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
  /**
   * Set while a saved state ("Stand") is the open portfolio: the id of the
   * portfolio it was taken from. Kept on every save so the flag survives.
   */
  sessionSnapshotOf: string | null;
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

export type StoreSet = (
  partial: Partial<AppState> | ((s: AppState) => Partial<AppState>),
) => void;
