import { radarHailRank, type RadarHailClass } from "./radar-hail";
import type { RiskEvidence } from "./types";
import type { Bbox, HailEventCell } from "./hail-events";

/**
 * Synthetic hail storms for the map simulation: deterministic for a seed,
 * so a scenario can be shown, shared and reproduced. A storm is a cell
 * that moves in 5-minute steps along a heading (or a drawn path), grows,
 * peaks and decays; its outline is an ellipse stretched along the motion.
 * These are illustrations for a stress test, not a hail climatology:
 * sizes and speeds are typical values for central European hailstorms,
 * not fitted to observations. Methodology: docs/risk-model.md, "Hail
 * simulation".
 */

export const SIM_STEP_MS = 5 * 60 * 1000;
const KM_PER_DEG_LAT = 111.32;

/** Germany's bounding box, where random storms start. */
export const GERMANY_BBOX: Bbox = [5.9, 47.3, 15.0, 55.0];

/** Storm strength presets: the worst class and the widest cell. */
export const SIM_STRENGTHS = {
  moderate: { maxClass: "hail", widthKm: 6 },
  severe: { maxClass: "large", widthKm: 10 },
  extreme: { maxClass: "large", widthKm: 16 },
} as const satisfies Record<
  string,
  { maxClass: RadarHailClass; widthKm: number }
>;
export type SimStrength = keyof typeof SIM_STRENGTHS;

/** Directions of motion (degrees, 0 = north, 90 = east). */
export const SIM_HEADINGS = {
  "sw-ne": 55,
  "w-e": 85,
  "s-n": 20,
  "nw-se": 125,
} as const;
export type SimHeading = keyof typeof SIM_HEADINGS;

/** Mulberry32: small, fast, deterministic PRNG in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function kmPerDegLon(lat: number): number {
  return KM_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

/** Moves a point `km` along `headingDeg`. */
export function move(
  lon: number,
  lat: number,
  headingDeg: number,
  km: number,
): [number, number] {
  const h = (headingDeg * Math.PI) / 180;
  return [
    lon + (Math.sin(h) * km) / kmPerDegLon(lat),
    lat + (Math.cos(h) * km) / KM_PER_DEG_LAT,
  ];
}

/** Ground distance in km (equirectangular; fine at storm scale). */
export function groundKm(a: [number, number], b: [number, number]): number {
  const lat = (a[1] + b[1]) / 2;
  return Math.hypot(
    (b[0] - a[0]) * kmPerDegLon(lat),
    (b[1] - a[1]) * KM_PER_DEG_LAT,
  );
}

/** Heading from a to b in degrees. */
export function headingOf(a: [number, number], b: [number, number]): number {
  const lat = (a[1] + b[1]) / 2;
  const dx = (b[0] - a[0]) * kmPerDegLon(lat);
  const dy = (b[1] - a[1]) * KM_PER_DEG_LAT;
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

const CLASSES: RadarHailClass[] = ["mixed", "hail", "large"];

/** Class at a life stage (0..1 intensity), capped at the storm's maximum. */
function classAt(intensity: number, maxClass: RadarHailClass): RadarHailClass {
  const raw = intensity > 0.75 ? "large" : intensity > 0.45 ? "hail" : "mixed";
  return CLASSES[Math.min(radarHailRank(raw), radarHailRank(maxClass)) - 1];
}

const round5 = (n: number): number => Math.round(n * 1e5) / 1e5;

/** Ellipse outline (flat lon/lat ring) stretched along the heading. */
function ellipse(
  center: [number, number],
  headingDeg: number,
  widthKm: number,
  lengthKm: number,
  random: () => number,
  points = 20,
): number[] {
  const h = (headingDeg * Math.PI) / 180;
  const ring: number[] = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * 2 * Math.PI;
    const wobble = 0.88 + 0.24 * random();
    const along = (Math.cos(a) * lengthKm * wobble) / 2;
    const across = (Math.sin(a) * widthKm * wobble) / 2;
    // Rotate: "along" points in the heading, "across" to its right.
    const east = along * Math.sin(h) + across * Math.cos(h);
    const north = along * Math.cos(h) - across * Math.sin(h);
    ring.push(
      round5(center[0] + east / kmPerDegLon(center[1])),
      round5(center[1] + north / KM_PER_DEG_LAT),
    );
  }
  return ring;
}

function cellAt(
  t: number,
  track: number,
  center: [number, number],
  headingDeg: number,
  intensity: number,
  strength: { maxClass: RadarHailClass; widthKm: number },
  random: () => number,
): HailEventCell {
  const width = strength.widthKm * (0.45 + 0.55 * intensity);
  const ring = ellipse(center, headingDeg, width, width * 1.7, random);
  const b: Bbox = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < ring.length; i += 2) {
    b[0] = Math.min(b[0], ring[i]);
    b[2] = Math.max(b[2], ring[i]);
    b[1] = Math.min(b[1], ring[i + 1]);
    b[3] = Math.max(b[3], ring[i + 1]);
  }
  return {
    t,
    track,
    c: classAt(intensity, strength.maxClass),
    d: Math.round(50 + 15 * intensity),
    p: [round5(center[0]), round5(center[1])],
    b,
    r: [ring],
  };
}

/** Life cycle: grows, peaks in the first half, decays. */
function lifeIntensity(f: number, floor = 0): number {
  const s = Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, f))), 0.6);
  return floor + (1 - floor) * s;
}

export interface StormParams {
  start: [number, number];
  headingDeg: number;
  speedKmh: number;
  durationMin: number;
  strength: SimStrength;
  /** Start time of this storm (Unix ms). */
  t0: number;
  track: number;
}

/** One storm moving along a heading, with a slight wander. */
export function generateStorm(
  p: StormParams,
  random: () => number,
): HailEventCell[] {
  const steps = Math.max(2, Math.round(p.durationMin / 5) + 1);
  const strength = SIM_STRENGTHS[p.strength];
  const cells: HailEventCell[] = [];
  let pos = p.start;
  let heading = p.headingDeg;
  for (let i = 0; i < steps; i++) {
    const intensity = lifeIntensity(i / (steps - 1));
    cells.push(
      cellAt(
        p.t0 + i * SIM_STEP_MS,
        p.track,
        pos,
        heading,
        intensity,
        strength,
        random,
      ),
    );
    heading += (random() - 0.5) * 8;
    const km = ((p.speedKmh * (0.9 + 0.2 * random())) / 60) * 5;
    pos = move(pos[0], pos[1], heading, km);
  }
  return cells;
}

/**
 * A storm moving along a drawn path ([lon, lat] points) at `speedKmh`.
 * The whole path hails: the intensity stays at least 0.6, peaking in the
 * middle.
 */
export function stormAlongPath(
  path: readonly [number, number][],
  speedKmh: number,
  strength: SimStrength,
  t0: number,
  seed: number,
  track = 0,
): HailEventCell[] {
  if (path.length < 2) return [];
  const random = rng(seed);
  const segments = path
    .slice(1)
    .map((b, i) => ({ a: path[i], b, km: groundKm(path[i], b) }));
  const total = segments.reduce((s, x) => s + x.km, 0);
  if (total <= 0) return [];
  const stepKm = (speedKmh / 60) * 5;
  const steps = Math.max(2, Math.ceil(total / stepKm) + 1);
  const cells: HailEventCell[] = [];
  for (let i = 0; i < steps; i++) {
    let d = Math.min(total, i * stepKm);
    let seg = segments[0];
    for (const s of segments) {
      seg = s;
      if (d <= s.km) break;
      d -= s.km;
    }
    const f = seg.km > 0 ? Math.min(1, d / seg.km) : 0;
    const pos: [number, number] = [
      seg.a[0] + (seg.b[0] - seg.a[0]) * f,
      seg.a[1] + (seg.b[1] - seg.a[1]) * f,
    ];
    const intensity = lifeIntensity(i / (steps - 1), 0.6);
    cells.push(
      cellAt(
        t0 + i * SIM_STEP_MS,
        track,
        pos,
        headingOf(seg.a, seg.b),
        intensity,
        SIM_STRENGTHS[strength],
        random,
      ),
    );
  }
  return cells;
}

export interface OutbreakParams {
  seed: number;
  storms: number;
  strength: SimStrength;
  heading: SimHeading;
  t0: number;
  /** Start points to aim at instead of random ones (e.g. dealerships). */
  targets?: ReadonlyArray<[number, number]>;
  area?: Bbox;
}

/**
 * Several storms on one afternoon: common direction of motion, starts
 * spread over three hours. Random starts favour the south of the area
 * (hail is more frequent in southern Germany). With `targets`, each storm
 * starts upwind of a target so that its track passes over it.
 */
export function generateOutbreak(o: OutbreakParams): HailEventCell[] {
  const random = rng(o.seed);
  const area = o.area ?? GERMANY_BBOX;
  const base = SIM_HEADINGS[o.heading];
  const cells: HailEventCell[] = [];
  for (let s = 0; s < o.storms; s++) {
    const heading = base + (random() - 0.5) * 20;
    const speedKmh = 35 + random() * 30;
    const durationMin = 60 + Math.round(random() * 24) * 5;
    const target = o.targets?.length ? o.targets[s % o.targets.length] : null;
    let start: [number, number];
    if (target) {
      start = target;
    } else {
      let lat = area[1];
      for (let k = 0; k < 20; k++) {
        lat = area[1] + random() * (area[3] - area[1]);
        // Accept southern starts more often (weight 1 in the south, 0.35 in the north).
        const w = 1 - 0.65 * ((lat - area[1]) / (area[3] - area[1]));
        if (random() < w) break;
      }
      start = [area[0] + random() * (area[2] - area[0]), lat];
    }
    const t0 = o.t0 + Math.round((random() * 180) / 5) * SIM_STEP_MS;
    let storm = generateStorm(
      {
        start,
        headingDeg: heading,
        speedKmh,
        durationMin,
        strength: o.strength,
        t0,
        track: s,
      },
      random,
    );
    if (target) {
      // Move the storm so that its cell a quarter to two fifths into its
      // life sits over the target, a little to the side: the track passes
      // over the target whatever the storm's wander.
      const k = Math.round((storm.length - 1) * (0.25 + 0.15 * random()));
      const aim = move(
        target[0],
        target[1],
        heading + 90,
        (random() - 0.5) * 2,
      );
      const dLon = aim[0] - storm[k].p[0];
      const dLat = aim[1] - storm[k].p[1];
      storm = storm.map((c) => ({
        ...c,
        p: [round5(c.p[0] + dLon), round5(c.p[1] + dLat)] as [number, number],
        b: [c.b[0] + dLon, c.b[1] + dLat, c.b[2] + dLon, c.b[3] + dLat] as Bbox,
        r: c.r.map((ring) =>
          ring.map((v, i) => round5(v + (i % 2 === 0 ? dLon : dLat))),
        ),
      }));
    }
    cells.push(...storm);
  }
  return cells.sort((a, b) => a.t - b.t || a.track - b.track);
}

/** Evidence of a storm generated or drawn in the app. */
export function simulationEvidence(
  source: "simulation" | "drawn",
): RiskEvidence {
  return {
    source:
      source === "drawn"
        ? "Storm drawn on the map"
        : "Hail storm generator (synthetic)",
    retrievedAt: new Date().toISOString(),
    dataVersion: "hail-sim 1.0",
    method:
      "Cells in 5-minute steps along a heading or a drawn path; ellipse 1.7× longer than wide, growing, peaking and decaying; class from the life stage, capped by the chosen strength",
    confidence: 0.2,
    fallbackUsed: false,
    limitations: [
      "Synthetic: sizes, speeds and classes are typical values, not observations or a hail climatology",
      "Stress test only: not used in the hail EAL and not a catastrophe-model PML",
    ],
  };
}
