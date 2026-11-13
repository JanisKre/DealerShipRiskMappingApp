import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { format } from "node:util";

/**
 * Local log file for support cases. The main process' console output also
 * goes to `<userData>/logs/main.log`; at `maxBytes` the file is rotated to
 * `main.1.log`, so at most twice that size is kept. Nothing leaves the
 * machine unless the user exports a diagnostics report and passes it on.
 *
 * Secrets are masked before a line is written, because errors from provider
 * APIs can echo request headers or URLs.
 */

export const LOG_FILE_NAME = "main.log";
export const ROTATED_LOG_FILE_NAME = "main.1.log";
const DEFAULT_MAX_LOG_BYTES = 2 * 1024 * 1024;

export type LogLevel = "debug" | "info" | "warn" | "error";

const SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // Anthropic / OpenAI style keys and Hugging Face tokens.
  [/\bsk-(?:ant-)?[A-Za-z0-9_-]{8,}/g, "[redacted-key]"],
  [/\bhf_[A-Za-z0-9]{8,}/g, "[redacted-key]"],
  // Authorization headers.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{4,}/gi, "$1 [redacted]"],
  // Header or JSON fields that carry a credential.
  [
    /(\b(?:x-api-key|api[_-]?key|authorization|password|secret|token)["']?\s*[:=]\s*["']?)[^"'\s,&}]+/gi,
    "$1[redacted]",
  ],
  // Credentials embedded in a URL.
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi, "$1[redacted]@"],
];

/** Masks API keys, tokens and URL credentials in a log line. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

export class FileLogger {
  readonly path: string;
  private readonly rotatedPath: string;

  constructor(
    private readonly dir: string,
    private readonly maxBytes = DEFAULT_MAX_LOG_BYTES,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.path = join(dir, LOG_FILE_NAME);
    this.rotatedPath = join(dir, ROTATED_LOG_FILE_NAME);
  }

  write(level: LogLevel, args: readonly unknown[]): void {
    const line = `${this.now().toISOString()} [${level}] ${redactSecrets(
      format(...args),
    )}\n`;
    try {
      mkdirSync(this.dir, { recursive: true });
      if (
        existsSync(this.path) &&
        statSync(this.path).size + Buffer.byteLength(line) > this.maxBytes
      ) {
        renameSync(this.path, this.rotatedPath);
      }
      appendFileSync(this.path, line, "utf-8");
    } catch {
      // Logging must never take the app down (full disk, removed folder).
    }
  }

  /** The newest `maxBytes` of the log, the rotated file included. */
  tail(maxBytes: number): string {
    const parts = [this.rotatedPath, this.path]
      .filter((file) => existsSync(file))
      .map((file) => readFileSync(file, "utf-8"));
    const text = parts.join("");
    if (Buffer.byteLength(text) <= maxBytes) return text;
    const cut = Buffer.from(text).subarray(-maxBytes).toString("utf-8");
    // Start at a full line rather than in the middle of one.
    const firstBreak = cut.indexOf("\n");
    return firstBreak >= 0 ? cut.slice(firstBreak + 1) : cut;
  }
}

let activeLogger: FileLogger | null = null;

const CONSOLE_LEVELS = {
  debug: "debug",
  log: "info",
  info: "info",
  warn: "warn",
  error: "error",
} as const satisfies Record<string, LogLevel>;

/**
 * Mirrors `console.*` of this process into a log file in `dir`. Calling it
 * again (for example after the data folder was reset) switches the file.
 */
export function installFileLogging(dir: string): FileLogger {
  const logger = new FileLogger(dir);
  const firstInstall = activeLogger === null;
  activeLogger = logger;
  if (firstInstall) {
    for (const [method, level] of Object.entries(CONSOLE_LEVELS)) {
      const key = method as keyof typeof CONSOLE_LEVELS;
      const original = console[key].bind(console);
      console[key] = (...args: unknown[]): void => {
        original(...args);
        activeLogger?.write(level, args);
      };
    }
  }
  return logger;
}

/** Writes one line to the log file without echoing it to the console. */
export function logToFile(level: LogLevel, ...args: unknown[]): void {
  activeLogger?.write(level, args);
}

/** The newest part of the log file, or "" before logging was installed. */
export function readRecentLog(maxBytes: number): string {
  return activeLogger?.tail(maxBytes) ?? "";
}
