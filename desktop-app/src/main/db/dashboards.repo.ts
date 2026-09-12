import { randomUUID } from "crypto";
import type { Dashboard, DashboardSpec } from "@shared/types";
import { getDb } from "../db/database";

/**
 * KI-Dashboard-Persistenz in SQLite. `prompt` + `spec` liegen zusammen als
 * JSON-Blob in der Spalte `data` (Struktur analog conversations.repo).
 */

export function listDashboards(): Array<{
  id: string;
  name: string;
  updatedAt: string;
}> {
  return getDb()
    .prepare(
      "SELECT id, name, updated_at as updatedAt FROM dashboards ORDER BY updated_at DESC",
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
  const { prompt, spec } = JSON.parse(row.data) as {
    prompt: string;
    spec: DashboardSpec;
  };
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    prompt,
    spec,
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
      data: JSON.stringify({ prompt: dashboard.prompt, spec: dashboard.spec }),
    });
}

export function deleteDashboard(id: string): void {
  getDb().prepare("DELETE FROM dashboards WHERE id = ?").run(id);
}
