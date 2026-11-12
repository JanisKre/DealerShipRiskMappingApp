import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ChatView } from "@renderer/components/chat/ChatView";
import { useAppStore } from "@renderer/store/appStore";
import { parseDashboardCommand } from "./dashboardTiles";

/**
 * The dashboard's side panel: the same {@link ChatView} as on the map, plus
 * the dashboard's tile commands ("Standorttabelle anzeigen") and their
 * example prompts. Locations open in the dashboard's detail dialog.
 */
export function DashboardAssistant({
  onClose,
  onDashboardCommand,
  onOpenLocation,
}: Readonly<{
  onClose: () => void;
  onDashboardCommand: (prompt: string) => string | null;
  onOpenLocation: (id: string) => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <ChatView
      onClose={onClose}
      onCommand={onDashboardCommand}
      isCommand={(prompt) => parseDashboardCommand(prompt) !== null}
      onOpenLocation={onOpenLocation}
      onShowLocation={(id) => {
        useAppStore.getState().select(id);
        void navigate("/");
      }}
      extraPrompts={[
        t("dashboard.examplePromptTable"),
        t("dashboard.examplePromptClusters"),
      ]}
    />
  );
}
