import { useAppStore } from "@renderer/store/appStore";
import { useMapStore } from "@renderer/store/mapStore";
import { LocationsPanel } from "@renderer/components/map/LocationsPanel";
import { usePortfolioImport } from "@renderer/components/upload/PortfolioImportDialog";

/**
 * Left-hand dock in the workspace: location list with quick-add (autocomplete)
 * and portfolio upload (CSV / Excel), both in the header of `LocationsPanel`.
 * Uploads go through the shared import dialog (target portfolio and
 * business type).
 */
export function AddressDock(): React.JSX.Element {
  const dealerships = useAppStore((s) => s.dealerships);
  const analyzingIds = useAppStore((s) => s.analyzingIds);
  const selectedId = useAppStore((s) => s.selectedId);
  const select = useAppStore((s) => s.select);
  const openDetailDialog = useMapStore((s) => s.openDetailDialog);
  const { startImport, dialog } = usePortfolioImport();

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
          onUploadFile={startImport}
        />
      </div>
      {dialog}
    </div>
  );
}
