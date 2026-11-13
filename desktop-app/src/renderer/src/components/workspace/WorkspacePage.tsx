import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@renderer/store/appStore";
import { WIDE_WINDOW_PX, useMapStore } from "@renderer/store/mapStore";
import { usePanelRef, useDefaultLayout } from "react-resizable-panels";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@renderer/components/ui/resizable";
import { DealershipDetailDialog } from "@renderer/components/dashboard/DealershipDetailDialog";
import { AddressDock } from "./AddressDock";
import { ChatPanel } from "./ChatPanel";
import { MapPage } from "@renderer/components/map/MapPage";

/** The narrow-window default applies once per app start, not on every visit. */
let narrowDefaultApplied = false;

/** Panel IDs for width persistence. */
const LEFT_ID = "drm-ws-left";
const CENTER_ID = "drm-ws-center";
const RIGHT_ID = "drm-ws-right";

/**
 * VS Code-style workspace (index route `/`):
 *
 *   [Address dock | Map | Chat dock]
 *
 * Both docks are collapsible (imperatively via `panelRef` + mapStore flags).
 * Panel widths are persisted in localStorage via `useDefaultLayout`.
 */
export function WorkspacePage(): React.JSX.Element {
  const { t } = useTranslation();
  const dealerships = useAppStore((s) => s.dealerships);
  const locationsPanelOpen = useMapStore((s) => s.locationsPanelOpen);
  const chatPanelOpen = useMapStore((s) => s.chatPanelOpen);
  const detailDialogId = useMapStore((s) => s.detailDialogId);
  const closeDetailDialog = useMapStore((s) => s.closeDetailDialog);
  const openDetailDialog = useMapStore((s) => s.openDetailDialog);
  const selectDealership = useAppStore((s) => s.select);
  const detailDealership = useMemo(
    () => dealerships.find((d) => d.id === detailDialogId) ?? null,
    [dealerships, detailDialogId],
  );

  // Imperative panel handles for programmatic collapse/expand.
  const leftRef = usePanelRef();
  const rightRef = usePanelRef();

  // Panel width persistence in localStorage.
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "drm-workspace",
    panelIds: [LEFT_ID, CENTER_ID, RIGHT_ID],
    storage: localStorage,
  });

  // Narrow window at start: collapse the chat dock (it can be reopened from
  // the header), instead of squeezing the map to a strip.
  useEffect(() => {
    if (narrowDefaultApplied) return;
    narrowDefaultApplied = true;
    const store = useMapStore.getState();
    if (window.innerWidth < WIDE_WINDOW_PX && store.chatPanelOpen)
      store.toggleChatPanel();
  }, []);

  // Sync store flags -> imperative collapse/expand.
  useEffect(() => {
    const h = leftRef.current;
    if (!h) return;
    if (locationsPanelOpen && h.isCollapsed()) h.expand();
    else if (!locationsPanelOpen && !h.isCollapsed()) h.collapse();
  }, [locationsPanelOpen, leftRef]);

  useEffect(() => {
    const h = rightRef.current;
    if (!h) return;
    if (chatPanelOpen && h.isCollapsed()) h.expand();
    else if (!chatPanelOpen && !h.isCollapsed()) h.collapse();
  }, [chatPanelOpen, rightRef]);

  return (
    <>
      <ResizablePanelGroup
        orientation="horizontal"
        id="drm-workspace"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
        className="h-full"
      >
        {/* Left dock: address list + upload */}
        <ResizablePanel
          id={LEFT_ID}
          panelRef={leftRef}
          collapsible
          // Strings are percentages, numbers pixels (react-resizable-panels
          // v4): the former `minSize={14}` let the dock shrink to 14 px,
          // under the sidebar rail, where it could not be grabbed again.
          defaultSize="22%"
          minSize={240}
          collapsedSize={0}
          // Docks keep their width when the window resizes; the map takes up
          // the difference (a shrinking percentage collapsed the dock).
          groupResizeBehavior="preserve-pixel-size"
          onResize={(size, _id, prev) => {
            // Sync collapse/expand -> store flag (only when it differs).
            // Not on mount: a stored width below the minimum (e.g. in a
            // narrower window) collapses the panel then, which must not
            // count as the user closing it.
            if (!prev) return;
            const collapsed = size.asPercentage <= 0;
            const storeOpen = useMapStore.getState().locationsPanelOpen;
            if (collapsed === storeOpen)
              useMapStore.getState().toggleLocationsPanel();
          }}
        >
          <AddressDock />
        </ResizablePanel>

        {/* Above the sidebar rail, which otherwise covers it once the dock
            is collapsed against the sidebar. */}
        <ResizableHandle
          withHandle
          className="z-20"
          aria-label={t("shell.resizeLocations")}
        />

        {/* Center: map */}
        {/* `isolate` keeps Leaflet's pane z-indexes (400+) inside the map,
            so they cannot cover the neighbouring resize handles. */}
        <ResizablePanel
          id={CENTER_ID}
          defaultSize="50%"
          minSize={320}
          className="isolate"
        >
          <MapPage />
        </ResizablePanel>

        <ResizableHandle
          withHandle
          className="z-20"
          aria-label={t("shell.resizeChat")}
        />

        {/* Right dock: portfolio chat composer */}
        <ResizablePanel
          id={RIGHT_ID}
          panelRef={rightRef}
          collapsible
          defaultSize="28%"
          minSize={300}
          collapsedSize={0}
          groupResizeBehavior="preserve-pixel-size"
          onResize={(size, _id, prev) => {
            if (!prev) return;
            const collapsed = size.asPercentage <= 0;
            const storeOpen = useMapStore.getState().chatPanelOpen;
            if (collapsed === storeOpen)
              useMapStore.getState().toggleChatPanel();
          }}
        >
          <ChatPanel />
        </ResizablePanel>
      </ResizablePanelGroup>

      <DealershipDetailDialog
        dealership={detailDealership}
        open={detailDealership !== null}
        onOpenChange={(o) => {
          if (!o) closeDetailDialog();
        }}
        onNavigate={(id) => {
          openDetailDialog(id);
          // The map behind the dialog follows along.
          selectDealership(id);
        }}
      />
    </>
  );
}
