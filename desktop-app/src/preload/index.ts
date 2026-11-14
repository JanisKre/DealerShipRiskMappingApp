import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "@shared/ipc-channels";
import type {
  DealerDirectoryChunk,
  IpcRequest,
  IpcResponse,
  LlmStreamChunk,
  LlmStreamRequest,
  ModelDownloadChunk,
  OllamaPullChunk,
  UpdateStatus,
} from "@shared/ipc-schema";

/**
 * Exposes a typed, whitelisted API to the renderer. The renderer gets no
 * direct ipcRenderer access — only these methods.
 */
const api = {
  parseCsv: (
    content: string,
    overrides?: IpcRequest["csv:parse"]["overrides"],
  ): Promise<IpcResponse["csv:parse"]> =>
    ipcRenderer.invoke(IPC.parseCsv, {
      content,
      overrides,
    } satisfies IpcRequest["csv:parse"]),

  parseXlsx: (
    base64: string,
    overrides?: IpcRequest["xlsx:parse"]["overrides"],
  ): Promise<IpcResponse["xlsx:parse"]> =>
    ipcRenderer.invoke(IPC.parseXlsx, {
      base64,
      overrides,
    } satisfies IpcRequest["xlsx:parse"]),

  geocode: (query: string): Promise<IpcResponse["geocode:search"]> =>
    ipcRenderer.invoke(IPC.geocode, {
      query,
    } satisfies IpcRequest["geocode:search"]),

  placesAutocomplete: (
    query: string,
    near?: IpcRequest["places:autocomplete"]["near"],
  ): Promise<IpcResponse["places:autocomplete"]> =>
    ipcRenderer.invoke(IPC.placesAutocomplete, {
      query,
      near,
    } satisfies IpcRequest["places:autocomplete"]),

  detectBoundary: (
    lat: number,
    lon: number,
    name?: string,
    address?: string,
    parameters?: IpcRequest["boundary:detect"]["parameters"],
  ): Promise<IpcResponse["boundary:detect"]> =>
    ipcRenderer.invoke(IPC.detectBoundary, {
      lat,
      lon,
      name,
      address,
      parameters,
    } satisfies IpcRequest["boundary:detect"]),

  detectVehicles: (
    lat: number,
    lon: number,
    boundary?: IpcRequest["detect:vehicles"]["boundary"],
    parameters?: IpcRequest["detect:vehicles"]["parameters"],
  ): Promise<IpcResponse["detect:vehicles"]> =>
    ipcRenderer.invoke(IPC.detectVehicles, {
      lat,
      lon,
      boundary,
      parameters,
    } satisfies IpcRequest["detect:vehicles"]),

  countVehiclesOverTime: (
    lat: number,
    lon: number,
    boundary?: IpcRequest["detect:vehiclesTimeline"]["boundary"],
    parameters?: IpcRequest["detect:vehiclesTimeline"]["parameters"],
  ): Promise<IpcResponse["detect:vehiclesTimeline"]> =>
    ipcRenderer.invoke(IPC.detectVehiclesTimeline, {
      lat,
      lon,
      boundary,
      parameters,
    } satisfies IpcRequest["detect:vehiclesTimeline"]),

  getOsmDetails: (
    lat: number,
    lon: number,
    name?: string,
    address?: string,
  ): Promise<IpcResponse["osm:details"]> =>
    ipcRenderer.invoke(IPC.osmDetails, {
      lat,
      lon,
      name,
      address,
    } satisfies IpcRequest["osm:details"]),

  hailHistory: (
    lat: number,
    lon: number,
  ): Promise<IpcResponse["hail:history"]> =>
    ipcRenderer.invoke(IPC.hailHistory, {
      lat,
      lon,
    } satisfies IpcRequest["hail:history"]),

  radarHail: (lat: number, lon: number): Promise<IpcResponse["hail:radar"]> =>
    ipcRenderer.invoke(IPC.radarHail, {
      lat,
      lon,
    } satisfies IpcRequest["hail:radar"]),

  hailEventsList: (): Promise<IpcResponse["hailEvents:list"]> =>
    ipcRenderer.invoke(IPC.hailEventsList),

  hailEventsGet: (id: string): Promise<IpcResponse["hailEvents:get"]> =>
    ipcRenderer.invoke(IPC.hailEventsGet, {
      id,
    } satisfies IpcRequest["hailEvents:get"]),

  hailEventsImport: (
    name: string,
    content: string,
  ): Promise<IpcResponse["hailEvents:import"]> =>
    ipcRenderer.invoke(IPC.hailEventsImport, {
      name,
      content,
    } satisfies IpcRequest["hailEvents:import"]),

  hailEventsDelete: (id: string): Promise<IpcResponse["hailEvents:delete"]> =>
    ipcRenderer.invoke(IPC.hailEventsDelete, {
      id,
    } satisfies IpcRequest["hailEvents:delete"]),

  hailEventsLoadHistoric: (
    day: string,
  ): Promise<IpcResponse["hailEvents:loadHistoric"]> =>
    ipcRenderer.invoke(IPC.hailEventsLoadHistoric, {
      day,
    } satisfies IpcRequest["hailEvents:loadHistoric"]),

  hailEventsSave: (
    request: IpcRequest["hailEvents:save"],
  ): Promise<IpcResponse["hailEvents:save"]> =>
    ipcRenderer.invoke(IPC.hailEventsSave, request),

  fetchWeather: (
    lat: number,
    lon: number,
  ): Promise<IpcResponse["weather:fetch"]> =>
    ipcRenderer.invoke(IPC.fetchWeather, {
      lat,
      lon,
    } satisfies IpcRequest["weather:fetch"]),

  scoreRisk: (
    lat: number,
    lon: number,
    assetValue?: number,
    detection?: IpcRequest["risk:score"]["detection"],
    boundary?: IpcRequest["risk:score"]["boundary"],
    parameters?: IpcRequest["risk:score"]["parameters"],
    natCat?: IpcRequest["risk:score"]["natCat"],
    hailZone?: IpcRequest["risk:score"]["hailZone"],
  ): Promise<IpcResponse["risk:score"]> =>
    ipcRenderer.invoke(IPC.scoreRisk, {
      lat,
      lon,
      assetValue,
      detection,
      boundary,
      parameters,
      natCat,
      hailZone,
    } satisfies IpcRequest["risk:score"]),

  /** Re-resolves the hail source chosen in the settings for one location. */
  resolveNatCat: (
    lat: number,
    lon: number,
  ): Promise<IpcResponse["natcat:resolve"]> =>
    ipcRenderer.invoke(IPC.resolveNatCat, {
      lat,
      lon,
    } satisfies IpcRequest["natcat:resolve"]),

  testNatCatConnector: (
    provider: IpcRequest["natcat:testConnector"]["provider"],
  ): Promise<IpcResponse["natcat:testConnector"]> =>
    ipcRenderer.invoke(IPC.testNatCatConnector, {
      provider,
    } satisfies IpcRequest["natcat:testConnector"]),

  analyzeDealership: (
    dealership: IpcRequest["analyze:dealership"]["dealership"],
    parameters?: IpcRequest["analyze:dealership"]["parameters"],
  ): Promise<IpcResponse["analyze:dealership"]> =>
    ipcRenderer.invoke(IPC.analyzeDealership, {
      dealership,
      parameters,
    } satisfies IpcRequest["analyze:dealership"]),

  listSessions: (): Promise<IpcResponse["sessions:list"]> =>
    ipcRenderer.invoke(IPC.listSessions),

  loadSession: (id: string): Promise<IpcResponse["sessions:load"]> =>
    ipcRenderer.invoke(IPC.loadSession, {
      id,
    } satisfies IpcRequest["sessions:load"]),

  saveSession: (
    session: IpcRequest["sessions:save"]["session"],
  ): Promise<IpcResponse["sessions:save"]> =>
    ipcRenderer.invoke(IPC.saveSession, {
      session,
    } satisfies IpcRequest["sessions:save"]),

  deleteSession: (id: string): Promise<IpcResponse["sessions:delete"]> =>
    ipcRenderer.invoke(IPC.deleteSession, {
      id,
    } satisfies IpcRequest["sessions:delete"]),

  listConversations: (): Promise<IpcResponse["conversations:list"]> =>
    ipcRenderer.invoke(IPC.listConversations),

  loadConversation: (id: string): Promise<IpcResponse["conversations:load"]> =>
    ipcRenderer.invoke(IPC.loadConversation, {
      id,
    } satisfies IpcRequest["conversations:load"]),

  saveConversation: (
    conversation: IpcRequest["conversations:save"]["conversation"],
  ): Promise<IpcResponse["conversations:save"]> =>
    ipcRenderer.invoke(IPC.saveConversation, {
      conversation,
    } satisfies IpcRequest["conversations:save"]),

  deleteConversation: (
    id: string,
  ): Promise<IpcResponse["conversations:delete"]> =>
    ipcRenderer.invoke(IPC.deleteConversation, {
      id,
    } satisfies IpcRequest["conversations:delete"]),

  classifyChatIntent: (
    request: IpcRequest["llm:chatIntent"],
  ): Promise<IpcResponse["llm:chatIntent"]> =>
    ipcRenderer.invoke(
      IPC.llmChatIntent,
      request satisfies IpcRequest["llm:chatIntent"],
    ),

  /** Optional AI draft of a hailstorm scenario from one sentence. */
  draftScenario: (
    request: IpcRequest["llm:scenarioDraft"],
  ): Promise<IpcResponse["llm:scenarioDraft"]> =>
    ipcRenderer.invoke(
      IPC.llmScenarioDraft,
      request satisfies IpcRequest["llm:scenarioDraft"],
    ),

  /** Optional AI choice of read-only lookups before a chat answer. */
  planChatTools: (
    request: IpcRequest["llm:chatTools"],
  ): Promise<IpcResponse["llm:chatTools"]> =>
    ipcRenderer.invoke(
      IPC.llmChatTools,
      request satisfies IpcRequest["llm:chatTools"],
    ),

  /** Optional AI suggestion for unused import columns (names and hints only). */
  suggestColumnMapping: (
    request: IpcRequest["llm:columnMapping"],
  ): Promise<IpcResponse["llm:columnMapping"]> =>
    ipcRenderer.invoke(
      IPC.llmColumnMapping,
      request satisfies IpcRequest["llm:columnMapping"],
    ),

  /** Optional AI order for the review queue (the fixed queue always works). */
  proposeReviewOrder: (
    request: IpcRequest["llm:reviewPlan"],
  ): Promise<IpcResponse["llm:reviewPlan"]> =>
    ipcRenderer.invoke(
      IPC.llmReviewPlan,
      request satisfies IpcRequest["llm:reviewPlan"],
    ),

  generateDashboard: (
    request: IpcRequest["llm:dashboardSurface"],
  ): Promise<IpcResponse["llm:dashboardSurface"]> =>
    ipcRenderer.invoke(
      IPC.llmDashboardSurface,
      request satisfies IpcRequest["llm:dashboardSurface"],
    ),

  listDashboards: (): Promise<IpcResponse["dashboards:list"]> =>
    ipcRenderer.invoke(IPC.listDashboards),

  loadDashboard: (id: string): Promise<IpcResponse["dashboards:load"]> =>
    ipcRenderer.invoke(IPC.loadDashboard, {
      id,
    } satisfies IpcRequest["dashboards:load"]),

  saveDashboard: (
    dashboard: IpcRequest["dashboards:save"]["dashboard"],
  ): Promise<IpcResponse["dashboards:save"]> =>
    ipcRenderer.invoke(IPC.saveDashboard, {
      dashboard,
    } satisfies IpcRequest["dashboards:save"]),

  deleteDashboard: (id: string): Promise<IpcResponse["dashboards:delete"]> =>
    ipcRenderer.invoke(IPC.deleteDashboard, {
      id,
    } satisfies IpcRequest["dashboards:delete"]),

  exportPortfolioFile: (
    session: IpcRequest["portfolio:export"]["session"],
  ): Promise<IpcResponse["portfolio:export"]> =>
    ipcRenderer.invoke(IPC.exportPortfolioFile, {
      session,
    } satisfies IpcRequest["portfolio:export"]),

  importPortfolioFile: (): Promise<IpcResponse["portfolio:import"]> =>
    ipcRenderer.invoke(IPC.importPortfolioFile),

  exportReport: (
    session: IpcRequest["report:export"]["session"],
    format: IpcRequest["report:export"]["format"],
  ): Promise<IpcResponse["report:export"]> =>
    ipcRenderer.invoke(IPC.exportReport, {
      session,
      format,
    } satisfies IpcRequest["report:export"]),

  exportLocationReport: (
    request: IpcRequest["report:location"],
  ): Promise<IpcResponse["report:location"]> =>
    ipcRenderer.invoke(
      IPC.exportLocationReport,
      request satisfies IpcRequest["report:location"],
    ),

  exportReadonlyView: (
    session: IpcRequest["report:readonlyView"]["session"],
  ): Promise<IpcResponse["report:readonlyView"]> =>
    ipcRenderer.invoke(IPC.exportReadonlyView, {
      session,
    } satisfies IpcRequest["report:readonlyView"]),

  llmMemo: (
    dealership: IpcRequest["llm:memo"]["dealership"],
  ): Promise<IpcResponse["llm:memo"]> =>
    ipcRenderer.invoke(IPC.llmMemo, {
      dealership,
    } satisfies IpcRequest["llm:memo"]),

  /**
   * Starts an LLM stream. The main process sends chunks over a dedicated
   * response channel `llm:stream:<id>`. Returns a `stop()` function that
   * removes the listener (abort/cleanup). `onChunk` receives every chunk
   * immediately.
   */
  llmStream: (
    req: LlmStreamRequest,
    onChunk: (chunk: LlmStreamChunk) => void,
  ): (() => void) => {
    const streamId = globalThis.crypto.randomUUID();
    const responseChannel = `${IPC.llmStream}:${streamId}`;
    const listener = (_e: unknown, chunk: LlmStreamChunk): void =>
      onChunk(chunk);
    ipcRenderer.on(responseChannel, listener);
    ipcRenderer.send(IPC.llmStream, { streamId, req });
    return () => {
      ipcRenderer.removeListener(responseChannel, listener);
      ipcRenderer.send(`${IPC.llmStream}:cancel`, { streamId });
    };
  },

  /** Minimal request with the saved LLM configuration. */
  testLlmConnection: (): Promise<IpcResponse["llm:testConnection"]> =>
    ipcRenderer.invoke(IPC.llmTestConnection),

  /** Live model list of the configured provider. */
  listLlmModels: (): Promise<IpcResponse["llm:listModels"]> =>
    ipcRenderer.invoke(IPC.llmListModels),

  /** Which local runtimes (Ollama, LM Studio, llama.cpp) are running. */
  detectLocalRuntimes: (): Promise<IpcResponse["llm:detectLocal"]> =>
    ipcRenderer.invoke(IPC.llmDetectLocal),

  searchHfModels: (
    query: string,
    sort: IpcRequest["hf:searchModels"]["sort"],
  ): Promise<IpcResponse["hf:searchModels"]> =>
    ipcRenderer.invoke(IPC.hfSearchModels, {
      query,
      sort,
    } satisfies IpcRequest["hf:searchModels"]),

  hfModelFiles: (repoId: string): Promise<IpcResponse["hf:modelFiles"]> =>
    ipcRenderer.invoke(IPC.hfModelFiles, {
      repoId,
    } satisfies IpcRequest["hf:modelFiles"]),

  /**
   * Installs a Hugging Face GGUF model into the local Ollama. Same streaming
   * pattern as `downloadModel`: `onChunk` receives progress/result, the
   * returned function aborts the pull.
   */
  pullOllamaModel: (
    model: string,
    onChunk: (chunk: OllamaPullChunk) => void,
  ): (() => void) => {
    const streamId = globalThis.crypto.randomUUID();
    const responseChannel = `${IPC.ollamaPull}:${streamId}`;
    const listener = (_e: unknown, chunk: OllamaPullChunk): void =>
      onChunk(chunk);
    ipcRenderer.on(responseChannel, listener);
    ipcRenderer.send(IPC.ollamaPull, { streamId, model });
    return () => {
      ipcRenderer.removeListener(responseChannel, listener);
      ipcRenderer.send(IPC.ollamaPullCancel, { streamId });
    };
  },

  getSettings: (): Promise<IpcResponse["settings:get"]> =>
    ipcRenderer.invoke(IPC.getSettings),

  setSettings: (
    settings: IpcRequest["settings:set"]["settings"],
  ): Promise<IpcResponse["settings:set"]> =>
    ipcRenderer.invoke(IPC.setSettings, {
      settings,
    } satisfies IpcRequest["settings:set"]),

  setLlmApiKey: (
    provider: IpcRequest["settings:setLlmApiKey"]["provider"],
    apiKey: string,
  ): Promise<IpcResponse["settings:setLlmApiKey"]> =>
    ipcRenderer.invoke(IPC.setLlmApiKey, {
      provider,
      apiKey,
    } satisfies IpcRequest["settings:setLlmApiKey"]),

  setNatCatApiKey: (
    provider: IpcRequest["settings:setNatCatApiKey"]["provider"],
    apiKey: string,
  ): Promise<IpcResponse["settings:setNatCatApiKey"]> =>
    ipcRenderer.invoke(IPC.setNatCatApiKey, {
      provider,
      apiKey,
    } satisfies IpcRequest["settings:setNatCatApiKey"]),

  deleteNatCatApiKey: (
    provider: IpcRequest["settings:deleteNatCatApiKey"]["provider"],
  ): Promise<IpcResponse["settings:deleteNatCatApiKey"]> =>
    ipcRenderer.invoke(IPC.deleteNatCatApiKey, {
      provider,
    } satisfies IpcRequest["settings:deleteNatCatApiKey"]),

  writeClipboardText: (
    text: string,
  ): Promise<IpcResponse["clipboard:writeText"]> =>
    ipcRenderer.invoke(IPC.clipboardWriteText, {
      text,
    } satisfies IpcRequest["clipboard:writeText"]),

  captureMap: (
    rect: IpcRequest["map:capture"]["rect"],
    mode: IpcRequest["map:capture"]["mode"],
  ): Promise<IpcResponse["map:capture"]> =>
    ipcRenderer.invoke(IPC.mapCapture, {
      rect,
      mode,
    } satisfies IpcRequest["map:capture"]),

  selectImagery: (
    lat: number,
    lon: number,
    zoom: number,
  ): Promise<IpcResponse["imagery:select"]> =>
    ipcRenderer.invoke(IPC.imagerySelect, {
      lat,
      lon,
      zoom,
    } satisfies IpcRequest["imagery:select"]),

  imageryTimeline: (
    lat: number,
    lon: number,
    zoom: number,
  ): Promise<IpcResponse["imagery:timeline"]> =>
    ipcRenderer.invoke(IPC.imageryTimeline, {
      lat,
      lon,
      zoom,
    } satisfies IpcRequest["imagery:timeline"]),

  /** Loads the context image of a location into the tile cache, in the background. */
  prefetchImagery: (
    lat: number,
    lon: number,
  ): Promise<IpcResponse["imagery:prefetch"]> =>
    ipcRenderer.invoke(IPC.imageryPrefetch, {
      lat,
      lon,
    } satisfies IpcRequest["imagery:prefetch"]),

  hailZoneOverlay: (): Promise<IpcResponse["hailZones:overlay"]> =>
    ipcRenderer.invoke(IPC.hailZoneOverlay),
  modelStatus: (): Promise<IpcResponse["model:status"]> =>
    ipcRenderer.invoke(IPC.modelStatus),

  /**
   * Starts the model download for the install wizard. Same streaming pattern
   * as `llmStream`: `onChunk` receives progress/result, the returned function
   * aborts the download.
   */
  downloadModel: (
    onChunk: (chunk: ModelDownloadChunk) => void,
  ): (() => void) => {
    const streamId = globalThis.crypto.randomUUID();
    const responseChannel = `${IPC.modelDownload}:${streamId}`;
    const listener = (_e: unknown, chunk: ModelDownloadChunk): void =>
      onChunk(chunk);
    ipcRenderer.on(responseChannel, listener);
    ipcRenderer.send(IPC.modelDownload, { streamId });
    return () => {
      ipcRenderer.removeListener(responseChannel, listener);
      ipcRenderer.send(`${IPC.modelDownload}:cancel`, { streamId });
    };
  },

  dealerDirectoryStatus: (): Promise<IpcResponse["dealerDirectory:status"]> =>
    ipcRenderer.invoke(IPC.dealerDirectoryStatus),

  /** Whether Overture has a newer release than the local directory (checked daily). */
  dealerDirectoryUpdate: (): Promise<IpcResponse["dealerDirectory:update"]> =>
    ipcRenderer.invoke(IPC.dealerDirectoryUpdate),

  /**
   * Downloads the Overture dealer directory. Same streaming pattern as
   * `downloadModel`: `onChunk` receives progress/result, the returned function
   * aborts the download.
   */
  refreshDealerDirectory: (
    onChunk: (chunk: DealerDirectoryChunk) => void,
  ): (() => void) => {
    const streamId = globalThis.crypto.randomUUID();
    const responseChannel = `${IPC.dealerDirectoryRefresh}:${streamId}`;
    const listener = (_e: unknown, chunk: DealerDirectoryChunk): void =>
      onChunk(chunk);
    ipcRenderer.on(responseChannel, listener);
    ipcRenderer.send(IPC.dealerDirectoryRefresh, { streamId });
    return () => {
      ipcRenderer.removeListener(responseChannel, listener);
      ipcRenderer.send(IPC.dealerDirectoryRefreshCancel, { streamId });
    };
  },

  updateStatus: (): Promise<IpcResponse["update:status"]> =>
    ipcRenderer.invoke(IPC.updateStatus),
  checkForUpdates: (): Promise<IpcResponse["update:check"]> =>
    ipcRenderer.invoke(IPC.updateCheck),
  downloadUpdate: (): Promise<IpcResponse["update:download"]> =>
    ipcRenderer.invoke(IPC.updateDownload),
  installUpdate: (): Promise<IpcResponse["update:install"]> =>
    ipcRenderer.invoke(IPC.updateInstall),
  /** Calls `onChange` on every update status change; returns the unsubscribe. */
  onUpdateStatus: (onChange: (status: UpdateStatus) => void): (() => void) => {
    const listener = (_e: unknown, status: UpdateStatus): void =>
      onChange(status);
    ipcRenderer.on(IPC.updateChanged, listener);
    return () => {
      ipcRenderer.removeListener(IPC.updateChanged, listener);
    };
  },

  /** Saves a diagnostics report (no portfolios) where the user picks. */
  exportDiagnostics: (): Promise<IpcResponse["diagnostics:export"]> =>
    ipcRenderer.invoke(IPC.diagnosticsExport),

  /** Deletes all local data and restarts the app. */
  resetAllData: (): Promise<IpcResponse["data:resetAll"]> =>
    ipcRenderer.invoke(IPC.dataResetAll, {
      confirm: "delete-all-data",
    } satisfies IpcRequest["data:resetAll"]),
};

export type DrmApi = typeof api;

contextBridge.exposeInMainWorld("api", api);
