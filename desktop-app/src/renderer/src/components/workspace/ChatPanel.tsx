import { ChatView } from "@renderer/components/chat/ChatView";
import { useAppStore } from "@renderer/store/appStore";
import { useMapStore } from "@renderer/store/mapStore";

/**
 * Right-hand chat dock in the map workspace: the shared {@link ChatView};
 * locations open in the workspace detail dialog or fly into view on the map.
 */
export function ChatPanel(): React.JSX.Element {
  return (
    <ChatView
      onOpenLocation={(id) => useMapStore.getState().openDetailDialog(id)}
      onShowLocation={(id) => useAppStore.getState().select(id)}
    />
  );
}
