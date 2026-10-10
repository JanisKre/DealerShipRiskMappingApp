import { z } from "zod";
import {
  DEALERSHIP_NOTES_MAX_LENGTH,
  HAIL_FREQUENCY_BY_ZONE,
  HAIL_SEVERITY_CLASSES,
} from "./constants";
import { ImagerySelectionSchema } from "./imagery-sources";
import { isHttpWebsiteUrl } from "./website";

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

// --- Natural-catastrophe provider data -------------------------------------

/**
 * Providers queried through the app's hazard API contract (see
 * `docs/risk-model.md`). Vendor APIs are reached through a customer endpoint
 * that answers in that contract; `custom-api` is any other such endpoint.
 */
export const NAT_CAT_API_PROVIDERS = [
  "swissre-catnet",
  "munichre-lri",
  "moodys-li",
  "verisk-li",
  "jba-flood",
  "fathom-flood",
  "custom-api",
] as const;
export const NatCatApiProviderSchema = z.enum(NAT_CAT_API_PROVIDERS);
export type NatCatApiProvider = z.infer<typeof NatCatApiProviderSchema>;

export const NAT_CAT_PROVIDERS = [
  "zuers-geo",
  ...NAT_CAT_API_PROVIDERS,
] as const;
export const NatCatProviderSchema = z.enum(NAT_CAT_PROVIDERS);
export type NatCatProvider = z.infer<typeof NatCatProviderSchema>;

/** A normalized provider observation; rawValue preserves the source class/value. */
export const NatCatHazardSchema = z.object({
  /** Existing perils plus provider-specific values such as heavyRain. */
  peril: z.string().min(1).max(64),
  score: z.number().min(0).max(100),
  hazardValue: z.number().optional(),
  unit: z.string().min(1),
  rawValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
  returnPeriodYears: z.number().positive().optional(),
  annualExceedanceProbability: z.number().positive().max(1).optional(),
  /** Source of this value; set when an assessment combines several providers. */
  provider: NatCatProviderSchema.optional(),
});
export type NatCatHazard = z.infer<typeof NatCatHazardSchema>;

export const NatCatAssessmentSchema = z.object({
  /** `composite` = hazards routed per peril from several providers. */
  provider: z.enum([...NAT_CAT_PROVIDERS, "composite"]),
  retrievedAt: z.string(),
  dataVersion: z.string().optional(),
  spatialResolution: z.string().optional(),
  hazards: z.array(NatCatHazardSchema),
  /** Provider-specific classifications that are not directly scoreable. */
  attributes: z
    .record(z.union([z.string(), z.number(), z.boolean()]))
    .default({}),
  evidence: RiskEvidenceSchema,
});
export type NatCatAssessment = z.infer<typeof NatCatAssessmentSchema>;

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
  /**
   * Free-text underwriting notes (observations, follow-ups). Local only —
   * never sent to the LLM or included in exports.
   */
  notes: z.string().max(DEALERSHIP_NOTES_MAX_LENGTH).optional(),
  /** ISO timestamp of the last notes change. */
  notesUpdatedAt: z.string().optional(),
  /** Dealership website (absolute http(s) URL). */
  website: z
    .string()
    .refine(isHttpWebsiteUrl, "Website must be an http(s) URL")
    .optional(),
  /**
   * Where `website` came from: found automatically via OpenStreetMap, or
   * entered by the underwriter. A manual link is never overwritten.
   */
  websiteSource: z.enum(["osm", "manual"]).optional(),
  /**
   * Natural-catastrophe assessment used for scoring: imported data plus the
   * providers routed in the settings, combined per peril.
   */
  natCat: NatCatAssessmentSchema.optional(),
  /**
   * User-supplied import (ZÜRS Geo) kept separately, so a re-analysis can
   * re-route API sources without losing or re-using stale API values.
   */
  natCatImport: NatCatAssessmentSchema.optional(),
});
export type DealershipInput = z.infer<typeof DealershipInputSchema>;

// --- Boundary -------------------------------------------------------------

export const BoundarySourceSchema = z.enum([
  "alkis",
  "osm",
  "overture",
  "aerial",
  /** Multi-source evidence fusion — the union several sources each describe partly. */
  "fused",
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

/**
 * Fine-grained outcome of asking one evidence source, so "no data here" (a
 * real, cacheable answer) is never confused with "could not ask" (which must
 * not silently reduce confidence or get cached as an absence).
 */
export const SourceStatusSchema = z.enum([
  /** The source was not asked for this result. */
  "notQueried",
  /** Answered with usable data. */
  "success",
  /** Answered successfully; nothing found at this location. */
  "successEmpty",
  /** Answered, but the response was capped/paginated before completion. */
  "partial",
  /** Reachable in principle, but this attempt failed (network, rate limit, breaker open). */
  "transientFailure",
  /** No service of this kind covers this location at all. */
  "unsupportedHere",
]);
export type SourceStatus = z.infer<typeof SourceStatusSchema>;

/** Lot boundary detection engine. See `Settings.boundaryEngine`. */
export const BoundaryEngineSchema = z.enum(["legacy", "fused"]);
export type BoundaryEngine = z.infer<typeof BoundaryEngineSchema>;

/**
 * One evidence source's contribution to a fused boundary. Kept per-layer so a
 * reviewer can see *why* a polygon has the shape it has, and which sources were
 * unavailable when it was produced.
 */
export const BoundaryEvidenceLayerSchema = z.object({
  /** Stable slug, e.g. "osm-fence", "alkis-parcel", "yolo-vehicles". */
  layer: z.string().min(1).max(48),
  source: z.string().min(1).max(120),
  /** Signed score weight applied per covered cell; barriers use 0. */
  weight: z.number(),
  /** Grid cells this layer touched — 0 means "queried but contributed nothing". */
  cells: z.number().nonnegative(),
  available: z.boolean(),
  /** Richer than `available`: distinguishes empty/partial/unreachable/unsupported. */
  status: SourceStatusSchema.optional(),
  limitation: z.string().max(200).optional(),
});
export type BoundaryEvidenceLayer = z.infer<typeof BoundaryEvidenceLayerSchema>;

/** Why region growing stopped; anything but "exhausted" means the lot was truncated. */
export const BoundaryGrowthStopSchema = z.enum([
  "exhausted",
  "areaCap",
  "radiusCap",
]);
export type BoundaryGrowthStop = z.infer<typeof BoundaryGrowthStopSchema>;

/**
 * Explainable quality signals used for ranking and underwriting review.
 *
 * Everything below `reasons` is produced only by the fusion engine and is
 * therefore optional: sessions saved by earlier versions must keep parsing
 * unchanged, and the review rule must not fire on a field that is simply absent.
 */
export const BoundaryQualitySchema = z.object({
  geometryValid: z.boolean(),
  pointRelation: BoundaryPointRelationSchema,
  pointDistanceM: z.number().nonnegative().optional(),
  sourceAgreement: z.number().min(0).max(1),
  areaPlausibility: z.number().min(0).max(1),
  boundaryFit: z.number().min(0).max(1),
  top2Margin: z.number().min(0).max(1).optional(),
  reasons: z.array(z.string()).default([]),
  /** Per-source contributions to the fused geometry. */
  layers: z.array(BoundaryEvidenceLayerSchema).max(32).optional(),
  /** Bumped whenever fusion scoring changes, so cached results can be retired. */
  fusionVersion: z.number().int().nonnegative().optional(),
  /** Share of the outline backed by a physical or legal edge, not a colour threshold. */
  barrierSupport: z.number().min(0).max(1).optional(),
  /** Distance between the geocoded anchor and the growth seed. */
  anchorShiftM: z.number().nonnegative().optional(),
  cadastreSnapped: z.boolean().optional(),
  parcelCount: z.number().int().nonnegative().optional(),
  vehiclesInside: z.number().int().nonnegative().optional(),
  /** Vehicles just outside the ring — a strong sign the lot was clipped. */
  vehiclesOutsideNearby: z.number().int().nonnegative().optional(),
  stoppedBy: BoundaryGrowthStopSchema.optional(),
  /** Engine selected by settings at the time of this result. */
  requestedEngine: BoundaryEngineSchema.optional(),
  /** Engine that actually produced this polygon — may differ from requested on fallback. */
  usedEngine: BoundaryEngineSchema.optional(),
  /** Set when `usedEngine` differs from `requestedEngine`: why fusion was not used. */
  fallbackReason: z.string().max(200).optional(),
  /** Version of whichever pipeline (`usedEngine`) produced this result, for rollback/diagnosis. */
  resultVersion: z.number().int().nonnegative().optional(),
  /**
   * The search space was expanded (P3) up to its budget and still hit the
   * radius cap — there may be supported evidence this result did not reach.
   */
  possiblyIncomplete: z.boolean().optional(),
});
export type BoundaryQuality = z.infer<typeof BoundaryQualitySchema>;

// GeoJSON polygon (rings of [lon, lat] pairs). Keeping holes makes an edited
// operational lot faithfully represent courtyards, ponds and excluded yards.
export const PolygonSchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z
    .array(z.array(z.tuple([z.number(), z.number()])).min(4))
    .min(1),
});
export type Polygon = z.infer<typeof PolygonSchema>;

/** GeoJSON multipart geometry for operational sites split by a public road. */
export const MultiPolygonSchema = z.object({
  type: z.literal("MultiPolygon"),
  coordinates: z
    .array(z.array(z.array(z.tuple([z.number(), z.number()])).min(4)).min(1))
    .min(1),
});
export type MultiPolygon = z.infer<typeof MultiPolygonSchema>;

export const BoundaryGeometrySchema = z.union([
  PolygonSchema,
  MultiPolygonSchema,
]);
export type BoundaryGeometry = z.infer<typeof BoundaryGeometrySchema>;

/** A geometry considered during automatic boundary resolution. */
export const BoundaryCandidateSchema = z.object({
  source: BoundarySourceSchema,
  role: BoundaryGeometryRoleSchema.optional(),
  provider: z.string().optional(),
  polygon: BoundaryGeometrySchema,
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
  polygon: BoundaryGeometrySchema,
  areaSqm: z.number().nonnegative(),
  confidence: z.number().min(0).max(1),
  quality: BoundaryQualitySchema.optional(),
  evidence: RiskEvidenceSchema.optional(),
  /** Alternative geometries retained for human review and future fusion. */
  candidates: z.array(BoundaryCandidateSchema).max(10).optional(),
  /** True when the result should be checked before it is used for underwriting. */
  reviewRequired: z.boolean().optional(),
  /** ISO timestamp of the user's visual confirmation that the geometry covers the lot. */
  confirmedAt: z.string().datetime().optional(),
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
  /** Imagery the vehicles were counted on: source, capture date, alternatives. */
  imagery: ImagerySelectionSchema.optional(),
});
export type DetectionResult = z.infer<typeof DetectionResultSchema>;

export const PerilScoreSchema = z.object({
  peril: PerilSchema,
  score: z.number().min(0).max(100),
  hazardValue: z.number(),
  unit: z.string(),
});
export type PerilScore = z.infer<typeof PerilScoreSchema>;

export const HailZoneSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]);
export type HailZone = z.infer<typeof HailZoneSchema>;

/**
 * Inputs of the hail EAL (`EAL = N × λ_z × Σ p_k·S_k`), kept with the result
 * so the figure stays traceable to its vehicle count and hail-zone source.
 */
export const HailEalDetailSchema = z.object({
  /** Vehicles on site (N) before the roof-cover reduction. */
  vehicles: z.number().nonnegative(),
  /** Vehicles parked in the open: vehicles × exposure ratio. */
  exposedVehicles: z.number().nonnegative(),
  vehicleSource: z.enum(["manual", "detected", "assetValue", "none"]),
  zone: HailZoneSchema,
  /** postcode table, licensed provider score, or estimated from weather data. */
  zoneSource: z.enum(["postcode", "provider", "estimated"]),
  /** λ_z: damaging hail events per year at the site. */
  frequency: z.number().nonnegative(),
  /** Σ p_k·S_k: expected loss per exposed vehicle and event (EUR). */
  meanSeverityEur: z.number().nonnegative(),
});
export type HailEalDetail = z.infer<typeof HailEalDetailSchema>;

/**
 * Since screening-0.4.0 the EAL is hail-only. The other perils stay optional
 * so portfolios scored with older model versions still load.
 */
export const EalBreakdownSchema = z.object({
  hail: z.number().nonnegative(),
  wind: z.number().nonnegative().optional(),
  flood: z.number().nonnegative().optional(),
  lightning: z.number().nonnegative().optional(),
  snow: z.number().nonnegative().optional(),
  heat: z.number().nonnegative().optional(),
  total: z.number().nonnegative(),
  hailDetail: HailEalDetailSchema.optional(),
});
export type EalBreakdown = z.infer<typeof EalBreakdownSchema>;

export const RiskAssessmentSchema = z.object({
  /** Primary dealership score; currently the hail score. */
  overallScore: z.number().min(0).max(100),
  perils: z.array(PerilScoreSchema),
  eal: z.number().nonnegative(), // Expected Annual Loss from hail (EUR/year)
  ealBreakdown: EalBreakdownSchema.optional(),
  exposureEur: z.number().nonnegative().optional(), // estimated vehicle value on-site
  utilisation: z.number().min(0).optional(), // utilisation 0..1+ (vehicles / capacity)
  capacityEstimate: z.number().nonnegative().optional(), // estimated parking capacity
  /** Overall reliability of the result, separate from hazard severity. */
  confidence: z.number().min(0).max(1).optional(),
  modelVersion: z.string().optional(),
  evidence: z.array(RiskEvidenceSchema).optional(),
  /** Provider assessment used to override screening hazard proxies. */
  natCat: NatCatAssessmentSchema.optional(),
  limitations: z.array(z.string()).optional(),
  computedAt: z.string(),
});
export type RiskAssessment = z.infer<typeof RiskAssessmentSchema>;

// --- Complete analyzed dataset ---------------------------------------------

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
  vehicleValueDefaultEur: z.number().nonnegative(),
  capacitySqmPerVehicle: z.number().positive(),
  // --- Hail EAL: EAL = N × λ_z × (p_S·S_S + p_M·S_M + p_L·S_L) ----------
  // Defaults are uncalibrated screening placeholders (see docs/risk-model.md).
  // They carry Zod defaults so sessions saved before screening-0.4.0 load.
  /** λ_z: damaging hail events per year at a site in hail zone z. */
  hailFrequencyZone1: z
    .number()
    .nonnegative()
    .default(HAIL_FREQUENCY_BY_ZONE[1]),
  hailFrequencyZone2: z
    .number()
    .nonnegative()
    .default(HAIL_FREQUENCY_BY_ZONE[2]),
  hailFrequencyZone3: z
    .number()
    .nonnegative()
    .default(HAIL_FREQUENCY_BY_ZONE[3]),
  hailFrequencyZone4: z
    .number()
    .nonnegative()
    .default(HAIL_FREQUENCY_BY_ZONE[4]),
  hailFrequencyZone5: z
    .number()
    .nonnegative()
    .default(HAIL_FREQUENCY_BY_ZONE[5]),
  hailFrequencyZone6: z
    .number()
    .nonnegative()
    .default(HAIL_FREQUENCY_BY_ZONE[6]),
  /** p_k: share of events in each severity class (weights, normalized by their sum). */
  hailShareSmall: z
    .number()
    .min(0)
    .max(1)
    .default(HAIL_SEVERITY_CLASSES.small.share),
  hailShareMedium: z
    .number()
    .min(0)
    .max(1)
    .default(HAIL_SEVERITY_CLASSES.medium.share),
  hailShareLarge: z
    .number()
    .min(0)
    .max(1)
    .default(HAIL_SEVERITY_CLASSES.large.share),
  /** S_k: loss per exposed vehicle in an event of each severity class (EUR). */
  hailSeveritySmallEur: z
    .number()
    .nonnegative()
    .default(HAIL_SEVERITY_CLASSES.small.lossEur),
  hailSeverityMediumEur: z
    .number()
    .nonnegative()
    .default(HAIL_SEVERITY_CLASSES.medium.lossEur),
  hailSeverityLargeEur: z
    .number()
    .nonnegative()
    .default(HAIL_SEVERITY_CLASSES.large.lossEur),
  heatHotdaysScoreMax: z.number().positive(),
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
  /** Locations in this hail zone or above get a "high hail zone" review note. */
  alertHailZone: z.number().int().min(1).max(6).default(5),
  alertOvercapacity: z.number().nonnegative(),
  alertLowBoundaryConfidence: z.number().min(0).max(1),
  alertEalPortfolioShare: z.number().min(0).max(1),
  boundaryReviewConfidence: z.number().min(0).max(1),
  boundaryReviewTop2Margin: z.number().min(0).max(1),
  boundaryReviewSourceAgreement: z.number().min(0).max(1),
  boundaryNearPointDistanceM: z.number().nonnegative(),
  syntheticBoundaryRadiusM: z.number().positive(),
  detectionConfidence: z.number().min(0).max(1),
  // --- Boundary fusion engine -------------------------------------------
  // These carry Zod defaults on purpose: every stored session is re-parsed
  // with this schema, so a new *required* field would break loading every
  // portfolio saved before this release.
  /** Evidence raster cell size. 0.5 m matches z18 imagery at German latitudes. */
  boundaryGridResolutionM: z.number().positive().default(0.5),
  /** Square evidence window around the anchor. */
  boundaryGridExtentM: z.number().positive().default(400),
  /** A grown region must contain at least one cell at or above this score. */
  boundaryGrowHighThreshold: z.number().default(0.6),
  /** Growth continues through cells at or above this score (hysteresis). */
  boundaryGrowLowThreshold: z.number().default(0.15),
  /** Hard area cap; hitting it flags the result for review. */
  boundaryMaxAreaSqm: z.number().positive().default(200_000),
  /** Share of a cadastral parcel that must be covered before it is snapped in. */
  boundaryParcelSnapOverlap: z.number().min(0).max(1).default(0.6),
  /** Scales how strongly detected vehicles pull the boundary outwards. */
  boundaryVehicleEvidenceWeight: z.number().nonnegative().default(1),
  /** Below this share of barrier-backed outline the result needs review. */
  boundaryBarrierSupportReview: z.number().min(0).max(1).default(0.35),
  /** Segments within this angle of the dominant axis are snapped square. */
  boundaryRegularizeAngleToleranceDeg: z.number().min(0).max(45).default(12),
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

export const LlmProviderSchema = z.enum([
  "openai",
  "claude",
  "custom",
  "local",
]);
export type LlmProvider = z.infer<typeof LlmProviderSchema>;

export const LlmSettingsSchema = z.object({
  provider: LlmProviderSchema,
  model: z.string(),
  baseUrl: z.string().optional(),
  hasApiKey: z.boolean().optional(),
});
export type LlmSettings = z.infer<typeof LlmSettingsSchema>;

const HttpsUrlSchema = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === "https:", {
    message: "Endpoint must use HTTPS",
  });

/** A connected hazard API; the key lives in safeStorage, not here. */
export const NatCatConnectorSchema = z.object({
  /** Exact contracted endpoint; no vendor URL is assumed by the app. */
  endpoint: HttpsUrlSchema,
  hasApiKey: z.boolean().optional(),
});
export type NatCatConnector = z.infer<typeof NatCatConnectorSchema>;

/** Source choice for one peril: follow the primary source, screening, or an API. */
export const NatCatPerilSourceSchema = z.enum([
  "primary",
  "screening",
  ...NAT_CAT_API_PROVIDERS,
]);
export type NatCatPerilSource = z.infer<typeof NatCatPerilSourceSchema>;

export const NatCatSettingsSchema = z.object({
  /** Legacy single-provider switch; read only when `primary` is unset. */
  provider: z.enum(["screening", ...NAT_CAT_PROVIDERS]).default("screening"),
  /** Legacy CatNet endpoint; superseded by `connectors["swissre-catnet"]`. */
  catnetEndpoint: HttpsUrlSchema.optional(),
  catnetHasApiKey: z.boolean().optional(),
  /** Source for every peril without its own choice. Default: screening. */
  primary: z.enum(["screening", ...NAT_CAT_API_PROVIDERS]).optional(),
  /** Per-peril overrides, e.g. flood from a flood specialist. */
  perilSources: z.record(PerilSchema, NatCatPerilSourceSchema).optional(),
  connectors: z
    .record(NatCatApiProviderSchema, NatCatConnectorSchema)
    .optional(),
});
export type NatCatSettings = z.infer<typeof NatCatSettingsSchema>;

// --- Settings ---------------------------------------------------------------

export const SettingsSchema = z.object({
  language: z.enum(["en", "de", "fr"]).default("de"),
  llm: LlmSettingsSchema.optional(),
  natCat: NatCatSettingsSchema.optional(),
  /**
   * Satellite/aerial imagery tile source for the map & detection. "auto"
   * (the default when unset) picks Esri or the state orthophoto per location;
   * see shared/imagery-sources.ts.
   */
  satelliteProvider: z.enum(["auto", "esri", "wms"]).optional(),
  /** XYZ/WMS tile template with {z}/{x}/{y} placeholders (for provider 'wms'). */
  wmsTileUrl: z.string().optional(),
  /**
   * Lot boundary engine. "legacy" ranks candidate polygons and picks one;
   * "fused" rasterizes every source into one evidence grid and grows the site
   * out of the combination. Unset is treated as "legacy" by the detector
   * (`boundary.service.ts`'s `tryFusedBoundary`), which is what makes an
   * upgraded install without this key keep its prior behaviour; new installs
   * get an explicit "fused" default from `settings.service.ts`.
   */
  boundaryEngine: BoundaryEngineSchema.optional(),
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
