import { toast, type ExternalToast } from "sonner";
import i18n from "@renderer/i18n";

/**
 * The one way the app answers an action with a transient message.
 *
 * Rules, so every message reads the same:
 * - The title says what happened in one short sentence, in the UI language.
 *   Detail (a file name, a count, the technical reason) is the description.
 * - `success` confirms a finished action, `info` explains why nothing
 *   happened, `warning` reports a result with a catch, `error` a failure.
 * - A failure names what failed in the title and the reason underneath
 *   (`cause`), never a bare exception text alone.
 * - Errors and warnings stay longer than confirmations; a toast with an
 *   action stays long enough to use it. Every toast can be closed.
 * - The same message twice replaces the first instead of stacking.
 * - Work that takes a while starts with `progress` and ends by passing its
 *   id to `success`/`error`, so one toast follows the whole step.
 *
 * Lasting states (a running analysis, data that needs a check) are not
 * toasts: they are inline notices (`Alert` in components/ui/alert.tsx).
 */

type Kind = "success" | "info" | "warning" | "error";

export interface NotifyOptions {
  /** Second line: detail to the title. */
  description?: string;
  /** One follow-up step, e.g. "Undo" or "Show in folder". */
  action?: { label: string; onClick: () => void };
  /** Replaces the toast with this id (a `progress` toast, a repeated one). */
  id?: string | number;
  /** Stays this long (ms) instead of the kind's time; rarely needed. */
  duration?: number;
}

export interface NotifyErrorOptions extends NotifyOptions {
  /** The caught error; its message becomes the description. */
  cause?: unknown;
}

/** How long each kind stays, in ms. */
export const NOTIFY_DURATION: Record<Kind, number> = {
  success: 4_000,
  info: 6_000,
  warning: 8_000,
  error: 10_000,
};
/** A toast with an action stays at least this long. */
export const NOTIFY_ACTION_DURATION = 8_000;

/**
 * The readable reason of a caught error: its message without Electron's
 * "Error invoking remote method '…': Error: " prefix; empty when there is
 * none.
 */
export function errorReason(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return message
    .replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, "")
    .trim();
}

/** sonner's options for a toast of `kind`; exported for the tests. */
export function toastOptions(
  kind: Kind,
  title: string,
  options: NotifyErrorOptions = {},
): ExternalToast {
  const reason = options.cause === undefined ? "" : errorReason(options.cause);
  const description =
    options.description ?? (reason && reason !== title ? reason : undefined);
  const base = NOTIFY_DURATION[kind];
  return {
    id: options.id ?? `${kind}:${title}`,
    description,
    duration:
      options.duration ??
      (options.action ? Math.max(base, NOTIFY_ACTION_DURATION) : base),
    action: options.action,
  };
}

function show(kind: Kind, title: string, options?: NotifyErrorOptions): void {
  toast[kind](title, toastOptions(kind, title, options));
}

/** File name of a path (either separator). */
export function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export const notify = {
  /** A finished action. */
  success: (title: string, options?: NotifyOptions): void =>
    show("success", title, options),
  /** Why nothing happened, or what the app did on its own. */
  info: (title: string, options?: NotifyOptions): void =>
    show("info", title, options),
  /** A result with a catch the user should know about. */
  warning: (title: string, options?: NotifyOptions): void =>
    show("warning", title, options),
  /** A failure: `title` says what failed, `cause` why. */
  error: (title: string, options?: NotifyErrorOptions): void =>
    show("error", title, options),
  /** A failure with nothing more specific to say than the error itself. */
  failed: (cause: unknown, title?: string): void =>
    show("error", title ?? i18n.t("common.operationFailed"), { cause }),

  /**
   * A step that takes a while. Returns the id to pass to `progress` again
   * (new text) and to `success`/`error`/`dismiss` when it ends.
   */
  progress: (title: string, options: NotifyOptions = {}): string | number => {
    const id = options.id ?? `progress:${title}`;
    toast.loading(title, {
      id,
      description: options.description,
      action: options.action,
      duration: Infinity,
    });
    return id;
  },
  dismiss: (id: string | number): void => {
    toast.dismiss(id);
  },

  /**
   * Copies `text` and confirms it with `done`, or says why it could not.
   * Through the main process: navigator.clipboard is unavailable because
   * the app denies all renderer permission requests.
   */
  copy: async (text: string, done: string): Promise<void> => {
    try {
      await window.api.writeClipboardText(text);
      show("success", done);
    } catch (error) {
      show("error", i18n.t("common.copyFailed"), { cause: error });
    }
  },

  /**
   * A written file: `key` is a translation with `{{name}}`, shown with the
   * file name only (not the whole path) and "Show in folder".
   */
  exported: (key: string, path: string): void =>
    show("success", i18n.t(key, { name: fileNameOf(path) }), {
      action: {
        label: i18n.t("ui.showInFolder"),
        onClick: () => {
          void window.api.showExportedFile(path).catch(() => undefined);
        },
      },
    }),
};
