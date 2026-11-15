import { z } from "zod";

/**
 * Local agent gateway: an HTTP server on this computer (loopback only, off
 * by default) through which other AI tools can read the portfolio over
 * standard protocols — MCP (tools + an MCP App view), A2A (agent card +
 * JSON-RPC) and AG-UI (event stream of the portfolio chat). Read-only: no
 * route changes data. See docs/agent-protocols.md.
 */

export const GATEWAY_DEFAULT_PORT = 47821;
export const GATEWAY_HOST = "127.0.0.1";

export const AgentGatewaySettingsSchema = z.object({
  enabled: z.boolean().default(false),
  port: z.number().int().min(1024).max(65535).default(GATEWAY_DEFAULT_PORT),
  /** Model Context Protocol server at /mcp. */
  mcp: z.boolean().default(true),
  /** Agent2Agent card and JSON-RPC endpoint at /a2a. */
  a2a: z.boolean().default(false),
  /** AG-UI run endpoint at /ag-ui (needs an AI provider). */
  agUi: z.boolean().default(false),
});
export type AgentGatewaySettings = z.infer<typeof AgentGatewaySettingsSchema>;

export const DEFAULT_GATEWAY_SETTINGS: AgentGatewaySettings = {
  enabled: false,
  port: GATEWAY_DEFAULT_PORT,
  mcp: true,
  a2a: false,
  agUi: false,
};

export const AgentGatewayStatusSchema = z.object({
  running: z.boolean(),
  port: z.number().int(),
  /** Why the server is not running although it is enabled (port in use …). */
  error: z.string().max(300).optional(),
  /** Bearer token clients must send; null until the gateway was enabled once. */
  token: z.string().nullable(),
  /** Requests answered since the server started. */
  requests: z.number().int().nonnegative(),
});
export type AgentGatewayStatus = z.infer<typeof AgentGatewayStatusSchema>;

export function gatewayBaseUrl(port: number): string {
  return `http://${GATEWAY_HOST}:${port}`;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** True for `http(s)://localhost|127.0.0.1|[::1][:port]`. */
export function isLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      LOOPBACK_HOSTS.has(url.hostname)
    );
  } catch {
    return false;
  }
}

export type GatewayRejection =
  { status: 403; reason: "host" | "origin" } | { status: 401; reason: "token" };

/**
 * Request guard of the gateway. A page on the internet can make the user's
 * browser send requests to a local port (CSRF, DNS rebinding), so:
 *  - the Host header must name this computer and the configured port,
 *  - a browser Origin must itself be a loopback origin,
 *  - every route except the public agent card needs the bearer token.
 */
export function checkGatewayRequest(input: {
  host: string | undefined;
  origin: string | undefined;
  authorization: string | undefined;
  port: number;
  token: string;
  requireToken: boolean;
  /** Constant-time comparison, injected so this stays free of Node imports. */
  tokensEqual: (a: string, b: string) => boolean;
}): GatewayRejection | null {
  const allowedHosts = [...LOOPBACK_HOSTS].map((h) => `${h}:${input.port}`);
  if (!input.host || !allowedHosts.includes(input.host.toLowerCase())) {
    return { status: 403, reason: "host" };
  }
  if (input.origin !== undefined && !isLoopbackOrigin(input.origin)) {
    return { status: 403, reason: "origin" };
  }
  if (input.requireToken) {
    const match = /^Bearer\s+(.+)$/i.exec(input.authorization ?? "");
    if (!match || !input.tokensEqual(match[1].trim(), input.token)) {
      return { status: 401, reason: "token" };
    }
  }
  return null;
}
