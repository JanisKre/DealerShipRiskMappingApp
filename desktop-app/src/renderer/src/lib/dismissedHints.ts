import { useCallback, useEffect, useState } from "react";

/**
 * "Hinweis ausblenden" for the passive map hints, remembered per portfolio
 * and reason in local storage (a per-viewer convenience): the hints came
 * back after zooming or a restart (UW-14). Storage may be unavailable; the
 * hint then simply shows again.
 */
const PREFIX = "drm-dismissed-hint";

export function dismissedHintKey(
  sessionId: string | null,
  reason: string,
): string {
  return `${PREFIX}:${sessionId ?? "unsaved"}:${reason}`;
}

export function readDismissed(key: string): boolean {
  try {
    return globalThis.localStorage?.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function writeDismissed(key: string, dismissed: boolean): void {
  try {
    if (dismissed) globalThis.localStorage?.setItem(key, "1");
    else globalThis.localStorage?.removeItem(key);
  } catch {
    // Not remembered; the hint shows again next time.
  }
}

export function useDismissedHint(
  sessionId: string | null,
  reason: string,
): [boolean, (dismissed: boolean) => void] {
  const key = dismissedHintKey(sessionId, reason);
  const [dismissed, setDismissedState] = useState(() => readDismissed(key));
  useEffect(() => setDismissedState(readDismissed(key)), [key]);
  const setDismissed = useCallback(
    (next: boolean) => {
      writeDismissed(key, next);
      setDismissedState(next);
    },
    [key],
  );
  return [dismissed, setDismissed];
}
