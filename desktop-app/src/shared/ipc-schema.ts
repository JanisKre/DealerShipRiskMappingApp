import { z } from "zod";
import {
  AnalyzedDealershipSchema,
  BoundaryResultSchema,
  ChatMessageSchema,
  ConversationSchema,
  DashboardSchema,
  DashboardSpecSchema,
  DealershipInputSchema,
  DetectionResultSchema,
  HailZoneSchema,
  ImportResultSchema,
  LlmProviderSchema,
  NatCatApiProviderSchema,
  NatCatAssessmentSchema,
  NlQueryDealershipSchema,
  NlQueryFilterSchema,
  OsmDetailsSchema,
  PerilScoreSchema,
  RiskParametersSchema,
  RiskAssessmentSchema,
  SessionSchema,
  SettingsSchema,
  StructuredMemoSchema,
} from "./types";
import { HF_REPO_ID_PATTERN, OLLAMA_HF_MODEL_PATTERN } from "./llm-config";
import {
  ImagerySelectionSchema,
  ImageryViewRequestSchema,
} from "./imagery-sources";

// --- NatCat connectors --------------------------------------------------------

/** Outcome of a connector test: which perils the endpoint answered. */
export const NatCatConnectorTestSchema = z.object({
  ok: z.boolean(),
  perils: z.array(z.string()),
  message: z.string().optional(),
  latencyMs: z.number().nonnegative(),
});
export type NatCatConnectorTest = z.infer<typeof NatCatConnectorTestSchema>;

// --- AI provider setup -------------------------------------------------------

/**
 * Outcome of "Test connection". `code` tells the renderer which hint to show;
 * `detail` carries the (truncated) provider response for diagnosis.
 */
export const LlmConnectionTestSchema = z.object({
  ok: z.boolean(),
  code: z.enum([
    "ok",
    "not_configured",
    "auth",
    "not_found",
    "unreachable",
    "error",
  ]),
  detail: z.string().optional(),
  latencyMs: z.number().nonnegative(),
});
export type LlmConnectionTest = z.infer<typeof LlmConnectionTestSchema>;

/** Whether a known local runtime answers on its default port. */
export const LocalRuntimeStatusSchema = z.object({
  runtime: z.enum(["ollama", "lmstudio", "llamacpp"]),
  baseUrl: z.string(),
  reachable: z.boolean(),
  modelCount: z.number().optional(),
});
export type LocalRuntimeStatus = z.infer<typeof LocalRuntimeStatusSchema>;

export const HfModelSortSchema = z.enum(["trending", "downloads", "likes"]);
export type HfModelSort = z.infer<typeof HfModelSortSchema>;

/** One GGUF text-generation repository from the Hugging Face Hub search. */
export const HfModelSummarySchema = z.object({
  id: z.string(),
  downloads: z.number(),
  likes: z.number(),
  createdAt: z.string().optional(),
});
export type HfModelSummary = z.infer<typeof HfModelSummarySchema>;

/** Pullable GGUF quantizations of one repository. */
export const HfModelFilesSchema = z.object({
  repoId: z.string(),
  gated: z.boolean(),
  parameters: z.number().optional(),
  contextLength: z.number().optional(),
  quants: z.array(
    z.object({
      tag: z.string(),
      file: z.string(),
      sizeBytes: z.number().optional(),
    }),
  ),
});
export type HfModelFiles = z.infer<typeof HfModelFilesSchema>;

/**
 * Request/response schemas per IPC channel.
 * Requests are validated at the boundary in the main process with .parse(),
 * before any handler code runs.
 */

export const DealerDirectoryStatusSchema = z.object({
  release: z.string(),
  retrievedAt: z.string(),
  count: z.number().int().nonnegative(),
});
export type DealerDirectoryStatus = z.infer<typeof DealerDirectoryStatusSchema>;

export const ipcRequest = {
  "csv:parse": z.object({ content: z.string() }),
  "xlsx:parse": z.object({ base64: z.string() }),
  "natcat:zuers:parseCsv": z.object({ content: z.string() }),
  "natcat:zuers:parseXlsx": z.object({ base64: z.string() }),
  "geocode:search": z.object({ query: z.string().min(1) }),
  "places:autocomplete": z.object({
    query: z.string().min(1).max(200),
    /** Map viewport the results are biased towards. */
    near: z
      .object({
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
        zoom: z.number().min(0).max(22).optional(),
      })
      .optional(),
  }),
  "boundary:detect": z.object({
    lat: z.number(),
    lon: z.number(),
    name: z.string().optional(),
    address: z.string().optional(),
    // Without this the renderer's own detections silently ran on
    // DEFAULT_RISK_PARAMETERS, ignoring every boundary threshold the user had
    // set on the parameters page — unlike the analyze pipeline, which passes
    // session parameters through.
    parameters: RiskParametersSchema.optional(),
  }),
  "osm:details": z.object({
    lat: z.number(),
    lon: z.number(),
    name: z.string().optional(),
    address: z.string().optional(),
  }),
  "detect:vehicles": z.object({
    lat: z.number(),
    lon: z.number(),
    boundary: BoundaryResultSchema.optional(),
    parameters: RiskParametersSchema.optional(),
  }),
  "weather:fetch": z.object({ lat: z.number(), lon: z.number() }),
  "risk:score": z.object({
    lat: z.number(),
    lon: z.number(),
    assetValue: z.number().optional(),
    detection: DetectionResultSchema.optional(),
    boundary: BoundaryResultSchema.optional(),
    parameters: RiskParametersSchema.optional(),
    natCat: NatCatAssessmentSchema.optional(),
    /** Postcode hail zone from the analysis; drives λ_z in the hail EAL. */
    hailZone: HailZoneSchema.optional(),
  }),
  "natcat:resolve": z.object({
    lat: z.number().finite().min(-90).max(90),
    lon: z.number().finite().min(-180).max(180),
    /** The location's imported data (ZÜRS), combined per peril. */
    imported: NatCatAssessmentSchema.optional(),
  }),
  "natcat:testConnector": z.object({ provider: NatCatApiProviderSchema }),
  "analyze:dealership": z.object({
    dealership: DealershipInputSchema,
    parameters: RiskParametersSchema.optional(),
  }),
  "sessions:list": z.void(),
  "sessions:load": z.object({ id: z.string() }),
  "sessions:save": z.object({ session: SessionSchema }),
  "sessions:delete": z.object({ id: z.string() }),
  "conversations:list": z.void(),
  "conversations:load": z.object({ id: z.string() }),
  "conversations:save": z.object({ conversation: ConversationSchema }),
  "conversations:delete": z.object({ id: z.string() }),
  "llm:dashboardSpec": z.object({
    prompt: z.string().min(1),
    dealershipCount: z.number().int().nonnegative(),
  }),
  "dashboards:list": z.void(),
  "dashboards:load": z.object({ id: z.string() }),
  "dashboards:save": z.object({ dashboard: DashboardSchema }),
  "dashboards:delete": z.object({ id: z.string() }),
  "portfolio:export": z.object({ session: SessionSchema }),
  "portfolio:import": z.void(),
  "report:export": z.object({
    session: SessionSchema,
    format: z.enum(["csv", "pdf", "excel"]),
  }),
  "report:readonlyView": z.object({ session: SessionSchema }),
  "llm:memo": z.object({ dealership: AnalyzedDealershipSchema }),
  "llm:testConnection": z.void(),
  "llm:listModels": z.void(),
  "llm:detectLocal": z.void(),
  "hf:searchModels": z.object({
    query: z.string().trim().max(100),
    sort: HfModelSortSchema,
  }),
  "hf:modelFiles": z.object({
    repoId: z.string().regex(HF_REPO_ID_PATTERN),
  }),
  "settings:get": z.void(),
  "settings:set": z.object({ settings: SettingsSchema.partial() }),
  "settings:setLlmApiKey": z.object({
    provider: LlmProviderSchema,
    apiKey: z.string(),
  }),
  "settings:setNatCatApiKey": z.object({
    provider: NatCatApiProviderSchema,
    apiKey: z.string().min(1),
  }),
  "settings:deleteNatCatApiKey": z.object({
    provider: NatCatApiProviderSchema,
  }),
  "map:capture": z.object({
    /** Optional crop rect in CSS pixels (renderer coordinates). */
    rect: z
      .object({
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number(),
      })
      .optional(),
    /** "save" -> save dialog; "clipboard" -> copy to clipboard. */
    mode: z.enum(["save", "clipboard"]),
  }),
  "imagery:select": ImageryViewRequestSchema,
  "model:status": z.void(),
  "dealerDirectory:status": z.void(),
} as const;

export const ipcResponse = {
  "csv:parse": ImportResultSchema,
  "xlsx:parse": ImportResultSchema,
  "natcat:zuers:parseCsv": ImportResultSchema,
  "natcat:zuers:parseXlsx": ImportResultSchema,
  "geocode:search": z.array(
    z.object({ label: z.string(), lat: z.number(), lon: z.number() }),
  ),
  "places:autocomplete": z.array(
    z.object({
      label: z.string(),
      lat: z.number(),
      lon: z.number(),
      /** Where the hit came from — shown next to the suggestion. */
      source: z.enum(["osm", "overture"]).optional(),
    }),
  ),
  "boundary:detect": BoundaryResultSchema,
  "osm:details": OsmDetailsSchema,
  "detect:vehicles": DetectionResultSchema,
  "weather:fetch": z.record(z.string(), z.number()),
  "risk:score": RiskAssessmentSchema,
  "natcat:resolve": NatCatAssessmentSchema.nullable(),
  "natcat:testConnector": NatCatConnectorTestSchema,
  "analyze:dealership": AnalyzedDealershipSchema,
  "sessions:list": z.array(
    z.object({ id: z.string(), name: z.string(), updatedAt: z.string() }),
  ),
  "sessions:load": SessionSchema.nullable(),
  "sessions:save": z.object({ ok: z.boolean() }),
  "sessions:delete": z.object({ ok: z.boolean() }),
  "conversations:list": z.array(
    z.object({ id: z.string(), name: z.string(), updatedAt: z.string() }),
  ),
  "conversations:load": ConversationSchema.nullable(),
  "conversations:save": z.object({ ok: z.boolean() }),
  "conversations:delete": z.object({ ok: z.boolean() }),
  "llm:dashboardSpec": DashboardSpecSchema,
  "dashboards:list": z.array(
    z.object({ id: z.string(), name: z.string(), updatedAt: z.string() }),
  ),
  "dashboards:load": DashboardSchema.nullable(),
  "dashboards:save": z.object({ ok: z.boolean() }),
  "dashboards:delete": z.object({ ok: z.boolean() }),
  "portfolio:export": z.object({ path: z.string().nullable() }),
  "portfolio:import": SessionSchema.nullable(),
  "report:export": z.object({ path: z.string().nullable() }),
  "report:readonlyView": z.object({ path: z.string().nullable() }),
  "llm:memo": StructuredMemoSchema,
  "llm:testConnection": LlmConnectionTestSchema,
  "llm:listModels": z.object({
    models: z.array(z.object({ id: z.string(), label: z.string().optional() })),
  }),
  "llm:detectLocal": z.array(LocalRuntimeStatusSchema),
  "hf:searchModels": z.array(HfModelSummarySchema),
  "hf:modelFiles": HfModelFilesSchema,
  "settings:get": SettingsSchema,
  "settings:set": SettingsSchema,
  "settings:setLlmApiKey": z.object({ ok: z.boolean() }),
  "settings:setNatCatApiKey": z.object({ ok: z.boolean() }),
  "settings:deleteNatCatApiKey": z.object({ ok: z.boolean() }),
  "map:capture": z.object({ path: z.string().nullable(), ok: z.boolean() }),
  "imagery:select": ImagerySelectionSchema,
  "dealerDirectory:status": DealerDirectoryStatusSchema.nullable(),
  "model:status": z.object({
    available: z.boolean(),
    /** Target folder where the install wizard places/expects the model. */
    installDir: z.string(),
    /** Whether a download source is configured (otherwise manual instructions only). */
    downloadConfigured: z.boolean(),
  }),
  // Helper type for peril details (not bound to a channel)
  perilScore: PerilScoreSchema,
} as const;

export type IpcRequest = {
  [K in keyof typeof ipcRequest]: z.infer<(typeof ipcRequest)[K]>;
};
export type IpcResponse = {
  [K in keyof typeof ipcResponse]: z.infer<(typeof ipcResponse)[K]>;
};

/**
 * Streaming payloads (channel `llm:stream`, NOT via invoke).
 * The renderer starts a stream with one of these payloads; the main process
 * sends chunks back (see LlmStreamChunkSchema).
 */
export const llmStreamRequest = {
  chat: z.object({
    kind: z.literal("chat"),
    messages: z.array(ChatMessageSchema).max(20),
    sessionContext: z.string().optional(),
  }),
  summary: z.object({
    kind: z.literal("summary"),
    sessionContext: z.string(),
  }),
  nlquery: z.object({
    kind: z.literal("nlquery"),
    question: z.string().min(1),
    dealerships: z.array(NlQueryDealershipSchema),
    sessionContext: z.string(),
  }),
} as const;

export const LlmStreamRequestSchema = z.discriminatedUnion("kind", [
  llmStreamRequest.chat,
  llmStreamRequest.summary,
  llmStreamRequest.nlquery,
]);
export type LlmStreamRequest = z.infer<typeof LlmStreamRequestSchema>;

/** Validated envelopes for the send/receive streaming IPC channels. */
const StreamIdSchema = z.string().uuid();
export const LlmStreamEnvelopeSchema = z.object({
  streamId: StreamIdSchema,
  req: LlmStreamRequestSchema,
});
export const StreamCancelSchema = z.object({ streamId: StreamIdSchema });
export const ModelDownloadEnvelopeSchema = z.object({
  streamId: StreamIdSchema,
});
export const OllamaPullEnvelopeSchema = z.object({
  streamId: StreamIdSchema,
  model: z.string().regex(OLLAMA_HF_MODEL_PATTERN),
});

/** A single chunk that the main process sends over the stream response channel. */
export const LlmStreamChunkSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("token"), token: z.string() }),
  // NL query phase 1: extracted filter + number of matches
  z.object({
    type: z.literal("filter"),
    filter: NlQueryFilterSchema.nullable(),
    matchedIds: z.array(z.string()),
  }),
  z.object({ type: z.literal("done") }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type LlmStreamChunk = z.infer<typeof LlmStreamChunkSchema>;

/**
 * Chunks of the model download (channel `model:download`, same send/receive
 * pattern as `llm:stream`). `unavailable` = no download source configured
 * -> the renderer shows the manual installation instructions instead.
 */
export const DealerDirectoryRefreshEnvelopeSchema = z.object({
  streamId: StreamIdSchema,
});

/** Chunks of `dealerDirectory:refresh` (same pattern as `model:download`). */
export const DealerDirectoryChunkSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("progress"),
    phase: z.enum(["discover", "read"]),
    doneRowGroups: z.number().int().nonnegative(),
    totalRowGroups: z.number().int().nonnegative(),
    found: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("done"), status: DealerDirectoryStatusSchema }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type DealerDirectoryChunk = z.infer<typeof DealerDirectoryChunkSchema>;

export const ModelDownloadChunkSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("progress"),
    receivedBytes: z.number().nonnegative(),
    totalBytes: z.number().nonnegative().nullable(),
  }),
  z.object({ type: z.literal("done") }),
  z.object({ type: z.literal("error"), message: z.string() }),
  z.object({ type: z.literal("unavailable") }),
]);
export type ModelDownloadChunk = z.infer<typeof ModelDownloadChunkSchema>;

/**
 * Chunks of an Ollama model pull (channel `ollama:pull`, same send/receive
 * pattern as `model:download`). `status` is Ollama's own progress label.
 */
export const OllamaPullChunkSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("progress"),
    status: z.string(),
    completedBytes: z.number().nonnegative().nullable(),
    totalBytes: z.number().nonnegative().nullable(),
  }),
  z.object({ type: z.literal("done"), model: z.string() }),
  z.object({
    type: z.literal("error"),
    message: z.string(),
    /** `unreachable` = no Ollama listening → the renderer shows install hints. */
    code: z.enum(["unreachable", "error"]),
  }),
]);
export type OllamaPullChunk = z.infer<typeof OllamaPullChunkSchema>;
