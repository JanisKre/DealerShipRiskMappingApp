import { randomUUID } from "crypto";
import type { AnalyzedDealership, Session } from "@shared/types";
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
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dealerships: JSON.parse(row.data) as AnalyzedDealership[],
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
      data: JSON.stringify(session.dealerships),
    });
}

export function deleteSession(id: string): void {
  getDb().prepare("DELETE FROM sessions WHERE id = ?").run(id);
}
