import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Info, RefreshCw, Trash2 } from "lucide-react";
import type { AnalyzedDealership } from "@shared/types";
import { cn } from "@renderer/lib/utils";

export interface ContextMenuState {
  dealership: AnalyzedDealership;
  x: number;
  y: number;
}

/** Right-click context menu for a marker: details, reanalyze or delete. */
export function MarkerContextMenu({
  state,
  onClose,
  onDetails,
  onReanalyze,
  onDelete,
}: Readonly<{
  state: ContextMenuState;
  onClose: () => void;
  onDetails: (id: string) => void;
  onReanalyze: (id: string) => void;
  onDelete: (id: string) => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDocMouseDown(e: MouseEvent): void {
      // A press inside the menu belongs to its buttons.
      if (menuRef.current?.contains(e.target as Node)) return;
      onClose();
    }
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="fixed z-[2000] min-w-40 max-w-64 overflow-hidden rounded-md border bg-popover py-1 text-popover-foreground shadow-lg"
      ref={menuRef}
      style={{ left: state.x, top: state.y }}
    >
      <p
        className="truncate px-3 py-1 text-xs font-medium text-muted-foreground"
        title={state.dealership.name}
      >
        {state.dealership.name}
      </p>
      <button
        type="button"
        className={MENU_ITEM_CLASS}
        onClick={() => {
          onDetails(state.dealership.id);
          onClose();
        }}
      >
        <Info className="size-3.5" />
        {t("map.page.details")}
      </button>
      <button
        type="button"
        className={MENU_ITEM_CLASS}
        onClick={() => {
          onReanalyze(state.dealership.id);
          onClose();
        }}
      >
        <RefreshCw className="size-3.5" />
        {t("map.page.reanalyze")}
      </button>
      <button
        type="button"
        className={cn(
          MENU_ITEM_CLASS,
          "text-destructive hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10",
        )}
        onClick={() => {
          onDelete(state.dealership.id);
          onClose();
        }}
      >
        <Trash2 className="size-3.5" />
        {t("map.page.delete")}
      </button>
    </div>
  );
}

const MENU_ITEM_CLASS =
  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-none";
