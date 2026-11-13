import { randomUUID } from "crypto";
import {
  BoundaryEditStateSchema,
  DealershipInputSchema,
  type AnalyzedDealership,
  type BoundaryEditState,
  type DealershipInput,
  type RiskParameters,
  type Session,
} from "@shared/types";
import { stripRetiredPerils } from "@shared/retired-perils";
import { getDb } from "../db/database";

/** Session-Persistenz in SQLite. Dealerships werden als JSON-Blob abgelegt. */

export function listSessions(): Array<{
  id: string;
  name: string;
  updatedAt: string;
}> {
  return getDb()
    .prepare(
      "SELECT id, name, updated_at as updatedAt FROM sessions ORDER BY updated_at DESC",
    )
    .all() as Array<{ id: string; name: string; updatedAt: string }>;
}

export function loadSession(id: string): Session | null {
  const row = getDb()
    .prepare(
      "SELECT id, name, created_at, updated_at, data FROM sessions WHERE id = ?",
    )
    .get(id) as
    | {
        id: string;
        name: string;
        created_at: string;
        updated_at: string;
        data: string;
      }
    | undefined;
  if (!row) return null;
  let stored: AnalyzedDealership[] | StoredEnvelope;
  try {
    stored = JSON.parse(row.data) as AnalyzedDealership[] | StoredEnvelope;
  } catch {
    return null;
  }
  // `null` or a scalar in the column (damaged or hand-edited row).
  if (typeof stored !== "object" || stored === null) return null;
  const dealerships = (
    Array.isArray(stored) ? stored : (stored.dealerships ?? [])
  ).map(stripRetiredPerils);
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dealerships,
    ...(!Array.isArray(stored) && stored.parameters
      ? { parameters: stored.parameters }
      : {}),
    ...(!Array.isArray(stored) && stored.boundaryEdits
      ? { boundaryEdits: validBoundaryEdits(stored.boundaryEdits) }
      : {}),
    ...(!Array.isArray(stored) && stored.pendingAnalysis
      ? { pendingAnalysis: validPendingAnalysis(stored.pendingAnalysis) }
      : {}),
  };
}

interface StoredEnvelope {
  dealerships?: AnalyzedDealership[];
  parameters?: RiskParameters;
  boundaryEdits?: unknown;
  pendingAnalysis?: unknown;
}

/**
 * The inputs of an analysis that had not finished. An entry that no longer
 * parses is dropped: the location then simply is not offered for resuming.
 */
export function validPendingAnalysis(value: unknown): DealershipInput[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const parsed = DealershipInputSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * Undo steps are a convenience: an entry that no longer parses (older
 * schema, hand-edited file) is dropped instead of failing the whole load.
 */
export function validBoundaryEdits(
  value: unknown,
): Record<string, BoundaryEditState> {
  if (typeof value !== "object" || value === null) return {};
  const edits: Record<string, BoundaryEditState> = {};
  for (const [id, entry] of Object.entries(value)) {
    const parsed = BoundaryEditStateSchema.safeParse(entry);
    if (parsed.success) edits[id] = parsed.data;
  }
  return edits;
}

export function saveSession(session: Session): void {
  const now = new Date().toISOString();
  const id = session.id || randomUUID();
  getDb()
    .prepare(
      `INSERT INTO sessions (id, name, created_at, updated_at, data)
       VALUES (@id, @name, @createdAt, @updatedAt, @data)
       ON CONFLICT(id) DO UPDATE SET
         name = @name, updated_at = @updatedAt, data = @data`,
    )
    .run({
      id,
      name: session.name,
      createdAt: session.createdAt || now,
      updatedAt: now,
      // Envelope format keeps session-scoped parameters together with the
      // portfolio while the loader above remains compatible with old arrays.
      data: JSON.stringify({
        dealerships: session.dealerships,
        parameters: session.parameters,
        ...(session.boundaryEdits &&
        Object.keys(session.boundaryEdits).length > 0
          ? { boundaryEdits: session.boundaryEdits }
          : {}),
        // Inputs of an analysis cut short (app closed or crashed), so it can
        // be resumed after a restart.
        ...(session.pendingAnalysis && session.pendingAnalysis.length > 0
          ? { pendingAnalysis: session.pendingAnalysis }
          : {}),
      }),
    });
}

export function deleteSession(id: string): void {
  getDb().prepare("DELETE FROM sessions WHERE id = ?").run(id);
}
