import { z } from "zod";
import {
  REVIEW_PLAN_MAX_ITEMS,
  ReviewPlanItemSchema,
  ReviewPlanSchema,
} from "./review-plan";
import { ScenarioDraftSchema } from "./scenario-draft";
import {
  CHAT_TOOL_MAX_LOCATIONS,
  CHAT_TOOL_RESULTS_MAX_CHARS,
  ChatToolCallSchema,
} from "./chat-tools";
import {
  ColumnOverridesSchema,
  ImportColumnSchema,
  MAPPING_MAX_COLUMNS,
} from "./import-fields";
import { A2uiSurfaceSchema } from "./a2ui";
import { AiLogDetailSchema, AiLogPageSchema } from "./ai-log";
import { AgentGatewayStatusSchema } from "./agent-gateway";
import { AgentCommandResultSchema } from "./agent-control";
import { McpServerToolsSchema } from "./mcp-client";
import { BoundaryOpinionSchema, SiteCheckResultSchema } from "./site-check";
import { DecisionEngineSchema, DecisionRunSchema } from "./site-questions";
import { isLocalDecisionModel } from "./decision-engines";
import { EvidenceMemoSchema } from "./evidence-memo";
import {
  QuestionnaireAnswerSchema,
  REPLY_MAX_CHARS,
} from "./questionnaire-answers";
import { QUESTION_IDS } from "./dealer-questionnaire";
import {
  AnalyzedDealershipSchema,
  BoundaryResultSchema,
  ChatMessageSchema,
  ConversationSchema,
  DashboardSchema,
  DealershipInputSchema,
  DetectionResultSchema,
  VehicleTimelineSchema,
  HailHistorySchema,
  HailZoneSchema,
  ImportResultSchema,
  LlmProviderSchema,
  NatCatApiProviderSchema,
  NatCatAssessmentSchema,
  HailZoneOverlaySchema,
  NlQueryDealershipSchema,
  NlQueryFilterSchema,
  OsmDetailsSchema,
  PerilScoreSchema,
  RiskParametersSchema,
  RiskAssessmentSchema,
  SessionSchema,
  SettingsSchema,
} from "./types";
import type { BoundaryResult, RiskParameters } from "./types";
import { HF_REPO_ID_PATTERN, OLLAMA_HF_MODEL_PATTERN } from "./llm-config";
import {
  ImagerySelectionSchema,
  ImageryViewRequestSchema,
} from "./imagery-sources";
import { ImageryTimelineSchema } from "./imagery-wayback";
import { RadarHailResultSchema } from "./radar-hail";
import {
  HailEventCellSchema,
  HailEventDetailSchema,
  HailEventListSchema,
  MAX_EVENT_CELLS,
  HailEventSummarySchema,
  MAX_FOOTPRINT_BYTES,
} from "./hail-events";
import {
  AsIfHistorySchema,
  AsIfRequestSchema,
  CandidateDaysRequestSchema,
  CandidateDaysSchema,
} from "./as-if-history";

/** Id of a connected MCP server (see McpServerConfigSchema). */
const McpServerIdSchema = z.string().regex(/^[a-z0-9-]{1,40}$/);

/** Ids of radar events, imports, saved scenarios and historic days. */
const HailEventIdSchema = z
  .string()
  .regex(/^(radar|import|saved|radklim)-[0-9A-Za-z]{1,40}$/);

// --- App updates ---------------------------------------------------------------

/**
 * Update state shown in the settings and as a notification. `canAutoInstall`
 * is true only where the app can update itself (Windows installer builds);
 * elsewhere an update is offered as a link to the release page.
 */
export const UpdateStatusSchema = z.object({
  state: z.enum([
    "unsupported", // development build: no update checks
    "idle",
    "checking",
    "up-to-date",
    "available",
    "downloading",
    "ready", // downloaded, installs on restart
    "error",
  ]),
  currentVersion: z.string(),
  latestVersion: z.string().optional(),
  releaseUrl: z.string().url().optional(),
  canAutoInstall: z.boolean(),
  /** Download progress 0..1 while `downloading`. */
  progress: z.number().min(0).max(1).optional(),
  checkedAt: z.string().optional(),
  message: z.string().optional(),
});
export type UpdateStatus = z.infer<typeof UpdateStatusSchema>;

// --- NatCat connectors --------------------------------------------------------

/** Outcome of a connector test: which perils the endpoint answered. */
export const NatCatConnectorTestSchema = z.object({
  ok: z.boolean(),
  perils: z.array(z.string()),
  message: z.string().optional(),
  latencyMs: z.number().nonnegative(),
});
export type NatCatConnectorTest = z.infer<typeof NatCatConnectorTestSchema>;

/**
 * Outcome of "Test connection" for the custom tile source: one sample tile.
 * `blank` is a reachable source that answers with one flat colour, as
 * services do outside their coverage.
 */
export const ImagerySourceTestSchema = z.object({
  ok: z.boolean(),
  code: z.enum([
    "ok",
    "not-configured",
    "unreachable",
    "http-error",
    "not-an-image",
    "blank",
  ]),
  /** HTTP status for `http-error`. */
  status: z.number().int().optional(),
  /** Start of the server's answer or the network error, for diagnosis. */
  detail: z.string().max(300).optional(),
  /** The sample tile as a PNG data URL. */
  preview: z.string().startsWith("data:image/png;base64,").optional(),
  /** Where the sample tile was requested. */
  lat: z.number(),
  lon: z.number(),
  zoom: z.number().int(),
  latencyMs: z.number().nonnegative(),
});
export type ImagerySourceTest = z.infer<typeof ImagerySourceTestSchema>;

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

export const DealerDirectoryUpdateSchema = z.object({
  latestRelease: z.string(),
  checkedAt: z.string(),
  updateAvailable: z.boolean(),
});
export type DealerDirectoryUpdate = z.infer<typeof DealerDirectoryUpdateSchema>;

const PlaceSourceSchema = z.enum(["osm", "overture"]);

export const PlaceSuggestionSchema = z.object({
  label: z.string(),
  lat: z.number(),
  lon: z.number(),
  /** Source of the label shown next to the suggestion. */
  source: PlaceSourceSchema.optional(),
  /** Every source that knows the place; both = confirmed. */
  sources: z.array(PlaceSourceSchema).optional(),
  /** No source knows the street; the point may lie off the site. */
  approximate: z.boolean().optional(),
  /** Saved portfolio locations this place already is (local notes excerpt). */
  portfolio: z
    .array(
      z.object({
        sessionId: z.string(),
        sessionName: z.string(),
        dealershipId: z.string(),
        name: z.string(),
        notesExcerpt: z.string().optional(),
      }),
    )
    .optional(),
});
export type PlaceSuggestion = z.infer<typeof PlaceSuggestionSchema>;

/** Location, optional boundary and parameters of a vehicle count. */
export interface DetectVehiclesRequest {
  lat: number;
  lon: number;
  boundary?: BoundaryResult;
  parameters?: RiskParameters;
}

// Explicitly typed and shared by two channels: inlining the boundary and
// parameter types twice pushes `ipcRequest` past the compiler's
// serialization limit (TS7056).
const DetectVehiclesRequestSchema: z.ZodType<DetectVehiclesRequest, unknown> =
  z.object({
    lat: z.number(),
    lon: z.number(),
    boundary: BoundaryResultSchema.optional(),
    parameters: RiskParametersSchema.optional(),
  });

/** Longest text the renderer may put on the clipboard (a long chat answer). */
export const CLIPBOARD_TEXT_MAX_CHARS = 100_000;

/** UI language passed to exports so files and dialogs match the app. */
export const ExportLocaleSchema = z.enum(["de", "en", "fr"]);

/**
 * A settings update names only the fields it changes. `partial()` alone
 * keeps the default of `language`, so an update without a language would
 * carry "de" and reset the stored language on every other save.
 */
export const SettingsUpdateSchema = SettingsSchema.partial().extend({
  language: SettingsSchema.shape.language.unwrap().optional(),
});

/** Longest API key accepted for the key store (real keys are far shorter). */
const API_KEY_MAX_CHARS = 4_000;

/** Coordinates in a request: a point on the globe, nothing else. */
const LatitudeSchema = z.number().min(-90).max(90);
const LongitudeSchema = z.number().min(-180).max(180);

/** Largest import the main process parses (about 20 MB of text). */
export const IMPORT_TEXT_MAX_CHARS = 20_000_000;
export const IMPORT_BASE64_MAX_CHARS = 28_000_000;

export const ipcRequest = {
  /** Only paths the main process remembered from a save dialog are shown. */
  "file:showExported": z.object({ path: z.string().min(1).max(4096) }),
  "csv:parse": z.object({
    // Bounded: the file is parsed in the main process, and tens of
    // megabytes of rows blocked it for half a minute.
    content: z.string().max(IMPORT_TEXT_MAX_CHARS),
    /** Columns assigned by hand in the import dialog. */
    overrides: ColumnOverridesSchema.optional(),
  }),
  "xlsx:parse": z.object({
    base64: z.string().max(IMPORT_BASE64_MAX_CHARS),
    overrides: ColumnOverridesSchema.optional(),
  }),
  "geocode:search": z.object({
    query: z.string().min(1),
    /**
     * Dealership name: the hits are then ranked the way an analysis picks
     * its anchor (postcode, house number, name), so the import preview
     * shows the point the analysis will use. Never sent to the geocoder.
     */
    name: z.string().max(500).optional(),
  }),
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
    lat: LatitudeSchema,
    lon: LongitudeSchema,
    name: z.string().optional(),
    address: z.string().optional(),
    // Without this the renderer's own detections silently ran on
    // DEFAULT_RISK_PARAMETERS, ignoring every boundary threshold the user had
    // set on the parameters page — unlike the analyze pipeline, which passes
    // session parameters through.
    parameters: RiskParametersSchema.optional(),
  }),
  "osm:details": z.object({
    lat: LatitudeSchema,
    lon: LongitudeSchema,
    name: z.string().optional(),
    address: z.string().optional(),
  }),
  "hail:history": z.object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  }),
  "hail:radar": z.object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  }),
  "hailEvents:list": z.void(),
  "hailEvents:get": z.object({ id: HailEventIdSchema }),
  "hailEvents:import": z.object({
    name: z.string().max(200),
    content: z.string().min(1).max(MAX_FOOTPRINT_BYTES),
  }),
  "hailEvents:delete": z.object({ id: HailEventIdSchema }),
  "hailEvents:loadHistoric": z.object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  "hailEvents:save": z.object({
    name: z.string().max(200),
    source: z.enum(["simulation", "drawn"]),
    cells: z.array(HailEventCellSchema).min(1).max(MAX_EVENT_CELLS),
  }),
  "hailEvents:asIf": AsIfRequestSchema,
  "hailEvents:suggestDays": CandidateDaysRequestSchema,
  "detect:vehicles": DetectVehiclesRequestSchema,
  "detect:vehiclesTimeline": DetectVehiclesRequestSchema,
  "weather:fetch": z.object({ lat: LatitudeSchema, lon: z.number() }),
  "risk:score": z.object({
    lat: LatitudeSchema,
    lon: LongitudeSchema,
    assetValue: z.number().nonnegative().optional(),
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
  }),
  "natcat:testConnector": z.object({ provider: NatCatApiProviderSchema }),
  "analyze:dealership": z.object({
    dealership: DealershipInputSchema,
    parameters: RiskParametersSchema.optional(),
  }),
  "sessions:list": z.void(),
  "sessions:load": z.object({ id: z.string() }),
  "sessions:save": z.object({ session: SessionSchema }),
  // Only the locations that changed since the save of `baseRevision`.
  "sessions:saveChanges": z.object({
    session: SessionSchema.omit({ dealerships: true }),
    baseRevision: z.number().int().nonnegative(),
    order: z.array(z.string().max(200)).max(50_000),
    upserts: z.array(AnalyzedDealershipSchema).max(50_000),
    removed: z.array(z.string().max(200)).max(50_000),
  }),
  "sessions:delete": z.object({ id: z.string() }),
  "conversations:list": z.void(),
  "conversations:load": z.object({ id: z.string() }),
  "conversations:save": z.object({ conversation: ConversationSchema }),
  "conversations:delete": z.object({ id: z.string() }),
  "llm:chatIntent": z.object({
    message: z.string().trim().min(1).max(2_000),
    dashboardTitle: z.string().max(120).nullable(),
  }),
  "llm:scenarioDraft": z.object({
    description: z.string().trim().min(3).max(500),
    fallbackName: z.string().trim().min(1).max(80),
  }),
  "llm:chatTools": z.object({
    question: z.string().trim().min(1).max(2_000),
    locations: z
      .array(z.object({ id: z.string().max(100), name: z.string().max(200) }))
      .max(CHAT_TOOL_MAX_LOCATIONS),
    selectedId: z.string().max(100).nullable(),
  }),
  "llm:columnMapping": z.object({
    columns: z.array(ImportColumnSchema).min(1).max(MAPPING_MAX_COLUMNS),
  }),
  "llm:reviewPlan": z.object({
    items: z.array(ReviewPlanItemSchema).min(1).max(REVIEW_PLAN_MAX_ITEMS),
  }),
  "llm:dashboardSurface": z.object({
    prompt: z.string().trim().min(1).max(2_000),
    current: A2uiSurfaceSchema.nullable(),
    context: z.object({
      locationCount: z.number().int().nonnegative(),
      salesPartners: z.array(z.string().max(120)).max(40),
      subPortfolios: z.array(z.string().max(120)).max(40),
      groups: z.array(z.string().max(120)).max(40),
    }),
  }),
  "dashboards:list": z.void(),
  "dashboards:load": z.object({ id: z.string() }),
  "dashboards:save": z.object({ dashboard: DashboardSchema }),
  "dashboards:delete": z.object({ id: z.string() }),
  "portfolio:export": z.object({
    session: SessionSchema,
    locale: ExportLocaleSchema.optional(),
  }),
  /** Optional for callers that predate the localised dialog title. */
  "portfolio:import": z
    .object({ locale: ExportLocaleSchema.optional() })
    .optional(),
  "report:export": z.object({
    session: SessionSchema,
    format: z.enum(["csv", "pdf", "excel"]),
    /** Language of the report, its headers and the save dialog. */
    locale: ExportLocaleSchema.optional(),
  }),
  "report:readonlyView": z.object({
    session: SessionSchema,
    locale: ExportLocaleSchema.optional(),
  }),
  "report:location": z.object({
    dealership: AnalyzedDealershipSchema,
    locale: z.enum(["de", "en", "fr"]),
    /** Localized titles of the open review points. */
    reviewNotes: z.array(z.string().min(1).max(300)).max(12),
    /**
     * The sources and limitations in the UI language, as the detail dialog
     * shows them; without it the report prints the stored English lines.
     */
    sourceLines: z.array(z.string().min(1).max(600)).max(16).optional(),
  }),
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
  "settings:set": z.object({ settings: SettingsUpdateSchema }),
  "settings:setLlmApiKey": z.object({
    provider: LlmProviderSchema,
    apiKey: z.string().max(API_KEY_MAX_CHARS),
  }),
  "settings:setNatCatApiKey": z.object({
    provider: NatCatApiProviderSchema,
    apiKey: z.string().min(1).max(API_KEY_MAX_CHARS),
  }),
  "settings:deleteNatCatApiKey": z.object({
    provider: NatCatApiProviderSchema,
  }),
  "clipboard:writeText": z.object({
    /** Plain text only, bounded: no HTML, images or file references. */
    text: z.string().min(1).max(CLIPBOARD_TEXT_MAX_CHARS),
  }),
  "map:capture": z.object({
    locale: ExportLocaleSchema.optional(),
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
  "imagery:testCustom": z.object({
    /** Where to request the sample tile; a fixed point when omitted. */
    point: z
      .object({
        lat: z.number().finite().min(-90).max(90),
        lon: z.number().finite().min(-180).max(180),
      })
      .optional(),
  }),
  "imagery:timeline": ImageryViewRequestSchema.extend({
    /** Return the versions at once; capture dates may follow (pendingIds). */
    quick: z.boolean().optional(),
  }),
  "imagery:prefetch": z.object({
    lat: z.number().finite().min(-90).max(90),
    lon: z.number().finite().min(-180).max(180),
  }),
  "model:status": z.void(),
  "hailZones:overlay": z.void(),
  "dealerDirectory:status": z.void(),
  "dealerDirectory:update": z.void(),
  "update:status": z.void(),
  "update:check": z.void(),
  "app:flushDone": z.void(),
  "update:download": z.void(),
  "update:install": z.void(),
  "diagnostics:export": z.void(),
  // An explicit literal, so no malformed or replayed call can wipe the data.
  "data:resetAll": z.object({ confirm: z.literal("delete-all-data") }),
  "aiLog:list": z.object({ offset: z.number().int().min(0).max(100_000) }),
  "aiLog:get": z.object({ id: z.number().int().nonnegative() }),
  // An explicit literal, like the data reset: the record book is evidence.
  "aiLog:clear": z.object({ confirm: z.literal("clear-ai-log") }),
  "aiLog:export": z.void(),
  "gateway:status": z.void(),
  "gateway:rotateToken": z.void(),
  // The window's answer to a remote-control command. The renderer is
  // untrusted: the answer is validated before it leaves the app.
  "agent:commandResult": z.object({
    id: z.string().uuid(),
    result: AgentCommandResultSchema,
  }),
  "mcp:serverTools": z.object({ serverId: McpServerIdSchema }),
  "mcp:setServerToken": z.object({
    serverId: McpServerIdSchema,
    /** Empty removes the stored token. */
    token: z.string().max(4_000),
  }),
  "mcp:chatLookup": z.object({ question: z.string().trim().min(1).max(2_000) }),
  "llm:siteCheck": z.object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    boundary: BoundaryResultSchema.optional(),
    /** Also look at archived images ("since when"). */
    history: z.boolean(),
  }),
  "llm:boundaryOpinion": z.object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    boundary: BoundaryResultSchema,
  }),
  // Site questions on the aerial image (shared/site-questions.ts).
  "decisions:answer": z.object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    boundary: BoundaryResultSchema.optional(),
    /** Another engine than the configured one (comparison). */
    engine: DecisionEngineSchema.optional(),
  }),
  "decisions:test": z.object({ engine: DecisionEngineSchema.optional() }),
  "decisions:engine": z.void(),
  "decisions:localModels": z.void(),
  "decisions:setKey": z.object({
    kind: z.enum(["google", "systemone"]),
    /** Empty removes the stored key. */
    key: z.string().max(4_000),
  }),
  "llm:evidenceMemo": z.object({
    dealership: AnalyzedDealershipSchema,
    parameters: RiskParametersSchema.optional(),
  }),
  "llm:questionnaireAnswers": z.object({
    questions: z
      .array(
        z.object({
          id: z.enum(QUESTION_IDS),
          text: z.string().min(1).max(600),
        }),
      )
      .min(1)
      .max(QUESTION_IDS.length),
    reply: z.string().trim().min(20).max(REPLY_MAX_CHARS),
  }),
} as const;

export const ipcResponse = {
  "file:showExported": z.object({ ok: z.boolean() }),
  "csv:parse": ImportResultSchema,
  "xlsx:parse": ImportResultSchema,
  "geocode:search": z.array(
    z.object({ label: z.string(), lat: LatitudeSchema, lon: z.number() }),
  ),
  "places:autocomplete": z.object({
    suggestions: z.array(PlaceSuggestionSchema),
    /** Photon unreachable: suggestions are local (directory, portfolios). */
    onlineUnavailable: z.boolean(),
  }),
  "boundary:detect": BoundaryResultSchema,
  "osm:details": OsmDetailsSchema,
  "hail:history": HailHistorySchema,
  "hail:radar": RadarHailResultSchema,
  "hailEvents:list": HailEventListSchema,
  "hailEvents:get": HailEventDetailSchema.nullable(),
  "hailEvents:import": HailEventSummarySchema,
  "hailEvents:delete": z.boolean(),
  "hailEvents:loadHistoric": HailEventSummarySchema,
  "hailEvents:save": HailEventSummarySchema,
  "hailEvents:asIf": AsIfHistorySchema,
  "hailEvents:suggestDays": CandidateDaysSchema,
  "detect:vehicles": DetectionResultSchema,
  "detect:vehiclesTimeline": VehicleTimelineSchema,
  "weather:fetch": z.record(z.string(), z.number()),
  "risk:score": RiskAssessmentSchema,
  "natcat:resolve": NatCatAssessmentSchema.nullable(),
  "natcat:testConnector": NatCatConnectorTestSchema,
  "analyze:dealership": AnalyzedDealershipSchema,
  "sessions:list": z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      updatedAt: z.string(),
      /** Saved state of this portfolio id (see `Session.snapshotOf`). */
      snapshotOf: z.string().optional(),
    }),
  ),
  "sessions:load": SessionSchema.nullable(),
  "sessions:save": z.object({
    ok: z.boolean(),
    revision: z.number().int().nonnegative(),
  }),
  "sessions:saveChanges": z.union([
    z.object({ ok: z.literal(true), revision: z.number().int().nonnegative() }),
    z.object({ ok: z.literal(false) }),
  ]),
  "sessions:delete": z.object({ ok: z.boolean() }),
  "conversations:list": z.array(
    z.object({ id: z.string(), name: z.string(), updatedAt: z.string() }),
  ),
  "conversations:load": ConversationSchema.nullable(),
  "conversations:save": z.object({ ok: z.boolean() }),
  "conversations:delete": z.object({ ok: z.boolean() }),
  "llm:chatIntent": z.object({ intent: z.enum(["create", "edit", "chat"]) }),
  "llm:reviewPlan": ReviewPlanSchema,
  "llm:columnMapping": ColumnOverridesSchema,
  "llm:chatTools": z.object({ calls: z.array(ChatToolCallSchema) }),
  "llm:scenarioDraft": ScenarioDraftSchema,
  "llm:dashboardSurface": z.discriminatedUnion("ok", [
    z.object({
      ok: z.literal(true),
      surface: A2uiSurfaceSchema,
      repaired: z.boolean(),
    }),
    z.object({
      ok: z.literal(false),
      issues: z.array(z.object({ path: z.string(), message: z.string() })),
    }),
  ]),
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
  "report:location": z.object({ path: z.string().nullable() }),
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
  "map:capture": z.object({
    locale: ExportLocaleSchema.optional(),
    path: z.string().nullable(),
    ok: z.boolean(),
  }),
  "clipboard:writeText": z.object({ ok: z.boolean() }),
  "imagery:select": ImagerySelectionSchema,
  "imagery:testCustom": ImagerySourceTestSchema,
  "imagery:timeline": ImageryTimelineSchema,
  "imagery:prefetch": z.null(),
  "dealerDirectory:status": DealerDirectoryStatusSchema.nullable(),
  "dealerDirectory:update": DealerDirectoryUpdateSchema.nullable(),
  "hailZones:overlay": HailZoneOverlaySchema,
  "model:status": z.object({
    available: z.boolean(),
    /** Target folder where the install wizard places/expects the model. */
    installDir: z.string(),
    /** Whether a download source is configured (otherwise manual instructions only). */
    downloadConfigured: z.boolean(),
  }),
  "update:status": UpdateStatusSchema,
  "update:check": UpdateStatusSchema,
  "app:flushDone": z.object({ ok: z.boolean() }),
  "update:download": UpdateStatusSchema,
  "update:install": z.object({ ok: z.boolean() }),
  "diagnostics:export": z.object({ path: z.string().nullable() }),
  "data:resetAll": z.object({ ok: z.boolean() }),
  "aiLog:list": AiLogPageSchema,
  "aiLog:get": AiLogDetailSchema.nullable(),
  "aiLog:clear": z.object({ ok: z.boolean() }),
  "aiLog:export": z.object({ path: z.string().nullable() }),
  "gateway:status": AgentGatewayStatusSchema,
  "gateway:rotateToken": AgentGatewayStatusSchema,
  "agent:commandResult": z.object({ ok: z.boolean() }),
  "mcp:serverTools": McpServerToolsSchema,
  "mcp:setServerToken": z.object({ ok: z.boolean() }),
  "mcp:chatLookup": z.object({
    results: z.string(),
    used: z.array(
      z.object({ server: z.string(), tool: z.string(), ok: z.boolean() }),
    ),
  }),
  "llm:siteCheck": SiteCheckResultSchema,
  "llm:boundaryOpinion": BoundaryOpinionSchema,
  "decisions:answer": DecisionRunSchema,
  "decisions:test": z.object({
    ok: z.boolean(),
    engine: DecisionEngineSchema,
    model: z.string(),
    probability: z.number().min(0).max(1).nullable(),
    error: z.string().optional(),
  }),
  "decisions:engine": z.object({
    /** null: nothing is set up that could answer. */
    engine: DecisionEngineSchema.nullable(),
    model: z.string(),
    /** False when the image would leave this computer. */
    local: z.boolean(),
  }),
  "decisions:localModels": z.object({
    reachable: z.boolean(),
    installed: z.array(z.string()),
  }),
  "decisions:setKey": z.object({ ok: z.boolean() }),
  "llm:evidenceMemo": EvidenceMemoSchema,
  "llm:questionnaireAnswers": z.object({
    answers: z.array(QuestionnaireAnswerSchema),
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
/** Upper bound for the portfolio context a stream request may carry. */
export const LLM_CONTEXT_MAX_CHARS = 60_000;
/** Facts of one explanation request (a few dozen lines). */
export const LLM_EXPLAIN_MAX_CHARS = 12_000;

export const llmStreamRequest = {
  chat: z.object({
    kind: z.literal("chat"),
    messages: z.array(ChatMessageSchema).max(20),
    sessionContext: z.string().max(LLM_CONTEXT_MAX_CHARS).optional(),
    /** Results of the lookups the app ran for this question (optional AI planner). */
    toolResults: z.string().max(CHAT_TOOL_RESULTS_MAX_CHARS).optional(),
  }),
  nlquery: z.object({
    kind: z.literal("nlquery"),
    question: z.string().min(1),
    dealerships: z.array(NlQueryDealershipSchema),
    sessionContext: z.string(),
  }),
  /**
   * Optional AI explanation of facts the app computed (comparison, change
   * report, dealer questionnaire). The main process picks the prompt by
   * topic; the facts are fenced as data.
   */
  explain: z.object({
    kind: z.literal("explain"),
    topic: z.enum([
      "comparison",
      "changes",
      "questionnaire",
      "challenge",
      "eventNotice",
    ]),
    facts: z.string().min(1).max(LLM_EXPLAIN_MAX_CHARS),
  }),
} as const;

export const LlmStreamRequestSchema = z.discriminatedUnion("kind", [
  llmStreamRequest.chat,
  llmStreamRequest.nlquery,
  llmStreamRequest.explain,
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
  // A Hugging Face GGUF, or one of the listed open decision models.
  model: z
    .string()
    .max(300)
    .refine(
      (m) => OLLAMA_HF_MODEL_PATTERN.test(m) || isLocalDecisionModel(m),
      "Not a model that can be installed",
    ),
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
