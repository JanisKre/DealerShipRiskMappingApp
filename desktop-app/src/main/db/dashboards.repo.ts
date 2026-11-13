import { randomUUID } from "crypto";
import { A2uiSurfaceSchema, type A2uiSurface } from "@shared/a2ui";
import type { Dashboard } from "@shared/types";
import { getDb } from "../db/database";

/**
 * AI dashboards in SQLite. `prompt` and the A2UI `surface` are stored
 * together as a JSON blob in `data` (structure as in conversations.repo).
 * Rows from the earlier widget-spec format have no surface and are skipped.
 */

export function listDashboards(): Array<{
  id: string;
  name: string;
  updatedAt: string;
}> {
  return getDb()
    .prepare(
      `SELECT id, name, updated_at as updatedAt FROM dashboards
       WHERE json_extract(data, '$.surface') IS NOT NULL
       ORDER BY updated_at DESC`,
    )
    .all() as Array<{ id: string; name: string; updatedAt: string }>;
}

export function loadDashboard(id: string): Dashboard | null {
  const row = getDb()
    .prepare(
      "SELECT id, name, created_at, updated_at, data FROM dashboards WHERE id = ?",
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
  let stored: { prompt?: unknown; surface?: unknown };
  try {
    stored = JSON.parse(row.data) as { prompt?: unknown; surface?: unknown };
  } catch {
    return null;
  }
  const surface = A2uiSurfaceSchema.safeParse(stored.surface);
  if (!surface.success) return null;
  const prompt = typeof stored.prompt === "string" ? stored.prompt : "";
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    prompt,
    surface: surface.data satisfies A2uiSurface,
  };
}

export function saveDashboard(dashboard: Dashboard): void {
  const now = new Date().toISOString();
  const id = dashboard.id || randomUUID();
  getDb()
    .prepare(
      `INSERT INTO dashboards (id, name, created_at, updated_at, data)
       VALUES (@id, @name, @createdAt, @updatedAt, @data)
       ON CONFLICT(id) DO UPDATE SET
         name = @name, updated_at = @updatedAt, data = @data`,
    )
    .run({
      id,
      name: dashboard.name,
      createdAt: dashboard.createdAt || now,
      updatedAt: now,
      data: JSON.stringify({
        prompt: dashboard.prompt,
        surface: dashboard.surface,
      }),
    });
}

export function deleteDashboard(id: string): void {
  getDb().prepare("DELETE FROM dashboards WHERE id = ?").run(id);
}
