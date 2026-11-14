import type { TFunction } from "i18next";
import { toast } from "sonner";

/** File name of a path (either separator), for short export toasts. */
export function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/**
 * Success toast for a written file: the file name only (not a seven-line
 * path over the toolbar), a close button and "Im Ordner zeigen" (UW-10).
 */
export function toastExported(t: TFunction, key: string, path: string): void {
  toast.success(t(key, { name: fileNameOf(path) }), {
    closeButton: true,
    action: {
      label: t("ui.showInFolder"),
      onClick: () => {
        void window.api.showExportedFile(path).catch(() => undefined);
      },
    },
  });
}
