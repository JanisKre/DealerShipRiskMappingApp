import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { notify } from "@renderer/lib/notify";
import {
  AgentCommandRequestSchema,
  type AgentCommand,
  type AgentCommandResult,
} from "@shared/agent-control";
import { executeAgentCommand } from "@renderer/lib/agentControl";
import { isSavedState } from "@renderer/store/app/runtime";
import { useAppStore } from "@renderer/store/appStore";
import { useMapStore } from "@renderer/store/mapStore";

/**
 * Remote control through the agent gateway (MCP), off unless the user
 * switched it on in the settings: carries out the commands the main process
 * passes on and answers each one. Every action that changes what the window
 * shows or starts work is announced with a toast, so nothing happens
 * unseen.
 */
export function AgentControlBridge(): null {
  const { t } = useTranslation();
  const navigate = useNavigate();

  useEffect(() => {
    function announce(command: AgentCommand, result: AgentCommandResult): void {
      if (!result.ok || command.type === "getState") return;
      const { state } = result;
      const text =
        command.type === "openPortfolio"
          ? t("agentControl.openedPortfolio", { name: state.portfolio.name })
          : command.type === "showLocation"
            ? t("agentControl.shownLocation", {
                name: state.selectedLocation?.name ?? "",
              })
            : command.type === "openView"
              ? t("agentControl.openedView", {
                  view: t(`nav.${state.view}`),
                })
              : command.type === "startAnalysis"
                ? t("agentControl.startedAnalysis", {
                    count: result.started ?? 0,
                  })
                : t("agentControl.stoppedAnalysis");
      notify.info(text, { description: t("agentControl.source") });
    }

    return window.api.onAgentCommand((raw) => {
      // Sent by the main process, which validated it; checked again so a
      // malformed message can never reach a store action.
      const request = AgentCommandRequestSchema.safeParse(raw);
      if (!request.success) return;
      const { id, command } = request.data;
      void executeAgentCommand(command, {
        app: () => useAppStore.getState(),
        isSaved: () => isSavedState(useAppStore.getState()),
        detailDialogId: () => useMapStore.getState().detailDialogId,
        openDetailDialog: (locationId) =>
          useMapStore.getState().openDetailDialog(locationId),
        // The hash router writes the route to the address at once; the
        // router's own location only follows with the next render, which
        // is after the answer to a page change has been sent.
        pathname: () => window.location.hash.replace(/^#/, "") || "/",
        navigate: (route) => void navigate(route),
        listPortfolios: () => window.api.listSessions(),
      })
        .catch((error: unknown): AgentCommandResult => ({
          ok: false,
          error: "failed",
          detail: (error instanceof Error
            ? error.message
            : String(error)
          ).slice(0, 300),
        }))
        .then((result) => {
          announce(command, result);
          return window.api.agentCommandResult({ id, result });
        })
        .catch((error: unknown) => {
          console.error("Answering a remote-control command failed:", error);
        });
    });
  }, [navigate, t]);

  return null;
}
