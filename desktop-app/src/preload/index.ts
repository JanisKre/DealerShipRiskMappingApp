import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "@shared/ipc-channels";
import type {
  IpcRequest,
  IpcResponse,
  LlmStreamChunk,
  LlmStreamRequest,
  ModelDownloadChunk,
} from "@shared/ipc-schema";

/**
 * Exposes a typed, whitelisted API to the renderer. The renderer gets no
 * direct ipcRenderer access — only these methods.
 */
const api = {
  parseCsv: (content: string): Promise<IpcResponse["csv:parse"]> =>
    ipcRenderer.invoke(IPC.parseCsv, {
      content,
    } satisfies IpcRequest["csv:parse"]),

  parseXlsx: (base64: string): Promise<IpcResponse["xlsx:parse"]> =>
    ipcRenderer.invoke(IPC.parseXlsx, {
      base64,
    } satisfies IpcRequest["xlsx:parse"]),

  geocode: (query: string): Promise<IpcResponse["geocode:search"]> =>
    ipcRenderer.invoke(IPC.geocode, {
      query,
    } satisfies IpcRequest["geocode:search"]),

  placesAutocomplete: (
    query: string,
  ): Promise<IpcResponse["places:autocomplete"]> =>
    ipcRenderer.invoke(IPC.placesAutocomplete, {
      query,
    } satisfies IpcRequest["places:autocomplete"]),

  detectBoundary: (
    lat: number,
    lon: number,
    name?: string,
    address?: string,
  ): Promise<IpcResponse["boundary:detect"]> =>
    ipcRenderer.invoke(IPC.detectBoundary, {
      lat,
      lon,
      name,
      address,
    } satisfies IpcRequest["boundary:detect"]),

  detectVehicles: (
    lat: number,
    lon: number,
    boundary?: IpcRequest["detect:vehicles"]["boundary"],
  ): Promise<IpcResponse["detect:vehicles"]> =>
    ipcRenderer.invoke(IPC.detectVehicles, {
      lat,
      lon,
      boundary,
    } satisfies IpcRequest["detect:vehicles"]),

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

  fetchWeather: (
    lat: number,
    lon: number,
  ): Promise<IpcResponse["weather:fetch"]> =>
    ipcRenderer.invoke(IPC.fetchWeather, {
      lat,
      lon,
    } satisfies IpcRequest["weather:fetch"]),

  compareTemporal: (
    lat: number,
    lon: number,
    fromDate: string,
    toDate: string,
    boundary?: IpcRequest["temporal:compare"]["boundary"],
  ): Promise<IpcResponse["temporal:compare"]> =>
    ipcRenderer.invoke(IPC.compareTemporal, {
      lat,
      lon,
      fromDate,
      toDate,
      boundary,
    } satisfies IpcRequest["temporal:compare"]),

  scoreRisk: (
    lat: number,
    lon: number,
    assetValue?: number,
    detection?: IpcRequest["risk:score"]["detection"],
    boundary?: IpcRequest["risk:score"]["boundary"],
  ): Promise<IpcResponse["risk:score"]> =>
    ipcRenderer.invoke(IPC.scoreRisk, {
      lat,
      lon,
      assetValue,
      detection,
      boundary,
    } satisfies IpcRequest["risk:score"]),

  analyzeDealership: (
    dealership: IpcRequest["analyze:dealership"]["dealership"],
  ): Promise<IpcResponse["analyze:dealership"]> =>
    ipcRenderer.invoke(IPC.analyzeDealership, {
      dealership,
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

  llmDashboardSpec: (
    prompt: string,
    dealershipCount: number,
  ): Promise<IpcResponse["llm:dashboardSpec"]> =>
    ipcRenderer.invoke(IPC.llmDashboardSpec, {
      prompt,
      dealershipCount,
    } satisfies IpcRequest["llm:dashboardSpec"]),

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

  llmRefineBoundary: (
    dealership: IpcRequest["llm:refineBoundary"]["dealership"],
  ): Promise<IpcResponse["llm:refineBoundary"]> =>
    ipcRenderer.invoke(IPC.llmRefineBoundary, {
      dealership,
    } satisfies IpcRequest["llm:refineBoundary"]),

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

  captureMap: (
    rect: IpcRequest["map:capture"]["rect"],
    mode: IpcRequest["map:capture"]["mode"],
  ): Promise<IpcResponse["map:capture"]> =>
    ipcRenderer.invoke(IPC.mapCapture, {
      rect,
      mode,
    } satisfies IpcRequest["map:capture"]),

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
};

export type DrmApi = typeof api;

contextBridge.exposeInMainWorld("api", api);
