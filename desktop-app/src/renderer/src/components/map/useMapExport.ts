import { useState } from "react";
import type { TFunction } from "i18next";
import { notify } from "@renderer/lib/notify";
import { exportLocale } from "@renderer/lib/format";

/** Exports the map as PNG or copies it to the clipboard. */
export function useMapExport(t: TFunction): {
  capturing: boolean;
  exportMap: (mode: "save" | "clipboard") => Promise<void>;
} {
  const [capturing, setCapturing] = useState(false);

  async function exportMap(mode: "save" | "clipboard"): Promise<void> {
    setCapturing(true);
    try {
      const el = document.querySelector(
        ".leaflet-container",
      ) as HTMLElement | null;
      let rect:
        { x: number; y: number; width: number; height: number } | undefined;
      if (el) {
        const r = el.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        rect = {
          x: Math.round(r.left * dpr),
          y: Math.round(r.top * dpr),
          width: Math.round(r.width * dpr),
          height: Math.round(r.height * dpr),
        };
      }
      const result = await window.api.captureMap(rect, mode, exportLocale());
      if (mode === "clipboard" && result.ok)
        notify.success(t("map.page.mapCopied"));
      else if (mode === "save" && result.path)
        notify.exported("map.page.mapSaved", result.path);
    } catch (error) {
      console.warn("Map capture failed:", error);
      notify.error(
        t(
          mode === "clipboard"
            ? "map.page.mapCopyFailed"
            : "map.page.mapSaveFailed",
        ),
      );
    } finally {
      setCapturing(false);
    }
  }

  return { capturing, exportMap };
}
