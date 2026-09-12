/**
 * Shadcn-compatible wrapper around `react-resizable-panels` (v2 API).
 *
 * Exports:
 *   - ResizablePanelGroup  -> Group
 *   - ResizablePanel       -> Panel (with panelRef for the imperative API)
 *   - ResizableHandle      -> Separator (optionally with a visible handle)
 *
 * Imperative API: `panelRef` on `ResizablePanel` gives a `PanelImperativeHandle`
 * with `.collapse()`, `.expand()`, `.isCollapsed()`.
 * Width persistence: `useDefaultLayout({ id, storage: localStorage })`.
 */
import { GripVertical } from "lucide-react";
import {
  Group,
  Panel,
  Separator,
} from "react-resizable-panels";
import type {
  GroupProps,
  SeparatorProps,
} from "react-resizable-panels";
import { cn } from "@renderer/lib/utils";

export {
  useDefaultLayout as useResizableDefaultLayout,
  usePanelRef as useResizablePanelRef,
} from "react-resizable-panels";
export type { PanelImperativeHandle as ResizablePanelHandle } from "react-resizable-panels";

/** Horizontal or vertical panel group. */
const ResizablePanelGroup = ({
  className,
  ...props
}: Readonly<GroupProps>): React.JSX.Element => (
  <Group
    className={cn(
      "flex h-full w-full data-[orientation=vertical]:flex-col",
      className,
    )}
    {...props}
  />
);

/** A single panel within a `ResizablePanelGroup`. */
const ResizablePanel = Panel;

/**
 * Draggable separator between two panels.
 * `withHandle` shows the pill with a `GripVertical` icon.
 */
const ResizableHandle = ({
  withHandle,
  className,
  ...props
}: Readonly<SeparatorProps & { withHandle?: boolean }>): React.JSX.Element => (
  <Separator
    className={cn(
      "bg-border focus-visible:ring-ring relative flex w-px items-center justify-center after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-offset-1 data-[orientation=vertical]:h-px data-[orientation=vertical]:w-full data-[orientation=vertical]:after:left-0 data-[orientation=vertical]:after:h-1 data-[orientation=vertical]:after:w-full data-[orientation=vertical]:after:-translate-y-1/2 data-[orientation=vertical]:after:translate-x-0 [&[data-resize-handle-active]]:bg-primary/30",
      className,
    )}
    {...props}
  >
    {withHandle && (
      <div className="bg-border z-10 flex h-4 w-3 items-center justify-center rounded-sm border">
        <GripVertical className="size-2.5" />
      </div>
    )}
  </Separator>
);

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
