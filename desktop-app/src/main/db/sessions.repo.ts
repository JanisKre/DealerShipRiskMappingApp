import { randomUUID } from "crypto";
import type {
  AnalyzedDealership,
  RiskParameters,
  Session,
} from "@shared/types";
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
  let stored:
    | AnalyzedDealership[]
    | { dealerships?: AnalyzedDealership[]; parameters?: RiskParameters };
  try {
    stored = JSON.parse(row.data) as
      | AnalyzedDealership[]
      | { dealerships?: AnalyzedDealership[]; parameters?: RiskParameters };
  } catch {
    return null;
  }
  const dealerships = Array.isArray(stored)
    ? stored
    : (stored.dealerships ?? []);
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dealerships,
    ...(!Array.isArray(stored) && stored.parameters
      ? { parameters: stored.parameters }
      : {}),
  };
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
      }),
    });
}

export function deleteSession(id: string): void {
  getDb().prepare("DELETE FROM sessions WHERE id = ?").run(id);
}
