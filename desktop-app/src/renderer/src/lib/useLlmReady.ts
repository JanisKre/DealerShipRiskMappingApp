import { useEffect, useState } from "react";
import { isLlmConfigured } from "@shared/llm-config";

/**
 * Whether an AI provider is set up. `null` while the settings are loading, so
 * callers do not flash the setup prompt. Read once on mount: the AI settings
 * live on their own route, so every AI surface remounts after a change.
 */
export function useLlmReady(): boolean | null {
  const [ready, setReady] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.api
      .getSettings()
      .then((s) => {
        if (!cancelled) setReady(isLlmConfigured(s.llm));
      })
      .catch(() => {
        // Settings not loadable → let the request report the actual error.
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return ready;
}
