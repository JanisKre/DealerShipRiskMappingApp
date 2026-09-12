import { toast } from "sonner";
import type { DealershipInput } from "@shared/types";
import { useAppStore } from "@renderer/store/appStore";
import { useMapStore } from "@renderer/store/mapStore";
import { LocationsPanel } from "@renderer/components/map/LocationsPanel";

interface Props {
  /** Shared handler from WorkspacePage — delegates to addAndAnalyze. */
  onAddRows: (inputs: DealershipInput[]) => Promise<void>;
}

/**
 * Left-hand dock in the workspace: location list with quick-add (autocomplete)
 * and portfolio upload (CSV / Excel), both in the header of `LocationsPanel`.
 * Encapsulates the file import and delegates everything to `addAndAnalyze`
 * in the appStore.
 */
export function AddressDock({ onAddRows }: Readonly<Props>): React.JSX.Element {
  const dealerships = useAppStore((s) => s.dealerships);
  const analyzingIds = useAppStore((s) => s.analyzingIds);
  const selectedId = useAppStore((s) => s.selectedId);
  const select = useAppStore((s) => s.select);
  const openDetailDialog = useMapStore((s) => s.openDetailDialog);

  /** Read CSV/TSV/Excel and import as location rows (identical to StartPage). */
  async function handleUploadFile(file: File): Promise<void> {
    const isXlsx = /\.xlsx$/i.test(file.name);
    const parsed = isXlsx
      ? await window.api.parseXlsx(arrayBufferToBase64(await file.arrayBuffer()))
      : await window.api.parseCsv(await file.text());
    if (parsed.length === 0) {
      toast.warning("No rows found — columns: name, address, lat, lon, value.");
      return;
    }
    await onAddRows(parsed);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-hidden">
        <LocationsPanel
          variant="dock"
          dealerships={dealerships}
          selectedId={selectedId}
          analyzingIds={analyzingIds}
          onSelect={select}
          onOpenDetails={(id) => {
            select(id);
            openDetailDialog(id);
          }}
          onUploadFile={handleUploadFile}
        />
      </div>
    </div>
  );
}

/** ArrayBuffer -> base64 (for XLSX transport over IPC). */
function arrayBufferToBase64(buf: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
