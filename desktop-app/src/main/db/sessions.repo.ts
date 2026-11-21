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

/**
 * Portfolios in SQLite: one row per portfolio in `sessions` (name,
 * parameters, queue, location order) and one per location in
 * `session_sites`, so a save rewrites only what changed.
 */

export function listSessions(): Array<{
  id: string;
  name: string;
  updatedAt: string;
  snapshotOf?: string;
}> {
  const rows = getDb()
    .prepare(
      `SELECT id, name, updated_at as updatedAt,
              CASE WHEN json_valid(data)
                   THEN json_extract(data, '$.snapshotOf') END as snapshotOf
         FROM sessions ORDER BY updated_at DESC`,
    )
    .all() as Array<{
    id: string;
    name: string;
    updatedAt: string;
    snapshotOf: unknown;
  }>;
  return rows.map(({ snapshotOf, ...row }) =>
    typeof snapshotOf === "string" && snapshotOf.length > 0
      ? { ...row, snapshotOf }
      : row,
  );
}

export function loadSession(id: string): Session | null {
  const db = getDb();
  const row = db
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
  const inline = Array.isArray(stored) ? stored : stored.dealerships;
  const dealerships = (
    Array.isArray(inline)
      ? inline
      : storedSites(id, Array.isArray(stored) ? undefined : stored.order)
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
    ...(!Array.isArray(stored) &&
    typeof stored.parametersRevision === "number" &&
    Number.isInteger(stored.parametersRevision) &&
    stored.parametersRevision >= 0
      ? { parametersRevision: stored.parametersRevision }
      : {}),
    ...(!Array.isArray(stored) && stored.boundaryEdits
      ? { boundaryEdits: validBoundaryEdits(stored.boundaryEdits) }
      : {}),
    ...(!Array.isArray(stored) && stored.pendingAnalysis
      ? { pendingAnalysis: validPendingAnalysis(stored.pendingAnalysis) }
      : {}),
    ...(!Array.isArray(stored) && stored.pendingErrors
      ? { pendingErrors: validPendingErrors(stored.pendingErrors) }
      : {}),
    ...(!Array.isArray(stored) &&
    typeof stored.snapshotOf === "string" &&
    stored.snapshotOf.length > 0
      ? { snapshotOf: stored.snapshotOf }
      : {}),
  };
}

/**
 * The locations of a portfolio stored one per row, in the saved `order`;
 * rows the order does not name (it should name all) follow in insert
 * order. A row that no longer parses is skipped.
 */
function storedSites(sessionId: string, order: unknown): AnalyzedDealership[] {
  const rows = getDb()
    .prepare(
      "SELECT site_id, data FROM session_sites WHERE session_id = ? ORDER BY rowid",
    )
    .all(sessionId) as Array<{ site_id: string; data: string }>;
  const byId = new Map<string, AnalyzedDealership>();
  for (const row of rows) {
    try {
      byId.set(row.site_id, JSON.parse(row.data) as AnalyzedDealership);
    } catch {
      // A damaged row loses that location, not the portfolio.
    }
  }
  const out: AnalyzedDealership[] = [];
  if (Array.isArray(order)) {
    for (const id of order) {
      const site = typeof id === "string" ? byId.get(id) : undefined;
      if (!site) continue;
      out.push(site);
      byId.delete(id as string);
    }
  }
  return [...out, ...byId.values()];
}

/** All JSON rows of a portfolio's locations (portfolio index). */
export function storedSiteRows(sessionId: string): string[] {
  return (
    getDb()
      .prepare("SELECT data FROM session_sites WHERE session_id = ?")
      .all(sessionId) as Array<{ data: string }>
  ).map((row) => row.data);
}

interface StoredEnvelope {
  dealerships?: AnalyzedDealership[];
  order?: unknown;
  parameters?: RiskParameters;
  parametersRevision?: unknown;
  boundaryEdits?: unknown;
  pendingAnalysis?: unknown;
  pendingErrors?: unknown;
  snapshotOf?: unknown;
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

/** A session without its locations: what a save of changes carries. */
export type SessionMeta = Omit<Session, "dealerships">;

export type SaveChangesResult = { ok: true; revision: number } | { ok: false };

export interface SessionChanges {
  session: SessionMeta;
  /** The revision the renderer last saved; a newer one rejects the save. */
  baseRevision: number;
  /** Ids of all locations, in list order. */
  order: string[];
  /** Locations added or changed since `baseRevision`. */
  upserts: AnalyzedDealership[];
  /** Ids of locations removed since `baseRevision`. */
  removed: string[];
}

/** Writes the whole portfolio. Returns the new revision. */
export function saveSession(session: Session): { revision: number } {
  const db = getDb();
  const ids = session.dealerships.map((d) => d.id);
  const uniqueIds = new Set(ids).size === ids.length;
  return db.transaction(() => {
    const revision = writeSessionRow(
      session,
      // Locations without unique ids cannot be rows; they stay inline.
      uniqueIds ? { order: ids } : { dealerships: session.dealerships },
    );
    if (!uniqueIds) {
      db.prepare("DELETE FROM session_sites WHERE session_id = ?").run(
        session.id,
      );
      return { revision };
    }
    const keep = new Set(ids);
    const remove = db.prepare(
      "DELETE FROM session_sites WHERE session_id = ? AND site_id = ?",
    );
    for (const stored of storedSiteIds(session.id)) {
      if (!keep.has(stored)) remove.run(session.id, stored);
    }
    upsertSites(session.id, session.dealerships);
    return { revision };
  })();
}

/**
 * Writes only what changed since the renderer's last save. Refused (and
 * nothing written) when another save came in between, the stored portfolio
 * keeps its locations inline, or the changes do not add up to `order`; the
 * renderer then saves the whole portfolio.
 */
export function saveSessionChanges(changes: SessionChanges): SaveChangesResult {
  const db = getDb();
  return db.transaction((): SaveChangesResult => {
    const row = db
      .prepare("SELECT revision, data FROM sessions WHERE id = ?")
      .get(changes.session.id) as
      { revision: number; data: string } | undefined;
    if (!row || row.revision !== changes.baseRevision) return { ok: false };
    if (storesSitesInline(row.data)) return { ok: false };

    const order = new Set(changes.order);
    if (order.size !== changes.order.length) return { ok: false };
    const after = new Set(storedSiteIds(changes.session.id));
    for (const id of changes.removed) after.delete(id);
    for (const site of changes.upserts) after.add(site.id);
    if (after.size !== order.size || [...after].some((id) => !order.has(id))) {
      return { ok: false };
    }

    const revision = writeSessionRow(changes.session, { order: changes.order });
    const remove = db.prepare(
      "DELETE FROM session_sites WHERE session_id = ? AND site_id = ?",
    );
    for (const id of changes.removed) remove.run(changes.session.id, id);
    upsertSites(changes.session.id, changes.upserts);
    return { ok: true, revision };
  })();
}

function storesSitesInline(data: string): boolean {
  try {
    const stored = JSON.parse(data) as unknown;
    return (
      Array.isArray(stored) ||
      Array.isArray((stored as { dealerships?: unknown } | null)?.dealerships)
    );
  } catch {
    return true;
  }
}

function storedSiteIds(sessionId: string): string[] {
  return (
    getDb()
      .prepare("SELECT site_id FROM session_sites WHERE session_id = ?")
      .all(sessionId) as Array<{ site_id: string }>
  ).map((row) => row.site_id);
}

/** Rewrites a location only when its JSON changed. */
function upsertSites(sessionId: string, sites: AnalyzedDealership[]): void {
  const upsert = getDb().prepare(
    `INSERT INTO session_sites (session_id, site_id, data) VALUES (?, ?, ?)
     ON CONFLICT (session_id, site_id) DO UPDATE SET data = excluded.data
       WHERE session_sites.data <> excluded.data`,
  );
  for (const site of sites)
    upsert.run(sessionId, site.id, JSON.stringify(site));
}

/** Writes the portfolio row with everything but the locations. */
function writeSessionRow(
  session: SessionMeta,
  sites: { order: string[] } | { dealerships: AnalyzedDealership[] },
): number {
  const now = new Date().toISOString();
  const row = getDb()
    .prepare(
      `INSERT INTO sessions (id, name, created_at, updated_at, data, revision)
       VALUES (@id, @name, @createdAt, @updatedAt, @data, 1)
       ON CONFLICT(id) DO UPDATE SET
         name = @name, updated_at = @updatedAt, data = @data,
         revision = sessions.revision + 1
       RETURNING revision`,
    )
    .get({
      id: session.id,
      name: session.name,
      createdAt: session.createdAt || now,
      updatedAt: now,
      // Envelope format keeps session-scoped parameters together with the
      // portfolio while the loader above remains compatible with old arrays.
      data: JSON.stringify({
        ...sites,
        parameters: session.parameters,
        // Which defaults the parameters were saved under (see
        // PARAMETERS_REVISION): without it they are migrated on load.
        ...(session.parametersRevision != null
          ? { parametersRevision: session.parametersRevision }
          : {}),
        ...(session.boundaryEdits &&
        Object.keys(session.boundaryEdits).length > 0
          ? { boundaryEdits: session.boundaryEdits }
          : {}),
        // Inputs of an analysis cut short (app closed or crashed), so it can
        // be resumed after a restart.
        ...(session.pendingAnalysis && session.pendingAnalysis.length > 0
          ? { pendingAnalysis: session.pendingAnalysis }
          : {}),
        ...(session.pendingErrors &&
        Object.keys(session.pendingErrors).length > 0
          ? { pendingErrors: session.pendingErrors }
          : {}),
        ...(session.snapshotOf ? { snapshotOf: session.snapshotOf } : {}),
      }),
    }) as { revision: number };
  return row.revision;
}

export function deleteSession(id: string): void {
  getDb().prepare("DELETE FROM sessions WHERE id = ?").run(id);
}

/** Stored reasons of failed queued inputs; anything else is dropped. */
function validPendingErrors(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [id, message] of Object.entries(value))
    if (typeof message === "string" && id.length <= 200)
      out[id] = message.slice(0, 500);
  return out;
}
