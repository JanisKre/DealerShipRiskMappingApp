/**
 * Central IPC channel names as constants — no magic strings.
 * Naming convention: 'domain:action'.
 */
export const IPC = {
  // CSV / Import
  parseCsv: "csv:parse",
  parseXlsx: "xlsx:parse",
  parseZuersCsv: "natcat:zuers:parseCsv",
  parseZuersXlsx: "natcat:zuers:parseXlsx",

  // Geocoding
  geocode: "geocode:search",

  // Places — address autocomplete (Photon / OpenStreetMap)
  placesAutocomplete: "places:autocomplete",

  // Boundary
  detectBoundary: "boundary:detect",

  // Additional OSM info for a location (website, phone, opening hours, ...)
  osmDetails: "osm:details",

  // Vehicle detection
  detectVehicles: "detect:vehicles",

  // Weather / Risk
  fetchWeather: "weather:fetch",
  scoreRisk: "risk:score",
  fetchCatNet: "natcat:catnet:lookup",

  // Complete analysis pipeline run for one dataset
  analyzeDealership: "analyze:dealership",

  // Sessions (SQLite)
  listSessions: "sessions:list",
  loadSession: "sessions:load",
  saveSession: "sessions:save",
  deleteSession: "sessions:delete",

  // Conversations / chat history (SQLite)
  listConversations: "conversations:list",
  loadConversation: "conversations:load",
  saveConversation: "conversations:save",
  deleteConversation: "conversations:delete",

  // AI dashboards (SQLite) + spec generation (invoke)
  llmDashboardSpec: "llm:dashboardSpec",
  listDashboards: "dashboards:list",
  loadDashboard: "dashboards:load",
  saveDashboard: "dashboards:save",
  deleteDashboard: "dashboards:delete",

  // File export/import (replaces share token)
  exportPortfolioFile: "portfolio:export",
  importPortfolioFile: "portfolio:import",
  exportReport: "report:export", // CSV/PDF/Excel
  exportReadonlyView: "report:readonlyView", // standalone HTML bundle

  // LLM — invoke-based (non-streaming, structured)
  llmMemo: "llm:memo", // structured underwriting memo (StructuredMemo)

  // LLM — streaming (not via invoke; see streaming pattern in ipc/index.ts)
  llmStream: "llm:stream", // generic start channel (renderer -> main)
  // Sub-actions of the streaming channel (payload.kind)
  llmStreamChat: "chat", // portfolio chat with history
  llmStreamSummary: "summary", // executive summary
  llmStreamNlQuery: "nlquery", // 2-phase NL query (filter + summary)

  // Settings
  getSettings: "settings:get",
  setSettings: "settings:set",
  setLlmApiKey: "settings:setLlmApiKey", // -> safeStorage
  setNatCatApiKey: "settings:setNatCatApiKey", // -> safeStorage

  // Map screenshot (Electron capturePage)
  mapCapture: "map:capture",

  // Vehicle detection model: status + install wizard download
  modelStatus: "model:status", // invoke -> { available: boolean }
  // Streaming like llm:stream (send/receive), not invoke — long downloads with progress.
  modelDownload: "model:download", // renderer -> main (start)
  modelDownloadCancel: "model:download:cancel",
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

/** Streaming actions that run over the `llm:stream` channel. */
export const LLM_STREAM_KINDS = ["chat", "summary", "nlquery"] as const;
export type LlmStreamKind = (typeof LLM_STREAM_KINDS)[number];
