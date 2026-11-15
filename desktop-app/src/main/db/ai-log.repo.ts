import {
  AI_LOG_MAX_ENTRIES,
  AI_LOG_PAGE_SIZE,
  type AiLogDetail,
  type AiLogEntry,
  type AiLogPage,
  type AiLogStatus,
} from "@shared/ai-log";
import { getDb } from "./database";

/** AI record book persistence (see shared/ai-log.ts). */

export type NewAiLogEntry = Omit<AiLogDetail, "id">;

interface Row {
  id: number;
  at: string;
  feature: string;
  provider: string;
  model: string;
  endpoint_host: string;
  local: number;
  status: string;
  duration_ms: number;
  request_chars: number;
  response_chars: number;
  image_count: number;
  error: string | null;
  request?: string;
  response?: string;
}

const SUMMARY_COLUMNS =
  "id, at, feature, provider, model, endpoint_host, local, status, duration_ms, request_chars, response_chars, image_count, error";

function toEntry(row: Row): AiLogEntry {
  return {
    id: row.id,
    at: row.at,
    feature: row.feature,
    provider: row.provider,
    model: row.model,
    endpointHost: row.endpoint_host,
    local: row.local === 1,
    status: row.status as AiLogStatus,
    durationMs: row.duration_ms,
    requestChars: row.request_chars,
    responseChars: row.response_chars,
    imageCount: row.image_count,
    ...(row.error ? { error: row.error } : {}),
  };
}

/** Appends an entry and prunes everything beyond AI_LOG_MAX_ENTRIES. */
export function insertAiLogEntry(entry: NewAiLogEntry): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO ai_log (at, feature, provider, model, endpoint_host, local, status,
       duration_ms, request_chars, response_chars, image_count, error, request, response)
     VALUES (@at, @feature, @provider, @model, @endpointHost, @local, @status,
       @durationMs, @requestChars, @responseChars, @imageCount, @error, @request, @response)`,
  ).run({
    ...entry,
    local: entry.local ? 1 : 0,
    durationMs: Math.round(entry.durationMs),
    error: entry.error ?? null,
  });
  db.prepare(
    `DELETE FROM ai_log WHERE id NOT IN
       (SELECT id FROM ai_log ORDER BY id DESC LIMIT ?)`,
  ).run(AI_LOG_MAX_ENTRIES);
}

/** Newest first. */
export function listAiLog(offset = 0, limit = AI_LOG_PAGE_SIZE): AiLogPage {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT ${SUMMARY_COLUMNS} FROM ai_log ORDER BY id DESC LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as Row[];
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM ai_log").get() as {
    n: number;
  };
  return { entries: rows.map(toEntry), total: n };
}

export function getAiLogEntry(id: number): AiLogDetail | null {
  const row = getDb()
    .prepare(
      `SELECT ${SUMMARY_COLUMNS}, request, response FROM ai_log WHERE id = ?`,
    )
    .get(id) as Row | undefined;
  if (!row) return null;
  return {
    ...toEntry(row),
    request: row.request ?? "",
    response: row.response ?? "",
  };
}

/** Every stored entry with its texts, oldest first (export). */
export function allAiLogEntries(): AiLogDetail[] {
  const rows = getDb()
    .prepare(
      `SELECT ${SUMMARY_COLUMNS}, request, response FROM ai_log ORDER BY id ASC`,
    )
    .all() as Row[];
  return rows.map((row) => ({
    ...toEntry(row),
    request: row.request ?? "",
    response: row.response ?? "",
  }));
}

export function clearAiLog(): void {
  getDb().prepare("DELETE FROM ai_log").run();
}
