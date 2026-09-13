import { BrowserWindow, ipcMain } from "electron";
import { join } from "path";
import { z } from "zod";
import { IPC } from "@shared/ipc-channels";
import {
  ipcRequest,
  LlmStreamEnvelopeSchema,
  LlmStreamRequestSchema,
  ModelDownloadEnvelopeSchema,
  StreamCancelSchema,
  type LlmStreamChunk,
  type ModelDownloadChunk,
} from "@shared/ipc-schema";
import { analyzeDealership } from "../services/analyze.service";
import { detectBoundary } from "../services/boundary.service";
import {
  detectVehicles,
  isModelAvailable,
  modelsDir,
  MODEL_FILENAME,
} from "../services/detection.service";
import {
  downloadModel,
  MODEL_DOWNLOAD_URL,
  ModelDownloadUnavailableError,
} from "../services/model.service";
import { compareTemporal } from "../services/temporal-change.service";
import {
  exportPortfolioFile,
  exportReport,
  exportReadonlyView,
  importPortfolioFile,
  captureMap,
} from "../services/export.service";
import { geocode } from "../services/geocoding.service";
import { getOsmDetails } from "../services/osmDetails.service";
import { placesAutocomplete } from "../services/places.service";
import {
  parseCsvWithReport,
  parseZuersCsvWithReport,
  parseZuersXlsxWithReport,
  parseXlsxWithReport,
} from "../services/csv.service";
import { createCatNetProvider } from "../services/catnet.service";
import {
  executiveSummaryStream,
  generateDashboardSpec,
  generateMemo,
  nlQueryFilter,
  nlQuerySummaryStream,
  portfolioChatStream,
  refineBoundary,
} from "../services/llm.service";
import { scoreRisk } from "../services/risk.service";
import {
  getSettings,
  getNatCatApiKey,
  setLlmApiKey,
  setNatCatApiKey,
  setSettings,
} from "../services/settings.service";
import { aerialImageForBoundary } from "../services/tiles.service";
import { fetchWeather } from "../services/weather.service";
import {
  deleteSession,
  listSessions,
  loadSession,
  saveSession,
} from "../db/sessions.repo";
import {
  deleteConversation,
  listConversations,
  loadConversation,
  saveConversation,
} from "../db/conversations.repo";
import {
  deleteDashboard,
  listDashboards,
  loadDashboard,
  saveDashboard,
} from "../db/dashboards.repo";

/**
 * Registers all IPC handlers. Each handler validates its input at the
 * boundary with the associated Zod schema before service code runs.
 */

type Handler<K extends keyof typeof ipcRequest> = (
  input: z.infer<(typeof ipcRequest)[K]>,
) => unknown | Promise<unknown>;

type MainWindowProvider = () => BrowserWindow | null;
let mainWindowProvider: MainWindowProvider = () => null;

function isTrustedSender(event: { sender: Electron.WebContents }): boolean {
  return BrowserWindow.fromWebContents(event.sender) === mainWindowProvider();
}

function handle<K extends keyof typeof ipcRequest>(
  channel: K,
  fn: Handler<K>,
): void {
  ipcMain.handle(channel, async (event, rawInput) => {
    if (!isTrustedSender(event)) throw new Error("Rejected IPC sender");
    const parsed = ipcRequest[channel].parse(rawInput);
    return fn(parsed as z.infer<(typeof ipcRequest)[K]>);
  });
}

export function registerIpcHandlers(getMainWindow: MainWindowProvider): void {
  mainWindowProvider = getMainWindow;
  handle(IPC.parseCsv, ({ content }) => parseCsvWithReport(content));
  handle(IPC.parseXlsx, ({ base64 }) => parseXlsxWithReport(base64));
  handle(IPC.parseZuersCsv, ({ content }) => parseZuersCsvWithReport(content));
  handle(IPC.parseZuersXlsx, ({ base64 }) => parseZuersXlsxWithReport(base64));
  handle(IPC.geocode, ({ query }) => geocode(query));
  handle(IPC.placesAutocomplete, ({ query }) => placesAutocomplete(query));
  handle(IPC.detectBoundary, ({ lat, lon, name, address }) =>
    detectBoundary(lat, lon, name, address),
  );
  handle(IPC.osmDetails, ({ lat, lon, name, address }) =>
    getOsmDetails(lat, lon, name, address),
  );
  handle(IPC.detectVehicles, async ({ lat, lon, boundary, parameters }) => {
    const image = await aerialImageForBoundary(lat, lon, boundary);
    return detectVehicles(image, boundary, parameters);
  });
  handle(IPC.compareTemporal, ({ lat, lon, fromDate, toDate, boundary }) =>
    compareTemporal(lat, lon, fromDate, toDate, boundary),
  );
  handle(IPC.fetchWeather, ({ lat, lon }) => fetchWeather(lat, lon));
  handle(IPC.scoreRisk, ({ lat, lon, assetValue, detection, boundary, parameters, natCat }) =>
    scoreRisk(lat, lon, assetValue, detection, boundary, undefined, parameters, natCat),
  );
  handle(IPC.fetchCatNet, async ({ lat, lon, perils }) => {
    const settings = getSettings().natCat;
    if (!settings?.catnetEndpoint) {
      throw new Error("CatNet endpoint is not configured");
    }
    const apiKey = getNatCatApiKey();
    if (!apiKey) throw new Error("CatNet API key is not configured");
    return createCatNetProvider({
      endpoint: settings.catnetEndpoint,
      apiKey,
    }).lookup(lat, lon, perils);
  });
  handle(IPC.analyzeDealership, ({ dealership, parameters }) =>
    analyzeDealership(dealership, parameters),
  );

  handle(IPC.listSessions, () => listSessions());
  handle(IPC.loadSession, ({ id }) => loadSession(id));
  handle(IPC.saveSession, ({ session }) => {
    saveSession(session);
    return { ok: true };
  });
  handle(IPC.deleteSession, ({ id }) => {
    deleteSession(id);
    return { ok: true };
  });

  handle(IPC.listConversations, () => listConversations());
  handle(IPC.loadConversation, ({ id }) => loadConversation(id));
  handle(IPC.saveConversation, ({ conversation }) => {
    saveConversation(conversation);
    return { ok: true };
  });
  handle(IPC.deleteConversation, ({ id }) => {
    deleteConversation(id);
    return { ok: true };
  });

  handle(IPC.llmDashboardSpec, ({ prompt, dealershipCount }) =>
    generateDashboardSpec(prompt, dealershipCount),
  );
  handle(IPC.listDashboards, () => listDashboards());
  handle(IPC.loadDashboard, ({ id }) => loadDashboard(id));
  handle(IPC.saveDashboard, ({ dashboard }) => {
    saveDashboard(dashboard);
    return { ok: true };
  });
  handle(IPC.deleteDashboard, ({ id }) => {
    deleteDashboard(id);
    return { ok: true };
  });

  handle(IPC.exportPortfolioFile, async ({ session }) => ({
    path: await exportPortfolioFile(session),
  }));
  handle(IPC.importPortfolioFile, () => importPortfolioFile());
  handle(IPC.exportReport, async ({ session, format }) => ({
    path: await exportReport(session, format),
  }));
  handle(IPC.exportReadonlyView, async ({ session }) => ({
    path: await exportReadonlyView(session),
  }));

  handle(IPC.llmMemo, ({ dealership }) => generateMemo(dealership));
  handle(IPC.llmRefineBoundary, ({ dealership }) => refineBoundary(dealership));

  handle(IPC.getSettings, () => getSettings());
  handle(IPC.setSettings, ({ settings }) => setSettings(settings));
  handle(IPC.setLlmApiKey, ({ provider, apiKey }) => {
    setLlmApiKey(provider, apiKey);
    return { ok: true };
  });
  handle(IPC.setNatCatApiKey, ({ apiKey }) => {
    setNatCatApiKey(apiKey);
    return { ok: true };
  });

  handle(IPC.mapCapture, ({ rect, mode }) => captureMap(rect, mode));

  handle(IPC.modelStatus, () => ({
    available: isModelAvailable(),
    installDir: join(modelsDir(), MODEL_FILENAME),
    downloadConfigured: MODEL_DOWNLOAD_URL !== null,
  }));

  registerLlmStreaming();
  registerModelDownload();
}

/**
 * Streaming LLM does NOT run over invoke, but over a send/receive pattern:
 * the renderer sends `llm:stream` with `{ streamId, req }`; the main process streams
 * chunks back over `llm:stream:<streamId>` and finishes with `done`/`error`.
 * `llm:stream:cancel` aborts a running stream via AbortController.
 */
function registerLlmStreaming(): void {
  const active = new Map<string, AbortController>();

  ipcMain.on(IPC.llmStream, (event, raw: unknown) => {
    if (!isTrustedSender(event)) return;
    const parsedEnvelope = LlmStreamEnvelopeSchema.safeParse(raw);
    if (!parsedEnvelope.success) return;
    const { streamId, req: parsed } = parsedEnvelope.data;
    const channel = `${IPC.llmStream}:${streamId}`;
    const controller = new AbortController();
    active.set(streamId, controller);

    const send = (chunk: LlmStreamChunk): void => {
      if (!event.sender.isDestroyed()) event.sender.send(channel, chunk);
    };

    void runStream(parsed, controller.signal, send)
      .catch((err: unknown) => {
        send({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        active.delete(streamId);
      });
  });

  ipcMain.on(`${IPC.llmStream}:cancel`, (event, raw: unknown) => {
    if (!isTrustedSender(event)) return;
    const parsed = StreamCancelSchema.safeParse(raw);
    if (!parsed.success) return;
    const { streamId } = parsed.data;
    active.get(streamId)?.abort();
    active.delete(streamId);
  });
}

/** Executes a stream request and pushes chunks via `send`. */
async function runStream(
  req: z.infer<typeof LlmStreamRequestSchema>,
  signal: AbortSignal,
  send: (chunk: LlmStreamChunk) => void,
): Promise<void> {
  if (req.kind === "chat") {
    for await (const token of portfolioChatStream(
      req.messages,
      req.sessionContext,
      signal,
    )) {
      send({ type: "token", token });
    }
  } else if (req.kind === "summary") {
    for await (const token of executiveSummaryStream(
      req.sessionContext,
      signal,
    )) {
      send({ type: "token", token });
    }
  } else {
    // NL query: phase 1 deterministic filter, then phase 2 summary stream
    const { filter, matchedIds } = await nlQueryFilter(
      req.question,
      req.dealerships,
    );
    send({ type: "filter", filter, matchedIds });
    const matched = req.dealerships.filter((d) => matchedIds.includes(d.id));
    for await (const token of nlQuerySummaryStream(
      req.question,
      matched,
      signal,
    )) {
      send({ type: "token", token });
    }
  }
  send({ type: "done" });
}

/**
 * Model download for the installation wizard — same send/receive pattern
 * as `llm:stream`: `model:download` starts, progress/result come over
 * `model:download:<streamId>`, `model:download:cancel` aborts it.
 */
function registerModelDownload(): void {
  const active = new Map<string, AbortController>();

  ipcMain.on(IPC.modelDownload, (event, raw: unknown) => {
    if (!isTrustedSender(event)) return;
    const parsed = ModelDownloadEnvelopeSchema.safeParse(raw);
    if (!parsed.success) return;
    const { streamId } = parsed.data;
    const channel = `${IPC.modelDownload}:${streamId}`;
    const controller = new AbortController();
    active.set(streamId, controller);

    const send = (chunk: ModelDownloadChunk): void => {
      if (!event.sender.isDestroyed()) event.sender.send(channel, chunk);
    };

    downloadModel(
      (receivedBytes, totalBytes) =>
        send({ type: "progress", receivedBytes, totalBytes }),
      controller.signal,
    )
      .then(() => send({ type: "done" }))
      .catch((err: unknown) => {
        if (err instanceof ModelDownloadUnavailableError) {
          send({ type: "unavailable" });
        } else {
          send({
            type: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      })
      .finally(() => {
        active.delete(streamId);
      });
  });

  ipcMain.on(`${IPC.modelDownload}:cancel`, (event, raw: unknown) => {
    if (!isTrustedSender(event)) return;
    const parsed = StreamCancelSchema.safeParse(raw);
    if (!parsed.success) return;
    const { streamId } = parsed.data;
    active.get(streamId)?.abort();
    active.delete(streamId);
  });
}
