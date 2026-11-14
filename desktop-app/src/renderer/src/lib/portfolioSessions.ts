/** A saved portfolio as listed by `sessions:list`. */
export interface SessionSummary {
  id: string;
  name: string;
  updatedAt: string;
  /** Set on a saved state: the portfolio it was taken from. */
  snapshotOf?: string;
}

/**
 * Saved states made before the `snapshotOf` flag existed carry only their
 * name: "<portfolio> – Stand <date>" (de), "– snapshot" (en), "– état du"
 * (fr). One counts as a saved state when a portfolio with exactly that
 * prefix exists next to it.
 */
const LEGACY_SNAPSHOT_NAME = /^(.+) – (?:Stand|snapshot|état du) \d.*$/u;

/** Whether a listed session is a saved state ("Stand"), not a portfolio. */
export function isSnapshot(
  session: SessionSummary,
  all: readonly SessionSummary[] = [],
): boolean {
  if (session.snapshotOf != null) return true;
  const prefix = LEGACY_SNAPSHOT_NAME.exec(session.name)?.[1];
  return (
    prefix != null && all.some((s) => s.id !== session.id && s.name === prefix)
  );
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
  return sessions.find((s) => !isSnapshot(s, sessions) && s.id !== excludeId);
}

/** Live portfolios first, then saved states, each most recent first. */
export function groupSessions<T extends SessionSummary>(
  sessions: readonly T[],
): { portfolios: T[]; snapshots: T[] } {
  return {
    portfolios: sessions.filter((s) => !isSnapshot(s, sessions)),
    snapshots: sessions.filter((s) => isSnapshot(s, sessions)),
  };
}
