/** A saved portfolio as listed by `sessions:list`. */
export interface SessionSummary {
  id: string;
  name: string;
  updatedAt: string;
  /** Set on a saved state: the portfolio it was taken from. */
  snapshotOf?: string;
}

/** Whether a listed session is a saved state ("Stand"), not a portfolio. */
export function isSnapshot(session: SessionSummary): boolean {
  return session.snapshotOf != null;
}

/**
 * The portfolio to open at start-up or after deleting the active one: the
 * most recent live portfolio (the list is sorted most recent first). A
 * saved state is never picked, even when it is the newest entry (UW-09).
 */
export function pickActiveSession<T extends SessionSummary>(
  sessions: readonly T[],
  excludeId?: string,
): T | undefined {
  return sessions.find((s) => !isSnapshot(s) && s.id !== excludeId);
}

/** Live portfolios first, then saved states, each most recent first. */
export function groupSessions<T extends SessionSummary>(
  sessions: readonly T[],
): { portfolios: T[]; snapshots: T[] } {
  return {
    portfolios: sessions.filter((s) => !isSnapshot(s)),
    snapshots: sessions.filter(isSnapshot),
  };
}
