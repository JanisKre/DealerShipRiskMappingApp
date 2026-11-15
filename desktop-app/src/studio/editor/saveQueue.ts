import type { LabelMode, SaveResult } from "@studio/api";
import type { TileBox } from "./boxes";

/**
 * Saving tiles without losing edits.
 *
 * - Saves of one tile go out one after the other (a late draft can never
 *   overtake "Kachel fertig"; studio.py also keeps a finished tile finished).
 * - A tile left with unsaved edits becomes a background draft. While labels are
 *   locked (409) or the studio is unreachable it is retried until it is stored;
 *   reopening the tile takes the draft back into the editor.
 * - A save the server refuses (400) is not retried: the same request would be
 *   refused again.
 *
 * Kept free of the DOM and of api.ts so it can be tested on its own.
 */
export interface SaveRequest {
  mode: LabelMode;
  stem: string;
  boxes: TileBox[];
  done: boolean;
}

export type Send = (request: SaveRequest) => Promise<SaveResult>;

/** Why a save did not go through, and so what to do about it. */
export type SaveFailure =
  /** Suggestions are being rewritten (409): wait, then save again. */
  | "locked"
  /** The studio cannot be reached: wait, then save again. */
  | "offline"
  /** The studio was restarted (stale token): only a page reload helps. */
  | "reload"
  /** The server refused this content (400): retrying would not help. */
  | "rejected";

export function failureOf(error: unknown): SaveFailure {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "labels_locked") return "locked";
  if (code === "offline") return "offline";
  if (code === "bad_token") return "reload";
  return "rejected";
}

/** Failures that go away by themselves: save again later. */
export const isTransient = (f: SaveFailure): boolean =>
  f === "locked" || f === "offline";

export interface SaveQueueOptions {
  retryMs?: number;
  /** Timer, replaceable in tests. */
  schedule?: (fn: () => void, ms: number) => void;
}

type Listener = (request: SaveRequest, result: SaveResult) => void;
type DropListener = (request: SaveRequest, error: unknown) => void;

const keyOf = (mode: LabelMode, stem: string): string => `${mode}:${stem}`;

export class SaveQueue {
  private chains = new Map<string, Promise<unknown>>();
  private drafts = new Map<string, SaveRequest>();
  private retrying = new Set<string>();
  private saved = new Set<Listener>();
  private dropped = new Set<DropListener>();
  private readonly retryMs: number;
  private readonly schedule: (fn: () => void, ms: number) => void;

  constructor(
    private readonly send: Send,
    options: SaveQueueOptions = {},
  ) {
    this.retryMs = options.retryMs ?? 3000;
    this.schedule = options.schedule ?? ((fn, ms) => void setTimeout(fn, ms));
  }

  /** Sends one save after every earlier save of the same tile has settled. */
  save(request: SaveRequest): Promise<SaveResult> {
    const key = keyOf(request.mode, request.stem);
    const before = this.chains.get(key) ?? Promise.resolve();
    const next = before
      .catch(() => undefined)
      .then(() => this.send(request))
      .then((result) => {
        for (const l of this.saved) l(request, result);
        return result;
      });
    this.chains.set(key, next);
    const forget = (): void => {
      if (this.chains.get(key) === next) this.chains.delete(key);
    };
    next.then(forget, forget); // the caller handles the result; this only cleans up
    return next;
  }

  /** Keeps the edits of a tile you left and stores them in the background. */
  keepDraft(request: SaveRequest): void {
    this.drafts.set(keyOf(request.mode, request.stem), request);
    this.flush(keyOf(request.mode, request.stem));
  }

  /** The editor reopening a tile takes its unsaved draft back. */
  takeDraft(mode: LabelMode, stem: string): SaveRequest | undefined {
    const key = keyOf(mode, stem);
    const draft = this.drafts.get(key);
    this.drafts.delete(key);
    return draft;
  }

  /** Drafts not stored yet (the page warns before it is closed). */
  pending(): number {
    return this.drafts.size;
  }

  /** Called with every stored save, also of drafts whose editor is gone. */
  onSaved(listener: Listener): () => void {
    this.saved.add(listener);
    return () => this.saved.delete(listener);
  }

  /** Called when the server refuses a draft for good (400). */
  onDropped(listener: DropListener): () => void {
    this.dropped.add(listener);
    return () => this.dropped.delete(listener);
  }

  private flush(key: string): void {
    const draft = this.drafts.get(key);
    if (!draft) return;
    this.save(draft).then(
      () => {
        if (this.drafts.get(key) === draft) this.drafts.delete(key);
      },
      (error: unknown) => {
        if (this.drafts.get(key) !== draft) return; // replaced or taken back meanwhile
        const failure = failureOf(error);
        if (isTransient(failure)) {
          if (this.retrying.has(key)) return;
          this.retrying.add(key);
          this.schedule(() => {
            this.retrying.delete(key);
            this.flush(key);
          }, this.retryMs);
        } else if (failure === "rejected") {
          this.drafts.delete(key);
          for (const l of this.dropped) l(draft, error);
        }
        // "reload": kept; only a reload of the page can store it (and the page warns).
      },
    );
  }
}
