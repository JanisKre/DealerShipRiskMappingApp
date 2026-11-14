import { app, BrowserWindow, clipboard, ipcMain, session } from "electron";
import { join } from "path";
import { z } from "zod";
import { IPC } from "@shared/ipc-channels";
import {
  ipcRequest,
  LlmStreamEnvelopeSchema,
  LlmStreamRequestSchema,
  DealerDirectoryRefreshEnvelopeSchema,
  ModelDownloadEnvelopeSchema,
  OllamaPullEnvelopeSchema,
  StreamCancelSchema,
  type DealerDirectoryChunk,
  type LlmStreamChunk,
  type ModelDownloadChunk,
  type OllamaPullChunk,
} from "@shared/ipc-schema";
import { analyzeDealership } from "../services/analyze.service";
import {
  explainStream,
  draftScenario,
  planChatTools,
  proposeReviewOrder,
  suggestColumnMapping,
} from "../services/llm-agents.service";
import { closeDb } from "../db/database";
import { scheduleDataReset } from "../services/data-reset.service";
import { exportDiagnostics } from "../services/diagnostics.service";
import {
  checkForUpdates,
  downloadUpdate,
  getUpdateStatus,
  installUpdate,
} from "../services/update.service";
import {
  checkDealerDirectoryUpdate,
  dealerDirectoryStatus,
  refreshDealerDirectory,
} from "../services/dealer-directory.service";
import { detectBoundary } from "../services/boundary.service";
import {
  attachImageryProvenance,
  detectVehicles,
  isModelAvailable,
  modelsDir,
} from "../services/detection.service";
import { maskRoofDetections } from "../services/detection/roof-mask.service";
import {
  downloadModel,
  MODEL_DOWNLOAD_URL,
  MODEL_INSTALL_FILENAME,
  ModelDownloadUnavailableError,
} from "../services/model.service";
import {
  exportPortfolioFile,
  exportReport,
  exportReadonlyView,
  importPortfolioFile,
  captureMap,
} from "../services/export.service";
import { geocode } from "../services/geocoding.service";
import { exportLocationReport } from "../services/location-report.service";
import { getHailZoneOverlay } from "../services/hail-zone-overlay/overlay.service";
import { getOsmDetails } from "../services/osmDetails.service";
import { getHailHistory } from "../services/hail-history/hail-history.service";
import { radarHailAt } from "../services/hail-history/radar-hail.service";
import {
  deleteImportedEvent,
  hailEventDetail,
  importFootprint,
  listHailEvents,
  loadHistoricDay,
  saveScenario,
} from "../services/hail-history/hail-events.service";
import { placesAutocomplete } from "../services/places.service";
import {
  parseCsvWithReport,
  parseXlsxWithReport,
} from "../services/csv.service";
import { resolveNatCat, testNatCatConnector } from "../services/natcat.service";
import {
  classifyChatIntent,
  generateDashboardSurface,
  detectLocalRuntimes,
  generateMemo,
  listLlmModels,
  nlQueryFilter,
  nlQuerySummaryStream,
  portfolioChatStream,
  testLlmConnection,
} from "../services/llm.service";
import {
  getGgufFiles,
  searchGgufModels,
} from "../services/huggingface.service";
import {
  OllamaUnreachableError,
  pullOllamaModel,
} from "../services/ollama.service";
import { scoreRisk } from "../services/risk.service";
import {
  getSettings,
  deleteNatCatApiKey,
  setLlmApiKey,
  setNatCatApiKey,
  setSettings,
} from "../services/settings.service";
import {
  aerialImageForBoundary,
  prefetchContextImagery,
} from "../services/tiles.service";
import { configureCustomOverpass } from "../services/boundary/overpass-client";
import { fetchWeather } from "../services/weather.service";
import { selectImageryForView } from "../services/imagery-source.service";
import { waybackTimeline } from "../services/wayback.service";
import { countVehiclesOverTime } from "../services/vehicle-timeline.service";
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
  handle(IPC.parseCsv, ({ content, overrides }) =>
    parseCsvWithReport(content, overrides),
  );
  handle(IPC.parseXlsx, ({ base64, overrides }) =>
    parseXlsxWithReport(base64, overrides),
  );
  handle(IPC.geocode, ({ query }) => geocode(query));
  handle(IPC.placesAutocomplete, ({ query, near }) =>
    placesAutocomplete(query, near),
  );
  handle(IPC.detectBoundary, ({ lat, lon, name, address, parameters }) =>
    detectBoundary(lat, lon, name, address, parameters),
  );
  handle(IPC.osmDetails, ({ lat, lon, name, address }) =>
    getOsmDetails(lat, lon, name, address),
  );
  handle(IPC.detectVehicles, async ({ lat, lon, boundary, parameters }) => {
    const image = await aerialImageForBoundary(lat, lon, boundary);
    return attachImageryProvenance(
      await maskRoofDetections(
        await detectVehicles(image, boundary, parameters),
        lat,
        lon,
      ),
      image.imagery,
    );
  });
  handle(IPC.detectVehiclesTimeline, ({ lat, lon, boundary, parameters }) =>
    countVehiclesOverTime(lat, lon, boundary, parameters),
  );
  handle(IPC.fetchWeather, ({ lat, lon }) => fetchWeather(lat, lon));
  handle(IPC.hailHistory, ({ lat, lon }) => getHailHistory(lat, lon));
  handle(IPC.radarHail, ({ lat, lon }) => radarHailAt(lat, lon));
  handle(IPC.hailEventsList, () => listHailEvents());
  handle(IPC.hailEventsGet, ({ id }) => hailEventDetail(id));
  handle(IPC.hailEventsImport, ({ name, content }) =>
    importFootprint(content, name),
  );
  handle(IPC.hailEventsDelete, ({ id }) => deleteImportedEvent(id));
  handle(IPC.hailEventsLoadHistoric, ({ day }) => loadHistoricDay(day));
  handle(IPC.hailEventsSave, ({ name, source, cells }) =>
    saveScenario(name, source, cells),
  );
  handle(
    IPC.scoreRisk,
    ({
      lat,
      lon,
      assetValue,
      detection,
      boundary,
      parameters,
      natCat,
      hailZone,
    }) =>
      scoreRisk(
        lat,
        lon,
        assetValue,
        detection,
        boundary,
        hailZone,
        parameters,
        natCat,
      ),
  );
  handle(
    IPC.resolveNatCat,
    async ({ lat, lon }) => (await resolveNatCat(lat, lon)) ?? null,
  );
  handle(IPC.testNatCatConnector, ({ provider }) =>
    testNatCatConnector(provider),
  );
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

  handle(IPC.llmChatIntent, async ({ message, dashboardTitle }) => ({
    intent: await classifyChatIntent(message, dashboardTitle),
  }));
  handle(IPC.llmReviewPlan, ({ items }) => proposeReviewOrder(items));
  handle(IPC.llmScenarioDraft, ({ description, fallbackName }) =>
    draftScenario(description, fallbackName),
  );
  handle(IPC.llmChatTools, async ({ question, locations, selectedId }) => ({
    calls: await planChatTools(question, locations, selectedId),
  }));
  handle(IPC.llmColumnMapping, ({ columns }) => suggestColumnMapping(columns));
  handle(IPC.llmDashboardSurface, ({ prompt, current, context }) =>
    generateDashboardSurface(prompt, current, context),
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
  handle(IPC.exportLocationReport, async (input) => ({
    path: await exportLocationReport(input),
  }));
  handle(IPC.exportReadonlyView, async ({ session }) => ({
    path: await exportReadonlyView(session),
  }));

  handle(IPC.llmMemo, ({ dealership }) => generateMemo(dealership));
  handle(IPC.llmTestConnection, () => testLlmConnection());
  handle(IPC.llmListModels, () => listLlmModels());
  handle(IPC.llmDetectLocal, () => detectLocalRuntimes());
  handle(IPC.hfSearchModels, ({ query, sort }) =>
    searchGgufModels(query, sort),
  );
  handle(IPC.hfModelFiles, ({ repoId }) => getGgufFiles(repoId));

  handle(IPC.getSettings, () => getSettings());
  handle(IPC.setSettings, ({ settings }) => {
    const saved = setSettings(settings);
    configureCustomOverpass(saved.overpassUrl);
    return saved;
  });
  handle(IPC.setLlmApiKey, ({ provider, apiKey }) => {
    setLlmApiKey(provider, apiKey);
    return { ok: true };
  });
  handle(IPC.setNatCatApiKey, ({ provider, apiKey }) => {
    setNatCatApiKey(provider, apiKey);
    return { ok: true };
  });
  handle(IPC.deleteNatCatApiKey, ({ provider }) => {
    deleteNatCatApiKey(provider);
    return { ok: true };
  });

  handle(IPC.mapCapture, ({ rect, mode }) => captureMap(rect, mode));
  handle(IPC.clipboardWriteText, ({ text }) => {
    clipboard.writeText(text);
    return { ok: true };
  });
  handle(IPC.imagerySelect, ({ lat, lon, zoom }) =>
    selectImageryForView(lat, lon, zoom),
  );
  handle(IPC.imageryTimeline, ({ lat, lon, zoom }) =>
    waybackTimeline(lat, lon, zoom),
  );
  handle(IPC.imageryPrefetch, ({ lat, lon }) => {
    prefetchContextImagery(lat, lon);
    return null;
  });

  handle(IPC.modelStatus, () => ({
    available: isModelAvailable(),
    installDir: join(modelsDir(), MODEL_INSTALL_FILENAME),
    downloadConfigured: MODEL_DOWNLOAD_URL.length > 0,
  }));

  handle(IPC.hailZoneOverlay, () => getHailZoneOverlay());

  handle(IPC.dealerDirectoryStatus, () => dealerDirectoryStatus());
  handle(IPC.dealerDirectoryUpdate, () => checkDealerDirectoryUpdate());

  handle(IPC.updateStatus, () => getUpdateStatus());
  handle(IPC.updateCheck, () => checkForUpdates());
  handle(IPC.updateDownload, () => downloadUpdate());
  handle(IPC.updateInstall, () => ({ ok: installUpdate() }));

  handle(IPC.diagnosticsExport, async () => ({
    path: await exportDiagnostics(mainWindowProvider()),
  }));
  handle(IPC.dataResetAll, async () => {
    // The files go on the next start, before anything opens them (see
    // data-reset.service.ts); Chromium's own storage is cleared right away.
    scheduleDataReset(app.getPath("userData"));
    await session.defaultSession.clearStorageData();
    await session.defaultSession.clearCache();
    console.warn("Deleting all local data on restart, as requested.");
    setTimeout(() => {
      closeDb();
      app.relaunch();
      app.exit(0);
    }, 200);
    return { ok: true };
  });

  registerLlmStreaming();
  registerModelDownload();
  registerOllamaPull();
  registerDealerDirectoryRefresh();
}

/**
 * Overture dealer directory download — same send/receive pattern as
 * `model:download`: `dealerDirectory:refresh` starts, progress/result come
 * over `dealerDirectory:refresh:<streamId>`, `…:cancel` aborts it.
 */
function registerDealerDirectoryRefresh(): void {
  const active = new Map<string, AbortController>();

  ipcMain.on(IPC.dealerDirectoryRefresh, (event, raw: unknown) => {
    if (!isTrustedSender(event)) return;
    const parsed = DealerDirectoryRefreshEnvelopeSchema.safeParse(raw);
    if (!parsed.success) return;
    const { streamId } = parsed.data;
    const channel = `${IPC.dealerDirectoryRefresh}:${streamId}`;
    const controller = new AbortController();
    active.set(streamId, controller);

    const send = (chunk: DealerDirectoryChunk): void => {
      if (!event.sender.isDestroyed()) event.sender.send(channel, chunk);
    };

    refreshDealerDirectory(
      (progress) => send({ type: "progress", ...progress }),
      controller.signal,
    )
      .then((status) => send({ type: "done", status }))
      .catch((err: unknown) =>
        send({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        }),
      )
      .finally(() => {
        active.delete(streamId);
      });
  });

  ipcMain.on(IPC.dealerDirectoryRefreshCancel, (event, raw: unknown) => {
    if (!isTrustedSender(event)) return;
    const parsed = StreamCancelSchema.safeParse(raw);
    if (!parsed.success) return;
    active.get(parsed.data.streamId)?.abort();
    active.delete(parsed.data.streamId);
  });
}

/**
 * Local model install — same send/receive pattern as `model:download`:
 * `ollama:pull` starts, progress/result come over `ollama:pull:<streamId>`,
 * `ollama:pull:cancel` aborts it. The model reference is validated against
 * the `hf.co/<owner>/<repo>:<quant>` pattern before anything is sent.
 */
function registerOllamaPull(): void {
  const active = new Map<string, AbortController>();

  ipcMain.on(IPC.ollamaPull, (event, raw: unknown) => {
    if (!isTrustedSender(event)) return;
    const parsed = OllamaPullEnvelopeSchema.safeParse(raw);
    if (!parsed.success) return;
    const { streamId, model } = parsed.data;
    const channel = `${IPC.ollamaPull}:${streamId}`;
    const controller = new AbortController();
    active.set(streamId, controller);

    const send = (chunk: OllamaPullChunk): void => {
      if (!event.sender.isDestroyed()) event.sender.send(channel, chunk);
    };

    pullOllamaModel(model, send, controller.signal)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        send({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
          code: err instanceof OllamaUnreachableError ? "unreachable" : "error",
        });
      })
      .finally(() => {
        active.delete(streamId);
      });
  });

  ipcMain.on(IPC.ollamaPullCancel, (event, raw: unknown) => {
    if (!isTrustedSender(event)) return;
    const parsed = StreamCancelSchema.safeParse(raw);
    if (!parsed.success) return;
    const { streamId } = parsed.data;
    active.get(streamId)?.abort();
    active.delete(streamId);
  });
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
      req.toolResults,
    )) {
      send({ type: "token", token });
    }
  } else if (req.kind === "explain") {
    for await (const token of explainStream(req.topic, req.facts, signal)) {
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
