import type { TileBox, TileData } from "./editor/boxes";

/** Types of training/studio.py's JSON API. */

export interface Threshold {
  conf: number;
  mae: number;
  bias: number;
  within10: number;
}

export interface Evaluation {
  file: string;
  pipeline: "app-inferWindow" | "ultralytics";
  run?: string | null;
  weights?: string;
  date?: string;
  map50?: number | null;
  thresholds: Threshold[];
}

export interface Run {
  name: string;
  model: string;
  epochs: number;
  lastEpoch: number;
  best: { epoch: number; map50: number } | null;
  state: "running" | "finished" | "interrupted" | "empty";
  hasBest: boolean;
  hasLast: boolean;
  curve: [number, number][];
  modified: string;
}

export interface ModelFiles {
  sha256: string;
  manifestSha256: string | null;
  version: string | null;
  defaultConfidence: number | null;
  trainingData: string[];
  manifestMatches: boolean;
  modified: string;
  weights?: string | null;
}

export interface Round {
  run: string;
  base: string;
  epochs: number;
  pseudo: boolean;
  started: string;
  finishedSites: number;
  checkedTiles: number;
  appBest: Threshold | null;
}

export interface Job {
  id: string;
  step: string;
  title: string;
  run: string | null;
  status: "running" | "done" | "failed" | "stopped" | "lost";
  started: string;
  ended?: string;
  stage: number;
  stages: { name: string }[];
  locked?: boolean;
  log: string[];
}

export interface ReviewSummary {
  tiles: number;
  doneTiles: number;
  questions: number;
  sites: number;
  openSites: number;
  weights: string | null;
}

export interface Status {
  generated: string;
  sites: {
    sites: number;
    finished: number;
    tiles: number;
    checkedTiles: number;
    perState: Record<string, { sites: number; finished: number }>;
  };
  review: ReviewSummary;
  audit: ReviewSummary;
  dataset: {
    trainTiles: number;
    valTiles: number;
    trainSites: number;
    valSites: number;
    degraded: number;
    pseudoSites: number;
    built: string | null;
  };
  runs: Run[];
  evals: Evaluation[];
  rounds: Round[];
  models: {
    installed: ModelFiles | null;
    export: ModelFiles | null;
    backups: string[];
    release: {
      tag: string | null;
      onnxSha256: string | null;
      manifestSha256: string | null;
      file: string;
      repository: string | null;
    };
  };
  job: Job | null;
  weights: string[];
  baseModels: string[];
  claude: { sheets: number; answers: number };
}

export type LabelMode = "label" | "audit";

export interface QueueSite {
  site: string;
  state: string;
  tiles: { stem: string; done: boolean; questions: number }[];
  done: number;
  questions: number;
}

export interface Queue {
  mode: LabelMode;
  sites: QueueSite[];
  skipped: string[];
  locked: boolean;
}

const TOKEN =
  document.querySelector<HTMLMetaElement>('meta[name="studio-token"]')
    ?.content ?? "";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Studio-Token": TOKEN },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  status: () => get<Status>("/api/status"),
  job: () => get<{ job: Job | null }>("/api/job"),
  run: (step: string, options: Record<string, unknown> = {}) =>
    post<{ job: Job }>("/api/run", { step, options }),
  stop: () => post<{ ok: true }>("/api/stop", {}),
  queue: (mode: LabelMode) => get<Queue>(`/api/label/queue?mode=${mode}`),
  tile: (mode: LabelMode, stem: string) =>
    get<TileData>(`/api/label/tile/${encodeURIComponent(stem)}?mode=${mode}`),
  saveTile: (mode: LabelMode, stem: string, boxes: TileBox[], done: boolean) =>
    post<{ ok: true }>(
      `/api/label/tile/${encodeURIComponent(stem)}?mode=${mode}`,
      { boxes, done },
    ),
  imageUrl: (stem: string) => `/api/label/img/${encodeURIComponent(stem)}`,
  pinRelease: (source: "export" | "installed") =>
    post<{ tag: string; commands: string[] }>("/api/release/pin", { source }),
};

const RUN_COLORS = 8;
/** Colour per run, fixed by name order so it never changes with a filter. */
export function runColor(name: string, all: string[]): string {
  const i = Math.max(0, [...all].sort().indexOf(name));
  return `var(--run-${(i % RUN_COLORS) + 1})`;
}

export const fmt = (n: number | null | undefined, digits = 0): string =>
  n == null
    ? "–"
    : n.toLocaleString("de-DE", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });

export const pct = (n: number | null | undefined, digits = 1): string =>
  n == null ? "–" : `${n > 0 ? "+" : ""}${fmt(n * 100, digits)} %`;
