import { z } from "zod";
import {
  AnalyzedDealershipSchema,
  BoundaryResultSchema,
  BoundarySuggestionSchema,
  ChatMessageSchema,
  ConversationSchema,
  DashboardSchema,
  DashboardSpecSchema,
  DealershipInputSchema,
  DetectionResultSchema,
  ImportResultSchema,
  LlmProviderSchema,
  NlQueryDealershipSchema,
  NlQueryFilterSchema,
  OsmDetailsSchema,
  PerilScoreSchema,
  RiskParametersSchema,
  RiskAssessmentSchema,
  SessionSchema,
  SettingsSchema,
  StructuredMemoSchema,
  TemporalChangeResultSchema,
} from "./types";

/**
 * Request/response schemas per IPC channel.
 * Requests are validated at the boundary in the main process with .parse(),
 * before any handler code runs.
 */

export const ipcRequest = {
  "csv:parse": z.object({ content: z.string() }),
  "xlsx:parse": z.object({ base64: z.string() }),
  "geocode:search": z.object({ query: z.string().min(1) }),
  "places:autocomplete": z.object({
    query: z.string().min(1),
  }),
  "boundary:detect": z.object({
    lat: z.number(),
    lon: z.number(),
    name: z.string().optional(),
    address: z.string().optional(),
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
  "temporal:compare": z.object({
    lat: z.number(),
    lon: z.number(),
    fromDate: z.string().min(1),
    toDate: z.string().min(1),
    boundary: BoundaryResultSchema.optional(),
  }),
  "weather:fetch": z.object({ lat: z.number(), lon: z.number() }),
  "risk:score": z.object({
    lat: z.number(),
    lon: z.number(),
    assetValue: z.number().optional(),
    detection: DetectionResultSchema.optional(),
    boundary: BoundaryResultSchema.optional(),
    parameters: RiskParametersSchema.optional(),
  }),
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
  "llm:refineBoundary": z.object({ dealership: AnalyzedDealershipSchema }),
  "settings:get": z.void(),
  "settings:set": z.object({ settings: SettingsSchema.partial() }),
  "settings:setLlmApiKey": z.object({
    provider: LlmProviderSchema,
    apiKey: z.string(),
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
  "model:status": z.void(),
} as const;

export const ipcResponse = {
  "csv:parse": ImportResultSchema,
  "xlsx:parse": ImportResultSchema,
  "geocode:search": z.array(
    z.object({ label: z.string(), lat: z.number(), lon: z.number() }),
  ),
  "places:autocomplete": z.array(
    z.object({ label: z.string(), lat: z.number(), lon: z.number() }),
  ),
  "boundary:detect": BoundaryResultSchema,
  "osm:details": OsmDetailsSchema,
  "detect:vehicles": DetectionResultSchema,
  "temporal:compare": TemporalChangeResultSchema,
  "weather:fetch": z.record(z.string(), z.number()),
  "risk:score": RiskAssessmentSchema,
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
  "llm:refineBoundary": BoundarySuggestionSchema,
  "settings:get": SettingsSchema,
  "settings:set": SettingsSchema,
  "settings:setLlmApiKey": z.object({ ok: z.boolean() }),
  "map:capture": z.object({ path: z.string().nullable(), ok: z.boolean() }),
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
