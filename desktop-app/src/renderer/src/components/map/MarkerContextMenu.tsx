import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  // Near the right or bottom edge the menu opened outside the window and no
  // entry could be reached: keep it inside once its size is known.
  const [position, setPosition] = useState({ left: state.x, top: state.y });
  useLayoutEffect(() => {
    const box = menuRef.current?.getBoundingClientRect();
    const margin = 8;
    setPosition({
      left: Math.max(
        margin,
        Math.min(state.x, window.innerWidth - (box?.width ?? 0) - margin),
      ),
      top: Math.max(
        margin,
        Math.min(state.y, window.innerHeight - (box?.height ?? 0) - margin),
      ),
    });
    // Keyboard: the menu takes the focus, so arrow keys no longer reach the
    // map behind it.
    menuRef.current?.querySelector<HTMLElement>("button")?.focus();
  }, [state.x, state.y]);
  useEffect(() => {
    function onDocMouseDown(e: MouseEvent): void {
      // A press inside the menu belongs to its buttons.
      if (menuRef.current?.contains(e.target as Node)) return;
      onClose();
    }
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      // Up and down move between the entries.
      const items = [
        ...(menuRef.current?.querySelectorAll<HTMLElement>("button") ?? []),
      ];
      if (items.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      const at = items.indexOf(document.activeElement as HTMLElement);
      const step = e.key === "ArrowDown" ? 1 : -1;
      items[(at + step + items.length) % items.length].focus();
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
      // The look of the app's DropdownMenu (ui/dropdown-menu.tsx).
      role="menu"
      aria-label={state.dealership.name}
      className="fixed z-[2000] min-w-40 max-w-64 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0"
      ref={menuRef}
      style={position}
    >
      <p
        className="truncate px-2 py-1.5 text-xs font-medium text-muted-foreground"
        title={state.dealership.name}
      >
        {state.dealership.name}
      </p>
      <button
        type="button"
        role="menuitem"
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
        role="menuitem"
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
        role="menuitem"
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
  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground";
