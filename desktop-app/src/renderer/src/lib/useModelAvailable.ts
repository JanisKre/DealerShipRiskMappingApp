import { useEffect, useState } from "react";

/**
 * Whether the vehicle detection model is installed: `null` while unknown.
 * Checked again when the window regains focus, so a model installed in the
 * settings (or copied into the folder) is noticed without a restart.
 */
export function useModelAvailable(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    const check = (): void => {
      void window.api
        .modelStatus()
        .then((status) => {
          if (!cancelled) setAvailable(status.available);
        })
        .catch(() => undefined);
    };
    check();
    window.addEventListener("focus", check);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", check);
    };
  }, []);
  return available;
}
