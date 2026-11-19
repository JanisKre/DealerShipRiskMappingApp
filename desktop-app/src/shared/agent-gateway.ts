import { z } from "zod";

/**
 * Local agent gateway: an HTTP server on this computer (loopback only, off
 * by default) through which other AI tools can read the portfolio over
 * standard protocols — MCP (tools + an MCP App view), A2A (agent card +
 * JSON-RPC) and AG-UI (event stream of the portfolio chat). Read-only
 * unless the user also switches on `control`, which adds MCP tools that
 * operate the app window (shared/agent-control.ts). See
 * docs/agent-protocols.md.
 */

export const GATEWAY_DEFAULT_PORT = 47821;
export const GATEWAY_HOST = "127.0.0.1";

export const AgentGatewaySettingsSchema = z.object({
  enabled: z.boolean().default(false),
  port: z.number().int().min(1024).max(65535).default(GATEWAY_DEFAULT_PORT),
  /** Model Context Protocol server at /mcp. */
  mcp: z.boolean().default(true),
  /**
   * MCP tools that operate the app window: open a portfolio, show a
   * location, change the page, start or stop an analysis. Needs `mcp`.
   */
  control: z.boolean().default(false),
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
  control: false,
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
    const presented = bearerToken(input.authorization);
    if (presented == null || !input.tokensEqual(presented, input.token)) {
      return { status: 401, reason: "token" };
    }
  }
  return null;
}

/** Longest Authorization header read; a gateway token is 64 characters. */
const MAX_AUTHORIZATION_LENGTH = 1024;

/**
 * The token of an `Authorization: Bearer <token>` header (scheme in any
 * case, at least one space or tab after it, surrounding whitespace
 * dropped), or null. Read by position, not with a regular expression: the
 * pattern it replaced (`^Bearer\s+(.+)$`) backtracked quadratically on a
 * header of many spaces (CodeQL js/polynomial-redos), and the header comes
 * from any local process.
 */
export function bearerToken(header: string | undefined): string | null {
  if (!header || header.length > MAX_AUTHORIZATION_LENGTH) return null;
  const scheme = "bearer";
  if (header.slice(0, scheme.length).toLowerCase() !== scheme) return null;
  const separator = header.charAt(scheme.length);
  if (separator !== " " && separator !== "\t") return null;
  const token = header.slice(scheme.length).trim();
  // A header value never spans lines; a token with whitespace inside is none.
  return token.length > 0 && !/\s/.test(token) ? token : null;
}

// --- Connecting Claude -------------------------------------------------------

/** Name under which the app is registered as an MCP server in a host. */
export const MCP_HOST_SERVER_NAME = "dealership-risk";

/** Shell command that registers the gateway's MCP server in Claude Code. */
export function claudeCodeCommand(port: number, token: string): string {
  return `claude mcp add --transport http ${MCP_HOST_SERVER_NAME} ${gatewayBaseUrl(port)}/mcp --header "Authorization: Bearer ${token}"`;
}

/**
 * Entry for Claude Desktop's `claude_desktop_config.json`. Claude Desktop
 * starts local programs only, so the `mcp-remote` bridge (run through npx,
 * needs Node.js) forwards to the gateway. The header travels in an
 * environment variable because some hosts split arguments at spaces.
 */
export function claudeDesktopConfig(port: number, token: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        [MCP_HOST_SERVER_NAME]: {
          command: "npx",
          args: [
            "-y",
            "mcp-remote",
            `${gatewayBaseUrl(port)}/mcp`,
            "--header",
            "Authorization:${AUTH_HEADER}",
          ],
          env: { AUTH_HEADER: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
}

/** The text with the token replaced by dots, for showing it on screen. */
export function maskToken(text: string, token: string): string {
  return token ? text.split(token).join("•".repeat(8)) : text;
}
