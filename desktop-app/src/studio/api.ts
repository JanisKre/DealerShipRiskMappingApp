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
  ended?: string;
  finishedSites: number;
  checkedTiles: number;
  /** Outcome of the round's job; "done" for rounds recorded before outcomes were kept. */
  state: "running" | "done" | "failed" | "stopped" | "lost" | "unknown";
  /** Stage the round stopped in (failed, stopped or lost). */
  failedStage?: string | null;
  failedStageKey?: string | null;
  appBest: Threshold | null;
}

export interface Job {
  id: string;
  step: string;
  /** German title (log, older jobs); the page shows `titleKey` translated. */
  title: string;
  titleKey?: string;
  titleParams?: Record<string, unknown>;
  run: string | null;
  status: "running" | "done" | "failed" | "stopped" | "lost";
  started: string;
  ended?: string;
  stage: number;
  /** `key` is stable (studio.py STAGES); `name` is the German text. */
  stages: { key?: string; name: string }[];
  locked?: boolean;
  log: string[];
  /** A lost job whose commands still run without their driver (Abbrechen stops them). */
  orphans?: boolean;
  /** Why a failed or lost job ended: the stage and a one-line reason. */
  error?: {
    code: string;
    stage: string | null;
    stageKey?: string | null;
    message: string;
  };
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
    /** Error code why installing into the app is refused (sandbox), or null. */
    installBlocked: string | null;
    release: {
      tag: string | null;
      onnxSha256: string | null;
      manifestSha256: string | null;
      file: string;
      repository: string | null;
      /** Error code why pinning a release is refused (sandbox), or null. */
      blocked: string | null;
    };
  };
  job: Job | null;
  weights: string[];
  baseModels: string[];
  claude: { sheets: number; answers: number };
  appDb: boolean;
  /** Error code why reading the app's corrections is refused, or null. */
  harvestBlocked: string | null;
  /** Set when TRAINING_DATA_DIR points the studio at a sandbox folder. */
  sandbox: { data: string; appModels: string | null } | null;
  /** Fewest finished sites a round accepts (make_dataset.py's minimum). */
  minRoundSites: number;
  /** Sites whose tiles are all finished (what a round trains on). */
  finishedSites: number;
  /** An uploaded dealer list (data/dealers.csv) exists. */
  dealersCsv: boolean;
  /** Start weights the studio can download (yolo11s-obb.pt). */
  defaultBase: string;
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

/** What a tile save returns: the tile's state as the server stored it. */
export interface SaveResult {
  ok: true;
  done: boolean;
  questions: number;
}

/**
 * A refused or failed request. `code` is stable (studio.py MESSAGES, plus
 * "offline" when the studio cannot be reached and "http" for anything else),
 * so the page can react to it and show it in its own words.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly params: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const TOKEN =
  document.querySelector<HTMLMetaElement>('meta[name="studio-token"]')
    ?.content ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError("Studio unreachable", "offline", 0);
  }
  const data = (await res.json().catch(() => null)) as {
    error?: string;
    code?: string;
    params?: Record<string, unknown>;
  } | null;
  if (!res.ok)
    throw new ApiError(
      data?.error ?? `HTTP ${res.status}`,
      data?.code ?? "http",
      res.status,
      data?.params ?? {},
    );
  return data as T;
}

const get = <T>(path: string): Promise<T> => request<T>(path);

const post = <T>(path: string, body: unknown): Promise<T> =>
  request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Studio-Token": TOKEN },
    body: JSON.stringify(body),
  });

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
    post<SaveResult>(
      `/api/label/tile/${encodeURIComponent(stem)}?mode=${mode}`,
      { boxes, done },
    ),
  uploadDealers: (csv: string) =>
    post<{ rows: number }>("/api/sites/upload", { csv }),
  imageUrl: (stem: string) => `/api/label/img/${encodeURIComponent(stem)}`,
  pinRelease: (source: "export" | "installed") =>
    post<{ tag: string; commands: string[] }>("/api/release/pin", { source }),
};

const RUN_COLORS = 8;
/**
 * Colour of a run, fixed so that adding a run never recolours a round:
 * round-NN take the palette in order (round-01 the first colour), other runs
 * take it from the end, in name order among themselves.
 */
export function runColor(name: string, all: string[] = []): string {
  const round = /^round-(\d+)$/.exec(name);
  let i: number;
  if (round) i = Number(round[1]) - 1;
  else {
    const others = all.filter((n) => !/^round-\d+$/.test(n)).sort();
    i = RUN_COLORS - 1 - Math.max(0, others.indexOf(name));
  }
  return `var(--run-${(((i % RUN_COLORS) + RUN_COLORS) % RUN_COLORS) + 1})`;
}
