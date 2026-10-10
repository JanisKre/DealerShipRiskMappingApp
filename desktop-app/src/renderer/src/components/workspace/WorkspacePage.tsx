import { useEffect, useMemo } from "react";
import { useAppStore } from "@renderer/store/appStore";
import { useMapStore } from "@renderer/store/mapStore";
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
  const dealerships = useAppStore((s) => s.dealerships);
  const locationsPanelOpen = useMapStore((s) => s.locationsPanelOpen);
  const chatPanelOpen = useMapStore((s) => s.chatPanelOpen);
  const detailDialogId = useMapStore((s) => s.detailDialogId);
  const closeDetailDialog = useMapStore((s) => s.closeDetailDialog);
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
          defaultSize={20}
          minSize={14}
          collapsedSize={0}
          onResize={(size) => {
            // Sync collapse/expand -> store flag (only when it differs).
            const collapsed = size.asPercentage <= 0;
            const storeOpen = useMapStore.getState().locationsPanelOpen;
            if (collapsed === storeOpen)
              useMapStore.getState().toggleLocationsPanel();
          }}
        >
          <AddressDock />
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Center: map */}
        <ResizablePanel id={CENTER_ID} defaultSize={50} minSize={30}>
          <MapPage />
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Right dock: portfolio chat composer */}
        <ResizablePanel
          id={RIGHT_ID}
          panelRef={rightRef}
          collapsible
          defaultSize={28}
          minSize={22}
          collapsedSize={0}
          onResize={(size) => {
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
      />
    </>
  );
}
