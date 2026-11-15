import { app } from "electron";
import {
  DEFAULT_GATEWAY_SETTINGS,
  type AgentGatewaySettings,
  type AgentGatewayStatus,
} from "@shared/agent-gateway";
import { listSessions, loadSession } from "../../db/sessions.repo";
import { withAiFeature } from "../ai-log.service";
import { portfolioChatStream } from "../llm.service";
import {
  ensureGatewayToken,
  getGatewayToken,
  getSettings,
} from "../settings.service";
import { AgentGatewayServer } from "./server";

/**
 * Starts and stops the agent gateway according to the settings. Off by
 * default; the bearer token is created the first time the user enables it
 * and kept in the OS keychain.
 */

let server: AgentGatewayServer | null = null;
let running: AgentGatewaySettings | null = null;
let lastError: string | undefined;

function configured(): AgentGatewaySettings {
  return { ...DEFAULT_GATEWAY_SETTINGS, ...getSettings().agentGateway };
}

function sameSettings(
  a: AgentGatewaySettings,
  b: AgentGatewaySettings,
): boolean {
  return (
    a.port === b.port && a.mcp === b.mcp && a.a2a === b.a2a && a.agUi === b.agUi
  );
}

/** Brings the server in line with the settings; `restart` forces a new start. */
export async function syncAgentGateway(restart = false): Promise<void> {
  const settings = configured();
  if (
    server &&
    (restart || !settings.enabled || !sameSettings(settings, running!))
  ) {
    await server.stop();
    server = null;
    running = null;
  }
  if (!settings.enabled) {
    lastError = undefined;
    return;
  }
  if (server) return;
  try {
    const next = new AgentGatewayServer(settings, {
      data: { listPortfolios: listSessions, loadPortfolio: loadSession },
      token: ensureGatewayToken(),
      appVersion: app.getVersion(),
      chat: (messages, context, signal) =>
        portfolioChatStream(messages, context, signal),
      withFeature: withAiFeature,
    });
    await next.start();
    server = next;
    running = settings;
    lastError = undefined;
  } catch (error) {
    lastError = (error instanceof Error ? error.message : String(error)).slice(
      0,
      300,
    );
    console.warn("Agent gateway could not start:", error);
  }
}

export function agentGatewayStatus(): AgentGatewayStatus {
  return {
    running: server != null,
    port: server?.boundPort ?? configured().port,
    ...(lastError ? { error: lastError } : {}),
    token: getGatewayToken(),
    requests: server?.requests ?? 0,
  };
}

/** New token; running clients must be given the new one. */
export async function rotateAgentGatewayToken(): Promise<AgentGatewayStatus> {
  ensureGatewayToken(true);
  await syncAgentGateway(true);
  return agentGatewayStatus();
}

export async function stopAgentGateway(): Promise<void> {
  await server?.stop();
  server = null;
  running = null;
}
