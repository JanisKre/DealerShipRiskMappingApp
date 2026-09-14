import type {
  BoundaryEvidenceLayer,
  BoundaryGrowthStop,
  BoundaryResult,
  Polygon,
  RiskParameters,
} from "@shared/types";
import { checkRing, type LonLat } from "../boundary-geometry";
import { createGrid, maskAreaSqm, type EvidenceGrid } from "./grid";
import {
  rasterizeBarrier,
  rasterizeDisk,
  rasterizePolygon,
  rasterizePolyline,
  rasterizeReinforcement,
} from "./rasterize";
import {
  closeMask,
  fillHoles,
  growRegion,
  largestComponent,
  pickSeed,
  reclaimBarrierCells,
} from "./region-grow";
import { maskToPolygon } from "./vectorize";
import type { EvidenceArea, EvidenceLine, OsmEvidence } from "./osm-overpass";
import type { ParcelFeature } from "../alkis.service";

/**
 * Evidence fusion: the step that replaces "rank the candidate polygons and keep
 * the best one".
 *
 * A dealership's operational lot is normally the *union* of things several
 * sources each describe only partly — a cadastral parcel or three, a mapped
 * forecourt, a showroom footprint — bounded by roads, fences and greenery. No
 * source publishes that shape, so no amount of choosing between sources can
 * produce it. Here every source is rasterized into one metric grid instead, and
 * the answer is grown out of the combined evidence.
 *
 * Pure: no network, no imagery decoding, no database. That is what makes the
 * whole thing replayable in the benchmark and cheap to test.
 */

/** Bumped whenever scoring changes, so cached results can be retired. */
export const FUSION_VERSION = 1;

/** Cell weights per evidence layer. See docs/boundary-model.md. */
export const LAYER_WEIGHTS = {
  /** Name- or address-matched dealer geometry: the strongest vector prior. */
  dealerAreaMatched: 1.2,
  dealerArea: 0.7,
  parking: 0.7,
  /** Weak on purpose: a retail landuse polygon is often a whole business park. */
  landuse: 0.35,
  building: 0.3,
  /** Interior circulation is positive evidence of the site's own extent. */
  serviceAisle: 0.8,
  /** Only the parcel containing the anchor; neighbours are for snapping. */
  anchorParcel: 0.5,
  addressNode: 0.4,
  publicRoad: -1.5,
  railway: -1.5,
  waterway: -1.5,
  vegetation: -0.6,
  water: -1.5,
} as const;

export interface FusionBundle {
  anchor: LonLat;
  name?: string;
  address?: string;
  osm: OsmEvidence | null;
  parcels: ParcelFeature[];
  parcelsTruncated: boolean;
  /** Address-matched geometry, if a match was found near the anchor. */
  matchedRing?: LonLat[];
  /** Which sources were reachable. A missing source is not a negative signal. */
  availability: Record<string, boolean>;
}

export interface FusionOutcome {
  polygon: Polygon;
  /**
   * Area from the **mask**, not the ring. The ring carries only an outer
   * boundary, so an unfilled interior void would otherwise be counted as lot.
   */
  areaSqm: number;
  layers: BoundaryEvidenceLayer[];
  stoppedBy: BoundaryGrowthStop;
  confirmed: boolean;
  anchorShiftM: number;
  reasons: string[];
  mask: Uint8Array;
  grid: EvidenceGrid;
}

interface LayerAccumulator {
  layers: BoundaryEvidenceLayer[];
  add: (layer: BoundaryEvidenceLayer) => void;
}

function accumulator(): LayerAccumulator {
  const layers: BoundaryEvidenceLayer[] = [];
  return { layers, add: (layer) => layers.push(layer) };
}

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const NAME_STOPWORDS = new Set([
  "auto",
  "autohaus",
  "gmbh",
  "co",
  "kg",
  "ag",
  "strasse",
  "deutschland",
  "filiale",
]);

/**
 * Whether an area's own tags identify it as *this* dealership rather than
 * merely as *a* dealership nearby. Used only to raise its weight.
 */
export function matchesSite(
  tags: Record<string, string>,
  name?: string,
  address?: string,
): boolean {
  const haystack = normalize(
    `${tags.name ?? ""} ${tags.brand ?? ""} ${tags.operator ?? ""}`,
  ).split(" ");
  const tokens = normalize(`${name ?? ""}`)
    .split(" ")
    .filter((token) => token.length >= 4 && !NAME_STOPWORDS.has(token));
  if (tokens.some((token) => haystack.includes(token))) return true;

  const postcode = address?.match(/\b\d{5}\b/)?.[0];
  if (postcode && tags["addr:postcode"] === postcode) {
    const houseNumber = address?.match(/\b\d+\s*[a-z]?\b/i)?.[0]?.trim().toLowerCase();
    if (!houseNumber) return true;
    return tags["addr:housenumber"]?.toLowerCase() === houseNumber;
  }
  return false;
}

function areaWeight(
  area: EvidenceArea,
  name?: string,
  address?: string,
): number {
  switch (area.kind) {
    case "dealerArea":
      return matchesSite(area.tags, name, address)
        ? LAYER_WEIGHTS.dealerAreaMatched
        : LAYER_WEIGHTS.dealerArea;
    case "parking":
      return LAYER_WEIGHTS.parking;
    case "landuse":
      return LAYER_WEIGHTS.landuse;
    case "building":
      return LAYER_WEIGHTS.building;
    case "vegetation":
      return LAYER_WEIGHTS.vegetation;
    case "water":
      return LAYER_WEIGHTS.water;
  }
}

function lineWeight(line: EvidenceLine): number {
  switch (line.kind) {
    case "serviceAisle":
      return LAYER_WEIGHTS.serviceAisle;
    case "publicRoad":
      return LAYER_WEIGHTS.publicRoad;
    case "railway":
      return LAYER_WEIGHTS.railway;
    case "waterway":
      return LAYER_WEIGHTS.waterway;
    case "barrier":
      // A fence says where the edge is, not what lies on either side of it.
      return 0;
  }
}

/** Builds the evidence grid. Exported so tests can inspect it directly. */
export function buildEvidenceGrid(
  bundle: FusionBundle,
  parameters: RiskParameters,
): { grid: EvidenceGrid; layers: BoundaryEvidenceLayer[] } {
  const grid = createGrid(
    bundle.anchor,
    parameters.boundaryGridResolutionM,
    parameters.boundaryGridExtentM,
  );
  const acc = accumulator();
  const { spec, score, blocked } = grid;

  if (bundle.matchedRing) {
    const cells = rasterizePolygon(
      spec,
      bundle.matchedRing,
      score,
      LAYER_WEIGHTS.dealerAreaMatched,
    );
    acc.add({
      layer: "address-match",
      source: "Nominatim / OpenStreetMap",
      weight: LAYER_WEIGHTS.dealerAreaMatched,
      cells,
      available: true,
    });
  }

  const osmAvailable = bundle.osm != null;
  const byKind = new Map<string, { cells: number; weight: number }>();

  for (const area of bundle.osm?.areas ?? []) {
    const weight = areaWeight(area, bundle.name, bundle.address);
    const cells = rasterizePolygon(spec, area.ring, score, weight);
    const key = `osm-${area.kind}`;
    const entry = byKind.get(key) ?? { cells: 0, weight };
    entry.cells += cells;
    // A matched and an unmatched dealer area share a layer but not a weight;
    // report the strongest one applied rather than whichever came first.
    if (Math.abs(weight) > Math.abs(entry.weight)) entry.weight = weight;
    byKind.set(key, entry);
  }

  for (const line of bundle.osm?.lines ?? []) {
    const key = `osm-${line.kind}`;
    const weight = lineWeight(line);
    let cells = 0;
    if (weight !== 0) {
      cells = rasterizePolyline(spec, line.line, line.halfWidthM, score, weight);
    }
    // Roads, rails and watercourses cut as well as push down: a lot does not
    // continue across the street just because the far side also looks paved.
    if (line.kind !== "serviceAisle") {
      rasterizeBarrier(spec, line.line, blocked);
    }
    const entry = byKind.get(key) ?? { cells: 0, weight };
    entry.cells += cells;
    byKind.set(key, entry);
  }

  for (const node of bundle.osm?.addressNodes ?? []) {
    if (!matchesSite(node.tags, bundle.name, bundle.address)) continue;
    rasterizeDisk(
      spec,
      node.point,
      15,
      score,
      LAYER_WEIGHTS.addressNode,
      "gauss",
    );
  }

  for (const [layer, entry] of byKind) {
    acc.add({
      layer,
      source: "OpenStreetMap / Overpass",
      weight: entry.weight,
      cells: entry.cells,
      available: true,
    });
  }
  if (!osmAvailable) {
    acc.add({
      layer: "osm",
      source: "OpenStreetMap / Overpass",
      weight: 0,
      cells: 0,
      available: false,
      limitation: "Overpass was unreachable; no vector evidence for this site",
    });
  }

  // Only the parcel containing the anchor contributes score, and it does so as
  // *reinforcement* — it is added where operational evidence already exists and
  // nowhere else. A parcel is a legal unit: it is routinely larger than the lot
  // (a dealership occupying part of a plot) or smaller (a lot spanning several
  // plots), so on its own authority it would simply flood the region out to its
  // own edges. Neighbouring parcels are held back entirely for the snapping
  // step; feeding them in here would double-count the cadastre.
  const anchorParcel = bundle.parcels.find((parcel) =>
    ringContains(parcel.ring, bundle.anchor),
  );
  if (anchorParcel) {
    const cells = rasterizeReinforcement(
      spec,
      anchorParcel.ring,
      score,
      LAYER_WEIGHTS.anchorParcel,
    );
    acc.add({
      layer: "alkis-anchor-parcel",
      source: `German cadastral service / ALKIS (${anchorParcel.state})`,
      weight: LAYER_WEIGHTS.anchorParcel,
      cells,
      available: true,
      ...(bundle.parcelsTruncated
        ? { limitation: "Cadastral response was truncated" }
        : {}),
    });
  } else if (bundle.availability.alkis === false) {
    acc.add({
      layer: "alkis-anchor-parcel",
      source: "German cadastral service / ALKIS",
      weight: 0,
      cells: 0,
      available: false,
      limitation: "No cadastral service covers this location",
    });
  }

  return { grid, layers: acc.layers };
}

function ringContains(ring: LonLat[], point: LonLat): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = yi > point[1] !== yj > point[1];
    if (crosses && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Grows a site from the fused evidence.
 *
 * Returns null when there is nothing defensible to grow from — the caller then
 * falls back to the candidate chain rather than inventing a shape.
 */
export function fuseBoundary(
  bundle: FusionBundle,
  parameters: RiskParameters,
): FusionOutcome | null {
  const { grid, layers } = buildEvidenceGrid(bundle, parameters);
  const reasons: string[] = [];

  const growOptions = {
    highThreshold: parameters.boundaryGrowHighThreshold,
    lowThreshold: parameters.boundaryGrowLowThreshold,
    maxAreaSqm: parameters.boundaryMaxAreaSqm,
    maxRadiusM: parameters.boundaryGridExtentM / 2,
  };

  // The anchor may sit on the street or on a neighbouring roof, so the seed is
  // allowed to move. The grid origin is not — moving it would silently change
  // every downstream cache key.
  const anchorLeashM = Math.min(60, parameters.boundaryNearPointDistanceM * 1.7);
  const seed = pickSeed(grid, anchorLeashM, growOptions);
  if (!seed) return null;

  const grown = growRegion(grid, seed, growOptions);
  if (grown.areaSqm === 0) return null;
  if (!grown.confirmed) {
    reasons.push("no strong evidence in the grown region");
  }
  if (grown.stoppedBy !== "exhausted") {
    reasons.push(`growth stopped by the ${grown.stoppedBy}`);
  }

  const closingCells = Math.max(
    1,
    Math.round(1.5 / parameters.boundaryGridResolutionM),
  );
  let mask = closeMask(grid.spec, grown.mask, closingCells);
  mask = largestComponent(grid.spec, mask);
  mask = fillHoles(grid.spec, mask, 2_500);
  mask = reclaimBarrierCells(grid.spec, mask, grid.blocked);

  const vector = maskToPolygon(grid.spec, mask, {
    simplifyToleranceM: 1,
    regularizeAngleToleranceDeg: parameters.boundaryRegularizeAngleToleranceDeg,
  });
  if (!vector) return null;

  const check = checkRing(vector.ring, { minAreaSqm: 250, maxAreaSqm: 500_000 });
  if (!check.valid) {
    reasons.push(`fused ring rejected: ${check.reason}`);
    return null;
  }
  if (!vector.regularized) {
    reasons.push("outline could not be squared up to a dominant axis");
  }

  const anchorShiftM = Math.hypot(
    (seed.col - grid.spec.cols / 2) * grid.spec.resolutionM,
    (seed.row - grid.spec.rows / 2) * grid.spec.resolutionM,
  );

  return {
    polygon: { type: "Polygon", coordinates: [vector.ring] },
    areaSqm: maskAreaSqm(grid.spec, mask),
    layers,
    stoppedBy: grown.stoppedBy,
    confirmed: grown.confirmed,
    anchorShiftM,
    reasons,
    mask,
    grid,
  };
}

/**
 * Confidence for a fused result.
 *
 * A named function rather than an inline expression so the calibration test can
 * pin its behaviour, and so the weights are visible next to the documentation
 * that justifies them.
 */
export function fusedConfidence(features: {
  /** Share of the outline backed by a fence, road or parcel edge. */
  barrierSupport: number;
  /** How many independent layers contributed, normalised. */
  layerDiversity: number;
  cadastreSnapped: boolean;
  areaPlausibility: number;
  confirmed: boolean;
  stoppedByCap: boolean;
}): number {
  const raw =
    0.18 +
    features.barrierSupport * 0.3 +
    features.layerDiversity * 0.22 +
    features.areaPlausibility * 0.18 +
    (features.cadastreSnapped ? 0.12 : 0);
  const penalised = features.confirmed ? raw : raw * 0.5;
  const capped = features.stoppedByCap ? penalised * 0.7 : penalised;
  return Math.min(1, Math.max(0, capped));
}

/** Fraction of distinct evidence layers that actually contributed cells. */
export function layerDiversity(layers: BoundaryEvidenceLayer[]): number {
  const positive = layers.filter(
    (layer) => layer.available && layer.cells > 0 && layer.weight > 0,
  ).length;
  // Four independent positive layers is as corroborated as this gets.
  return Math.min(1, positive / 4);
}

export function buildResultFromFusion(
  outcome: FusionOutcome,
  parameters: RiskParameters,
  extras: {
    barrierSupport: number;
    cadastreSnapped: boolean;
    parcelCount: number;
    areaPlausibility: number;
    sourceAgreement: number;
  },
): BoundaryResult {
  const confidence = fusedConfidence({
    barrierSupport: extras.barrierSupport,
    layerDiversity: layerDiversity(outcome.layers),
    cadastreSnapped: extras.cadastreSnapped,
    areaPlausibility: extras.areaPlausibility,
    confirmed: outcome.confirmed,
    stoppedByCap: outcome.stoppedBy !== "exhausted",
  });

  return {
    source: "fused",
    role: "operationalLot",
    provider: `fusion:v${FUSION_VERSION}`,
    polygon: outcome.polygon,
    areaSqm: outcome.areaSqm,
    confidence,
    quality: {
      geometryValid: true,
      pointRelation: "inside",
      sourceAgreement: extras.sourceAgreement,
      areaPlausibility: extras.areaPlausibility,
      boundaryFit: 1,
      reasons: outcome.reasons,
      layers: outcome.layers.slice(0, 32),
      fusionVersion: FUSION_VERSION,
      barrierSupport: extras.barrierSupport,
      anchorShiftM: outcome.anchorShiftM,
      cadastreSnapped: extras.cadastreSnapped,
      parcelCount: extras.parcelCount,
      stoppedBy: outcome.stoppedBy,
    },
    evidence: {
      source: "Fused multi-source evidence",
      retrievedAt: new Date().toISOString(),
      method: `evidence raster ${parameters.boundaryGridResolutionM} m, seeded region growing, cadastral snapping`,
      confidence,
      fallbackUsed: false,
      limitations: [
        "Screening estimate of the operational lot, not a survey",
        ...outcome.reasons.slice(0, 3),
      ],
    },
  };
}
