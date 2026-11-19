/**
 * Opt-in fit of the site model's weights (`site-model.ts`). No network, no
 * vehicle model: it reads frozen boundary inputs and prints the weights.
 *
 *   SITE_FIT_REFERENCES=~/.dealership-risk/benchmarks/boundary-public-v2-inputs.json \
 *   SITE_FIT_LABELLED=~/.dealership-risk/benchmarks/audit/inputs \
 *   SITE_FIT_LABELS=~/.dealership-risk/benchmarks/audit/labels.json \
 *     npm run benchmark:boundary:fit
 *
 * Two kinds of sites, either or both:
 *
 * - `SITE_FIT_REFERENCES`: a replay dump (`ReplaySample[]`, written by
 *   `BOUNDARY_BENCHMARK_DUMP`) whose samples carry a reference outline. A
 *   parcel is a member when at least half of it lies inside the reference.
 *   The vehicles are those of the 125 m image unless the sample has an
 *   `imageRadiusM`.
 * - `SITE_FIT_LABELLED` + `SITE_FIT_LABELS`: a folder of `<id>.json`
 *   samples (same shape, plus `address` and `image` bounds) and a label file
 *   `{ "<id>": { "sure": [parcel indices | "seed"], "opt": [indices] } }`.
 *   `sure` parcels are members, `opt` parcels count either way, a parcel
 *   bordering a `sure` one and not listed is not a member. Sites with an
 *   empty `sure` are skipped (wrong point, no dealership). Labelled inputs
 *   name real businesses and stay outside the repository.
 *
 * Each site gives one row per judged parcel and round: the true set is grown
 * round by round from the parcel at the point, and every bordering parcel is
 * a row with the evidence it shows against the set at that time. The model
 * is a logistic regression with a ridge penalty, fitted by gradient descent.
 * Cross-validation holds out one group at a time (state for references,
 * five folds for labelled sites) and grows every held-out site with weights
 * fitted without its group.
 *
 * `SITE_FIT_LABELLED_WEIGHT` (default 3) weighs rows of labelled sites, of
 * which there are fewer than reference rows; `SITE_FIT_L2` (default 1) is
 * the penalty.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import type { BoundaryGeometry } from "@shared/types";
import type { LonLat } from "../boundary-geometry";
import type { ParcelFeature } from "../alkis.service";
import { evaluateBoundaryBenchmark } from "../boundary-benchmark";
import { imageBoundsAround, type ReplaySample } from "./boundary-replay";
import {
  geometryContains,
  isRoadParcel,
  contains,
  ringBounds,
  unionRings,
  withoutHoles,
} from "./cascade";
import { CASCADE_LIMITS } from "./cascade-config";
import { vegetationAt, type VegetationMask } from "./vegetation";
import {
  buildSiteGraph,
  frontier,
  parcelEvidence,
  parcelIndexAt,
  siteIdentity,
  type SiteGraph,
  type SiteIdentity,
} from "./site-graph";
import {
  growSite,
  SITE_FEATURES,
  SITE_MODEL,
  siteFeatures,
} from "./site-model";

const env = process.env;
const path = (value: string): string =>
  resolve(value.replace(/^~(?=\/)/, homedir()));

type FitSample = ReplaySample & {
  image?: { west: number; south: number; east: number; north: number };
};

interface Site {
  id: string;
  set: "reference" | "labelled";
  group: string;
  graph: SiteGraph;
  /** 1 member, 0 not, null either way. */
  label: Array<0 | 1 | null>;
  seed: number;
  excluded: boolean[];
  identity: SiteIdentity;
  reference?: BoundaryGeometry;
}

/** Share of a ring's area inside a geometry, on a lattice. */
function shareInside(ring: LonLat[], geometry: BoundaryGeometry): number {
  const [west, south, east, north] = ringBounds(ring);
  const areaM = (north - south) * 111_320 * ((east - west) * 71_000);
  const stepM = Math.max(2, Math.sqrt(Math.max(areaM, 1) / 400));
  const dLat = stepM / 111_320;
  const dLon = dLat / Math.cos((((south + north) / 2) * Math.PI) / 180);
  let total = 0;
  let inside = 0;
  for (let lat = south + dLat / 2; lat < north; lat += dLat) {
    for (let lon = west + dLon / 2; lon < east; lon += dLon) {
      if (!contains(ring, [lon, lat])) continue;
      total += 1;
      if (geometryContains(geometry, [lon, lat])) inside += 1;
    }
  }
  return total === 0 ? 0 : inside / total;
}

function graphOf(sample: FitSample): SiteGraph {
  const mask: VegetationMask | null = sample.vegetation
    ? typeof sample.vegetation.cells === "string"
      ? {
          ...sample.vegetation,
          cells: new Uint8Array(Buffer.from(sample.vegetation.cells, "base64")),
        }
      : (sample.vegetation as VegetationMask)
    : null;
  return buildSiteGraph({
    anchor: sample.anchor,
    parcels: sample.parcels,
    vehicles: sample.vehicles,
    buildings: sample.buildings ?? [],
    imageBounds: sample.image
      ? [
          sample.image.west,
          sample.image.south,
          sample.image.east,
          sample.image.north,
        ]
      : imageBoundsAround(sample.anchor, sample.imageRadiusM ?? 125),
    ...(mask
      ? { vegetationAt: (point: LonLat) => vegetationAt(mask, point) }
      : {}),
  });
}

function excludedOf(parcels: ParcelFeature[]): boolean[] {
  return parcels.map(
    (parcel) =>
      isRoadParcel(parcel, parcels) ||
      parcel.areaSqm > CASCADE_LIMITS.maxParcelSqm,
  );
}

function loadSites(): Site[] {
  const sites: Site[] = [];
  if (env.SITE_FIT_REFERENCES) {
    const samples = JSON.parse(
      readFileSync(path(env.SITE_FIT_REFERENCES), "utf8"),
    ) as FitSample[];
    for (const sample of samples) {
      if (sample.parcels.length === 0 || !sample.reference) continue;
      const graph = graphOf(sample);
      const label = sample.parcels.map((parcel): 0 | 1 =>
        shareInside(parcel.ring, sample.reference!) >= 0.5 ? 1 : 0,
      );
      const seed = parcelIndexAt(graph, sample.anchor);
      // A point off the reference says nothing about which parcels join.
      if (seed < 0 || label[seed] !== 1) continue;
      sites.push({
        id: sample.id,
        set: "reference",
        group: sample.id.slice(0, 5),
        graph,
        label,
        seed,
        excluded: excludedOf(sample.parcels),
        identity: siteIdentity(graph, seed, sample.address),
        reference: sample.reference,
      });
    }
  }
  if (env.SITE_FIT_LABELLED && env.SITE_FIT_LABELS) {
    const dir = path(env.SITE_FIT_LABELLED);
    const labels = JSON.parse(
      readFileSync(path(env.SITE_FIT_LABELS), "utf8"),
    ) as Record<string, { sure: Array<number | "seed">; opt: number[] }>;
    const ids = readdirSync(dir)
      .filter((file) => file.endsWith(".json"))
      .map((file) => file.replace(/\.json$/, ""))
      .sort();
    ids.forEach((id, position) => {
      const entry = labels[id];
      if (!entry || entry.sure.length === 0) return;
      if (!existsSync(join(dir, `${id}.json`))) return;
      const sample = JSON.parse(
        readFileSync(join(dir, `${id}.json`), "utf8"),
      ) as FitSample;
      const graph = graphOf(sample);
      const at = parcelIndexAt(graph, sample.anchor);
      const sure = new Set(entry.sure.map((v) => (v === "seed" ? at : v)));
      const opt = new Set(entry.opt);
      // The labelled parcel at the point, else the largest labelled one
      // (the point lies on the road or on a neighbour).
      const seed = sure.has(at)
        ? at
        : [...sure].sort(
            (a, b) => sample.parcels[b].areaSqm - sample.parcels[a].areaSqm,
          )[0];
      if (seed == null || seed < 0) return;
      sites.push({
        id,
        set: "labelled",
        group: `fold-${position % 5}`,
        graph,
        label: sample.parcels.map((_, i) =>
          sure.has(i)
            ? 1
            : opt.has(i)
              ? null
              : [...sure].some((m) => (graph.shared[i].get(m) ?? 0) >= 1)
                ? 0
                : null,
        ),
        seed,
        excluded: excludedOf(sample.parcels),
        identity: siteIdentity(graph, seed, sample.address),
      });
    });
  }
  return sites;
}

interface Row {
  x: number[];
  y: number;
  group: string;
  weight: number;
}

/** The true set grown in rounds; every bordering parcel judged at each. */
function rowsOf(site: Site, labelledWeight: number): Row[] {
  const rows: Row[] = [];
  const members = new Set<number>([site.seed]);
  for (let round = 0; round < 12; round += 1) {
    const joining: number[] = [];
    for (const index of frontier(site.graph, members)) {
      const label = site.label[index];
      if (site.excluded[index] || label == null) continue;
      rows.push({
        x: siteFeatures(
          parcelEvidence(site.graph, members, index, site.identity),
        ),
        y: label,
        group: site.group,
        weight: site.set === "labelled" ? labelledWeight : 1,
      });
      if (label === 1) joining.push(index);
    }
    if (joining.length === 0) break;
    for (const index of joining) members.add(index);
  }
  return rows;
}

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));

function fit(rows: Row[], l2: number): number[] {
  const n = SITE_FEATURES.length;
  const weights = new Array<number>(n).fill(0);
  const total = rows.reduce((sum, row) => sum + row.weight, 0);
  for (let iteration = 0; iteration < 5000; iteration += 1) {
    const gradient = new Array<number>(n).fill(0);
    for (const row of rows) {
      let z = 0;
      for (let i = 0; i < n; i += 1) z += weights[i] * row.x[i];
      const error = row.weight * (sigmoid(z) - row.y);
      for (let i = 0; i < n; i += 1) gradient[i] += error * row.x[i];
    }
    for (let i = 0; i < n; i += 1) {
      // The bias is not penalised.
      const penalty = i === 0 ? 0 : (l2 * weights[i]) / total;
      weights[i] -= 0.5 * (gradient[i] / total + penalty);
    }
  }
  return weights;
}

/** Missing and excess share of a grown site against its labels. */
function score(
  site: Site,
  members: Set<number>,
): { missing: number; excess: number } {
  if (site.reference) {
    const union = withoutHoles(
      unionRings([...members].map((i) => site.graph.parcels[i].ring))!,
    );
    const result = evaluateBoundaryBenchmark([
      { id: site.id, reference: site.reference, predicted: union },
    ]);
    return {
      missing: 1 - result.meanCoverage,
      excess: result.meanExcessShare,
    };
  }
  let sure = 0;
  let missing = 0;
  let excess = 0;
  site.label.forEach((label, index) => {
    const area = site.graph.parcels[index].areaSqm;
    if (label === 1) {
      sure += area;
      if (!members.has(index)) missing += area;
    } else if (label === 0 && members.has(index)) excess += area;
  });
  return { missing: missing / sure, excess: excess / sure };
}

const enabled = Boolean(
  env.SITE_FIT_REFERENCES || (env.SITE_FIT_LABELLED && env.SITE_FIT_LABELS),
);

describe.skipIf(!enabled)("site model fit (frozen inputs)", () => {
  it(
    "fits the weights and cross-validates them by group",
    () => {
      const sites = loadSites();
      expect(sites.length).toBeGreaterThan(0);
      const labelledWeight = Number(env.SITE_FIT_LABELLED_WEIGHT ?? 3);
      const l2 = Number(env.SITE_FIT_L2 ?? 1);
      const rowsBySite = sites.map((site) => rowsOf(site, labelledWeight));
      const rows = rowsBySite.flat();
      console.log(
        `sites: ${sites.filter((s) => s.set === "reference").length} with a reference, ` +
          `${sites.filter((s) => s.set === "labelled").length} labelled; ` +
          `rows ${rows.length}, of which members ${rows.filter((r) => r.y === 1).length}`,
      );

      // Each site grown with weights fitted without its group.
      const limit = 0.25;
      const tally = new Map<string, number[]>();
      for (const held of new Set(sites.map((site) => site.group))) {
        const weights = fit(
          rows.filter((row) => row.group !== held),
          l2,
        );
        for (const site of sites.filter((s) => s.group === held)) {
          const grown = growSite(site.graph, site.seed, site.identity, {
            excluded: (index) => site.excluded[index],
            maxAreaSqm: 60_000,
            weights,
          });
          const { missing, excess } = score(site, new Set(grown.members));
          const counts = tally.get(site.set) ?? [0, 0, 0, 0, 0];
          counts[0] += 1;
          counts[
            missing > limit ? (excess > limit ? 4 : 2) : excess > limit ? 3 : 1
          ] += 1;
          tally.set(site.set, counts);
        }
      }
      for (const [set, [n, fine, cut, much, both]] of tally) {
        console.log(
          `cross-validated at ${SITE_MODEL.joinAt}, ${set}: n=${n} fine ${fine}, cut off ${cut}, too much ${much}, both ${both} (line: ${limit * 100} % of the lot)`,
        );
      }

      const weights = fit(rows, l2);
      console.log("\nweights on all sites (log-odds):");
      SITE_FEATURES.forEach((name, i) => {
        console.log(
          `  ${name.padEnd(16)} ${weights[i].toFixed(2).padStart(6)}   (shipped ${(SITE_MODEL.weights[i] ?? 0).toFixed(2)})`,
        );
      });
      console.log(
        `\nweights: [${weights.map((w) => Number(w.toFixed(2))).join(", ")}]`,
      );
      expect(weights).toHaveLength(SITE_FEATURES.length);
    },
    30 * 60 * 1000,
  );
});
