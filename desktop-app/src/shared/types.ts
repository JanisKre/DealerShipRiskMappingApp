import { z } from "zod";

/**
 * Domain types + Zod schemas, shared between main and renderer.
 * The Zod schemas are the single source of truth: runtime validation at the
 * IPC boundary + derived TypeScript types.
 */

// --- Perils ---------------------------------------------------------------

export const PERILS = [
  "wind",
  "lightning",
  "snow",
  "flood",
  "hail",
  "heat",
] as const;
export const PerilSchema = z.enum(PERILS);
export type Peril = z.infer<typeof PerilSchema>;

// --- Evidence / provenance -------------------------------------------------

/** Machine-readable provenance attached to calculated or imported data. */
export const RiskEvidenceSchema = z.object({
  source: z.string().min(1),
  retrievedAt: z.string(),
  dataVersion: z.string().optional(),
  spatialResolution: z.string().optional(),
  method: z.string().min(1),
  confidence: z.number().min(0).max(1),
  fallbackUsed: z.boolean().default(false),
  limitations: z.array(z.string()).default([]),
});
export type RiskEvidence = z.infer<typeof RiskEvidenceSchema>;

// --- Dealership (input data) ------------------------------------------

export const DealershipInputSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  address: z.string().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  assetValue: z.number().nonnegative().optional(),
  // --- Portfolio membership (underwriting) --------------------------------
  /** Already insured / part of the book (vs. new customer/prospect). */
  insured: z.boolean().optional(),
  /** Sales partner / agency through which the contract runs. */
  salesPartner: z.string().optional(),
  /** Sub-portfolio / segment for grouping & filtering. */
  subPortfolio: z.string().optional(),
  /** Group/corporate membership (multiple locations of one customer). */
  group: z.string().optional(),
  /** Product limit / sum insured (EUR) — hard coverage cap. */
  productLimitEur: z.number().nonnegative().optional(),
});
export type DealershipInput = z.infer<typeof DealershipInputSchema>;

// --- Boundary -------------------------------------------------------------

export const BoundarySourceSchema = z.enum([
  "alkis",
  "osm",
  "overture",
  "aerial",
  "synthetic",
  "manual",
]);
export type BoundarySource = z.infer<typeof BoundarySourceSchema>;

/** What the polygon represents; a parcel/building is not automatically a lot. */
export const BoundaryGeometryRoleSchema = z.enum([
  "parcel",
  "building",
  "parkingSurface",
  "operationalLot",
  "synthetic",
]);
export type BoundaryGeometryRole = z.infer<typeof BoundaryGeometryRoleSchema>;

export const BoundaryPointRelationSchema = z.enum([
  "inside",
  "near",
  "outside",
  "unknown",
]);
export type BoundaryPointRelation = z.infer<typeof BoundaryPointRelationSchema>;

/** Explainable quality signals used for ranking and underwriting review. */
export const BoundaryQualitySchema = z.object({
  geometryValid: z.boolean(),
  pointRelation: BoundaryPointRelationSchema,
  pointDistanceM: z.number().nonnegative().optional(),
  sourceAgreement: z.number().min(0).max(1),
  areaPlausibility: z.number().min(0).max(1),
  boundaryFit: z.number().min(0).max(1),
  top2Margin: z.number().min(0).max(1).optional(),
  reasons: z.array(z.string()).default([]),
});
export type BoundaryQuality = z.infer<typeof BoundaryQualitySchema>;

// GeoJSON polygon (ring of [lon, lat] pairs)
export const PolygonSchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z
    .array(z.array(z.tuple([z.number(), z.number()])).min(4))
    .min(1),
});
export type Polygon = z.infer<typeof PolygonSchema>;

/** A geometry considered during automatic boundary resolution. */
export const BoundaryCandidateSchema = z.object({
  source: BoundarySourceSchema,
  role: BoundaryGeometryRoleSchema.optional(),
  provider: z.string().optional(),
  polygon: PolygonSchema,
  areaSqm: z.number().nonnegative(),
  confidence: z.number().min(0).max(1),
  label: z.string().optional(),
  quality: BoundaryQualitySchema.optional(),
  evidence: RiskEvidenceSchema.optional(),
});
export type BoundaryCandidate = z.infer<typeof BoundaryCandidateSchema>;

export const BoundaryResultSchema = z.object({
  source: BoundarySourceSchema,
  role: BoundaryGeometryRoleSchema.optional(),
  provider: z.string().optional(),
  gersId: z.string().optional(),
  label: z.string().optional(),
  polygon: PolygonSchema,
  areaSqm: z.number().nonnegative(),
  confidence: z.number().min(0).max(1),
  quality: BoundaryQualitySchema.optional(),
  evidence: RiskEvidenceSchema.optional(),
  /** Alternative geometries retained for human review and future fusion. */
  candidates: z.array(BoundaryCandidateSchema).max(10).optional(),
  /** True when the result should be checked before it is used for underwriting. */
  reviewRequired: z.boolean().optional(),
});
export type BoundaryResult = z.infer<typeof BoundaryResultSchema>;

// --- Additional OSM info (location details from OpenStreetMap tags) -------

export const OsmDetailsSchema = z.object({
  name: z.string().optional(),
  /** shop=... or amenity=... of the nearest OSM object. */
  category: z.string().optional(),
  website: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  openingHours: z.string().optional(),
  brand: z.string().optional(),
  address: z
    .object({
      road: z.string().optional(),
      houseNumber: z.string().optional(),
      postcode: z.string().optional(),
      city: z.string().optional(),
    })
    .optional(),
});
export type OsmDetails = z.infer<typeof OsmDetailsSchema>;

// --- Vehicle detection ------------------------------------------------------

/**
 * Legacy model classes accepted when loading older sessions. New detection
 * results normalize every supported class to `car` for underwriting.
 */
export const VEHICLE_CLASSES = ["car", "van", "truck", "bus"] as const;
export const VehicleClassSchema = z.enum(VEHICLE_CLASSES);
export type VehicleClass = z.infer<typeof VehicleClassSchema>;

export const DetectionBoxSchema = z.object({
  // Normalized canvas coordinates [0..1] (origin top left)
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  score: z.number(),
  classLabel: VehicleClassSchema.optional(),
  // Geographic center point of the box (if georeferenced)
  lon: z.number().optional(),
  lat: z.number().optional(),
});
export type DetectionBox = z.infer<typeof DetectionBoxSchema>;

/** A manually added or removed vehicle location on the map. */
export const ManualVehiclePointSchema = z.object({
  lat: z.number(),
  lon: z.number(),
});
export type ManualVehiclePoint = z.infer<typeof ManualVehiclePointSchema>;

export const ClassCountsSchema = z.object({
  car: z.number().int().nonnegative(),
  // Kept for backwards compatibility with sessions created before the
  // product switched to one generic vehicle category.
  van: z.number().int().nonnegative(),
  truck: z.number().int().nonnegative(),
  bus: z.number().int().nonnegative(),
});
export type ClassCounts = z.infer<typeof ClassCountsSchema>;

export const DetectionEvaluationSchema = z.object({
  dataset: z.string(),
  evaluatedSamples: z.number().int().nonnegative(),
  countMae: z.number().nonnegative(),
  countBias: z.number(),
  within10PctRate: z.number().min(0).max(1),
  evaluatedAt: z.string(),
});
export type DetectionEvaluation = z.infer<typeof DetectionEvaluationSchema>;

export const DetectionResultSchema = z.object({
  vehicleCount: z.number().int().nonnegative(),
  /** Optional human-reviewed count used for underwriting calculations. */
  manualVehicleCount: z.number().int().nonnegative().optional(),
  confidence: z.number().min(0).max(1),
  model: z.string(),
  classCounts: ClassCountsSchema.optional(),
  inferenceMs: z.number().optional(),
  boxes: z.array(DetectionBoxSchema).optional(),
  /** Points added by an underwriter during map-based detection review. */
  manualVehiclePoints: z.array(ManualVehiclePointSchema).optional(),
  /** Machine points hidden by an underwriter during map-based review. */
  manualVehicleRemovedPoints: z.array(ManualVehiclePointSchema).optional(),
  evidence: RiskEvidenceSchema.optional(),
  evaluation: DetectionEvaluationSchema.optional(),
});
export type DetectionResult = z.infer<typeof DetectionResultSchema>;

// --- Temporal change (two-point-in-time comparison of vehicle detection) --

export const TemporalChangeResultSchema = z.object({
  fromDate: z.string(), // ISO date (YYYY-MM-DD) of the earlier aerial image
  toDate: z.string(), // ISO date of the later aerial image
  fromCount: z.number().int().nonnegative(),
  toCount: z.number().int().nonnegative(),
  deltaCount: z.number().int(), // toCount - fromCount (can be negative)
  deltaPct: z.number().nullable(), // relative to fromCount; null if fromCount = 0
  classDeltas: z.object({
    car: z.number().int(),
    van: z.number().int(),
    truck: z.number().int(),
    bus: z.number().int(),
  }),
  fromConfidence: z.number().min(0).max(1),
  toConfidence: z.number().min(0).max(1),
  provider: z.string(), // tile source used (for traceability)
});
export type TemporalChangeResult = z.infer<typeof TemporalChangeResultSchema>;

export const PerilScoreSchema = z.object({
  peril: PerilSchema,
  score: z.number().min(0).max(100),
  hazardValue: z.number(),
  unit: z.string(),
});
export type PerilScore = z.infer<typeof PerilScoreSchema>;

export const EalBreakdownSchema = z.object({
  hail: z.number().nonnegative(),
  wind: z.number().nonnegative(),
  flood: z.number().nonnegative(),
  lightning: z.number().nonnegative(),
  snow: z.number().nonnegative(),
  heat: z.number().nonnegative(),
  total: z.number().nonnegative(),
});
export type EalBreakdown = z.infer<typeof EalBreakdownSchema>;

export const RiskAssessmentSchema = z.object({
  /** Primary dealership score; currently the hail score. */
  overallScore: z.number().min(0).max(100),
  perils: z.array(PerilScoreSchema),
  eal: z.number().nonnegative(), // Expected Annual Loss (total, EUR/year)
  ealBreakdown: EalBreakdownSchema.optional(),
  exposureEur: z.number().nonnegative().optional(), // estimated vehicle value on-site
  utilisation: z.number().min(0).optional(), // utilisation 0..1+ (vehicles / capacity)
  capacityEstimate: z.number().nonnegative().optional(), // estimated parking capacity
  /** Overall reliability of the result, separate from hazard severity. */
  confidence: z.number().min(0).max(1).optional(),
  modelVersion: z.string().optional(),
  evidence: z.array(RiskEvidenceSchema).optional(),
  limitations: z.array(z.string()).optional(),
  computedAt: z.string(),
});
export type RiskAssessment = z.infer<typeof RiskAssessmentSchema>;

// --- Complete analyzed dataset ---------------------------------------------

export const HailZoneSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]);
export type HailZone = z.infer<typeof HailZoneSchema>;

export const HAIL_RISK_TIERS = [
  "Very Low",
  "Low",
  "Moderate",
  "High",
  "Very High",
] as const;
export type HailRiskTier = (typeof HAIL_RISK_TIERS)[number];

export const AnalyzedDealershipSchema = DealershipInputSchema.extend({
  lat: z.number(),
  lon: z.number(),
  boundary: BoundaryResultSchema.optional(),
  /** Original boundary kept so a manual edit can be reverted after restart. */
  boundaryBeforeManualEdit: BoundaryResultSchema.optional(),
  detection: DetectionResultSchema.optional(),
  risk: RiskAssessmentSchema.optional(),
  /** Hail zone (comprehensive/K-Kasko cover, 1-6) from the postal-code zoning table. */
  hailZone: HailZoneSchema.optional(),
  /** Risk tier derived from the hail zone (Very Low ... Very High). */
  hailRiskTier: z.enum(HAIL_RISK_TIERS).optional(),
});
export type AnalyzedDealership = z.infer<typeof AnalyzedDealershipSchema>;

// --- Session / Portfolio ---------------------------------------------------

/**
 * User-tunable model parameters. Keeping the schema in the shared domain
 * layer makes the values safe at the IPC boundary and backwards compatible
 * with sessions created before the parameter tab existed.
 */
export const RiskParametersSchema = z.object({
  vehicleValueCarEur: z.number().nonnegative(),
  vehicleValueVanEur: z.number().nonnegative(),
  vehicleValueTruckEur: z.number().nonnegative(),
  vehicleValueBusEur: z.number().nonnegative(),
  vehicleValueDefaultEur: z.number().nonnegative(),
  capacitySqmPerVehicle: z.number().positive(),
  hailDamageFraction: z.number().min(0).max(1),
  hailSiteHitProbability: z.number().min(0).max(1),
  climateLoadingFactor: z.number().min(0),
  windStormThresholdKmh: z.number().nonnegative(),
  windDamageFraction: z.number().min(0).max(1),
  windSiteHitProbability: z.number().min(0).max(1),
  lightningDamageFraction: z.number().min(0).max(1),
  lightningDensityScale: z.number().nonnegative(),
  snowLoadDamageFractionPer30cm: z.number().min(0).max(1),
  floodDamageHq10: z.number().min(0).max(1),
  floodDamageHq100: z.number().min(0).max(1),
  floodDamageHqExtrem: z.number().min(0).max(1),
  heatHotdaysScoreMax: z.number().positive(),
  heatDamageFractionPerHotday: z.number().min(0).max(1),
  windScoreMaxKmh: z.number().positive(),
  lightningScoreMaxDensity: z.number().positive(),
  snowScoreMaxCm: z.number().positive(),
  floodScoreMaxAnnualPrecipMm: z.number().positive(),
  pmlDamageFraction10: z.number().min(0).max(1),
  pmlDamageFraction50: z.number().min(0).max(1),
  pmlDamageFraction100: z.number().min(0).max(1),
  pmlClusterRadiusKm: z.number().positive(),
  accumulationRadiusKm: z.number().positive(),
  accumulationReinsureThresholdEur: z.number().nonnegative(),
  scenarioDamageLow: z.number().min(0).max(1),
  scenarioDamageMedium: z.number().min(0).max(1),
  scenarioDamageHigh: z.number().min(0).max(1),
  scenarioDamageExtreme: z.number().min(0).max(1),
  alertExtremeScore: z.number().min(0).max(100),
  alertOvercapacity: z.number().nonnegative(),
  alertLowBoundaryConfidence: z.number().min(0).max(1),
  alertEalPortfolioShare: z.number().min(0).max(1),
  boundaryReviewConfidence: z.number().min(0).max(1),
  boundaryReviewTop2Margin: z.number().min(0).max(1),
  boundaryReviewSourceAgreement: z.number().min(0).max(1),
  boundaryNearPointDistanceM: z.number().nonnegative(),
  syntheticBoundaryRadiusM: z.number().positive(),
  detectionConfidence: z.number().min(0).max(1),
});
export type RiskParameters = z.infer<typeof RiskParametersSchema>;

export const SessionSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  dealerships: z.array(AnalyzedDealershipSchema),
  /** Optional for backwards compatibility with older saved sessions. */
  parameters: RiskParametersSchema.optional(),
});
export type Session = z.infer<typeof SessionSchema>;

// --- LLM --------------------------------------------------------------------

export const LlmProviderSchema = z.enum(["openai", "claude", "custom"]);
export type LlmProvider = z.infer<typeof LlmProviderSchema>;

export const LlmSettingsSchema = z.object({
  provider: LlmProviderSchema,
  model: z.string(),
  baseUrl: z.string().optional(),
  hasApiKey: z.boolean().optional(),
});
export type LlmSettings = z.infer<typeof LlmSettingsSchema>;

// --- Settings ---------------------------------------------------------------

export const SettingsSchema = z.object({
  language: z.enum(["en", "de", "fr"]).default("en"),
  llm: LlmSettingsSchema.optional(),
  /** Satellite/aerial imagery tile source for the map & detection. */
  satelliteProvider: z.enum(["esri", "wms"]).optional(),
  /** XYZ/WMS tile template with {z}/{x}/{y} placeholders (for provider 'wms'). */
  wmsTileUrl: z.string().optional(),
  /** Install wizard for the vehicle detection model permanently dismissed. */
  modelWizardDismissed: z.boolean().optional(),
  /** First-run installation wizard completed by the user. */
  setupWizardCompleted: z.boolean().optional(),
});
export type Settings = z.infer<typeof SettingsSchema>;

// --- Aggregated portfolio metrics (renderer math) ---------------------------

// Probable Maximum Loss for a return period
export const PmlResultSchema = z.object({
  returnPeriod: z.union([z.literal(10), z.literal(50), z.literal(100)]),
  estimatedLossEur: z.number().nonnegative(),
  dealershipsInScenario: z.number().int().nonnegative(),
  clusterRadiusKm: z.number().positive(),
});
export type PmlResult = z.infer<typeof PmlResultSchema>;

// A grid-cell entry of the cluster heatmap
export const ClusterRiskEntrySchema = z.object({
  cellId: z.string(),
  centerLat: z.number(),
  centerLon: z.number(),
  totalEalEur: z.number().nonnegative(),
  dealershipCount: z.number().int().nonnegative(),
  maxScore: z.number().min(0).max(100),
});
export type ClusterRiskEntry = z.infer<typeof ClusterRiskEntrySchema>;

// An accumulation cluster: dealerships that fall within the distance
// threshold of each other. Stable clusterId (deterministic from the member
// IDs), aggregates for size/value/hail + a nat-cat KPI as the sort metric.
export const AccumulationClusterSchema = z.object({
  clusterId: z.string(),
  memberIds: z.array(z.string()),
  count: z.number().int().nonnegative(),
  centerLat: z.number(),
  centerLon: z.number(),
  totalVehicles: z.number().int().nonnegative(),
  totalExposureEur: z.number().nonnegative(),
  totalEalEur: z.number().nonnegative(),
  /** Hail score of the area (maximum over the cluster members, 0..100). */
  maxHailScore: z.number().min(0).max(100),
  meanHailScore: z.number().min(0).max(100),
  /** Nat-cat KPI = modeled cluster loss (EUR) — sort metric. */
  natCatKpiEur: z.number().nonnegative(),
  /** Dominant sales partner in the cluster (most frequent), if any. */
  dominantSalesPartner: z.string().optional(),
});
export type AccumulationCluster = z.infer<typeof AccumulationClusterSchema>;

// Hailstorm scenario (corridor along a path)
export const HailstormScenarioSchema = z.object({
  id: z.string(),
  name: z.string(),
  // Path coordinates as [lon, lat] pairs
  pathCoordinates: z.array(z.tuple([z.number(), z.number()])).min(2),
  widthKm: z.number().positive(),
  intensityLevel: z.enum(["LOW", "MEDIUM", "HIGH", "EXTREME"]),
  /** Optional generic scenario metadata; old hailstorm files remain valid. */
  peril: PerilSchema.optional(),
  returnPeriodYears: z
    .union([z.literal(10), z.literal(50), z.literal(100)])
    .optional(),
  exposureMultiplier: z.number().positive().optional(),
  modelVersion: z.string().optional(),
  assumptions: z.array(z.string()).optional(),
});
export type HailstormScenario = z.infer<typeof HailstormScenarioSchema>;

export const ScenarioImpactSchema = z.object({
  affectedDealershipIds: z.array(z.string()),
  totalExposureEur: z.number().nonnegative(),
  estimatedLossEur: z.number().nonnegative(),
  scenario: HailstormScenarioSchema,
  modelVersion: z.string().optional(),
  assumptions: z.array(z.string()).optional(),
  evidence: z.array(RiskEvidenceSchema).optional(),
});
export type ScenarioImpact = z.infer<typeof ScenarioImpactSchema>;

// --- Import quality --------------------------------------------------------

export const ImportIssueSchema = z.object({
  row: z.number().int().positive(),
  message: z.string().min(1),
  field: z.string().optional(),
  severity: z.enum(["error", "warning"]),
});
export type ImportIssue = z.infer<typeof ImportIssueSchema>;

export const ImportReportSchema = z.object({
  format: z.enum(["csv", "tsv", "xlsx"]),
  totalRows: z.number().int().nonnegative(),
  importedRows: z.number().int().nonnegative(),
  skippedRows: z.number().int().nonnegative(),
  duplicateRows: z.number().int().nonnegative(),
  columnMapping: z.record(z.string(), z.string().nullable()),
  issues: z.array(ImportIssueSchema),
  warnings: z.array(z.string()),
  createdAt: z.string(),
});
export type ImportReport = z.infer<typeof ImportReportSchema>;

export const ImportResultSchema = z.object({
  rows: z.array(DealershipInputSchema),
  report: ImportReportSchema,
});
export type ImportResult = z.infer<typeof ImportResultSchema>;

// --- LLM agents: structured results -----------------------------------------

// Structured underwriting memo
export const StructuredMemoSchema = z.object({
  recommendedDeductibleEur: z.number(),
  suggestedPremiumLoadingPct: z.number(),
  sublimitNotes: z.array(z.string()),
  reasoning: z.string(),
});
export type StructuredMemo = z.infer<typeof StructuredMemoSchema>;

// Boundary refinement suggestion
export const BoundarySuggestionSchema = z.object({
  recommendedAction: z.enum(["keep", "use-alkis", "expand", "manual-review"]),
  expandMeters: z.number().optional(),
  reasoning: z.string(),
});
export type BoundarySuggestion = z.infer<typeof BoundarySuggestionSchema>;

// NL query: filter expression (recursive), produced by the LLM, applied deterministically
export type NlQueryFilter =
  | {
      field: string;
      op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
      value?: unknown;
    }
  | { and: NlQueryFilter[] }
  | { or: NlQueryFilter[] };

export const NlQueryFilterSchema: z.ZodType<NlQueryFilter> = z.lazy(() =>
  z.union([
    z.object({
      field: z.string(),
      op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte"]),
      value: z.unknown(),
    }),
    z.object({ and: z.array(NlQueryFilterSchema) }),
    z.object({ or: z.array(NlQueryFilterSchema) }),
  ]),
);

// Chat message (for portfolio chat with history)
export const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

// Persisted chat conversation (multi-thread history).
// Structure analogous to Session; `messages` stored as a JSON blob in SQLite.
export const ConversationSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  messages: z.array(ChatMessageSchema),
});
export type Conversation = z.infer<typeof ConversationSchema>;

// --- AI dashboards (dynamically generated, deterministically bound layouts) ---
// The LLM only arranges widgets from a fixed catalog and picks a data source
// (`source`) per widget — it never outputs numbers. The renderer reads all
// values exclusively from `computeDashboardData(dealerships)`.
export const DASHBOARD_WIDGET_TYPES = [
  "kpi",
  "barChart",
  "lineChart",
  "pieChart",
  "table",
  "insights",
  "coverage",
  "seasonal",
  "text",
] as const;
export type DashboardWidgetType = (typeof DASHBOARD_WIDGET_TYPES)[number];

/** Allowed KPI metrics (scalar values for `type:"kpi"`, via `source`). */
export const DASHBOARD_KPI_KEYS = [
  "kpi.count",
  "kpi.totalEal",
  "kpi.totalExposure",
  "kpi.avgScore",
  "kpi.totalVehicles",
  "kpi.extremeCount",
] as const;
export type DashboardKpiKey = (typeof DASHBOARD_KPI_KEYS)[number];

/** Allowed series sources (arrays for charts, via `source`). */
export const DASHBOARD_SERIES_KEYS = [
  "riskDistribution",
  "topEal",
  "topScore",
  "perilCoverage",
  "seasonalProfile",
] as const;
export type DashboardSeriesKey = (typeof DASHBOARD_SERIES_KEYS)[number];

export const DashboardWidgetSchema = z.object({
  id: z.string(),
  type: z.enum(DASHBOARD_WIDGET_TYPES),
  title: z.string(),
  /** Catalog key (KPI or series source); checked against the catalog in the renderer. */
  source: z.string().optional(),
  /** Free text, only for `type:"text"` — never numeric. */
  text: z.string().optional(),
  /** Optional upper bound for list/top-N series. */
  limit: z.number().int().positive().max(50).optional(),
});
export type DashboardWidget = z.infer<typeof DashboardWidgetSchema>;

export const DashboardSpecSchema = z.object({
  title: z.string(),
  widgets: z.array(DashboardWidgetSchema).min(1).max(12),
});
export type DashboardSpec = z.infer<typeof DashboardSpecSchema>;

/** Persisted generated dashboard instance (structure analogous to Conversation). */
export const DashboardSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  prompt: z.string(),
  spec: DashboardSpecSchema,
});
export type Dashboard = z.infer<typeof DashboardSchema>;

// Compact, flat dealership projection for NL query filtering. The fields are
// deliberately top-level so the deterministic filter evaluator can address
// them by field name (item[field]).
export const NlQueryDealershipSchema = z.object({
  id: z.string(),
  name: z.string(),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "EXTREME"]).optional(),
  overallScore: z.number().optional(),
  vehicleCount: z.number().optional(),
  utilisation: z.number().optional(),
  eal: z.number().optional(),
  exposureEur: z.number().optional(),
  hailScore: z.number().optional(),
  windScore: z.number().optional(),
  floodScore: z.number().optional(),
  snowScore: z.number().optional(),
  lightningScore: z.number().optional(),
  heatScore: z.number().optional(),
  boundarySource: z.string().optional(),
  boundaryConfidence: z.number().optional(),
  insured: z.boolean().optional(),
  salesPartner: z.string().optional(),
  subPortfolio: z.string().optional(),
  group: z.string().optional(),
});
export type NlQueryDealership = z.infer<typeof NlQueryDealershipSchema>;
