import { z } from "zod";
import { isLoopbackUrl } from "./llm-config";

/**
 * External MCP servers the user connects (Streamable HTTP only; the app
 * starts no local programs). The app lists a server's tools and, when the
 * user asks in the chat, may call tools the server marks read-only. Results
 * are untrusted data, fenced like every other lookup.
 */

export const MCP_CLIENT_MAX_SERVERS = 8;
export const MCP_CLIENT_MAX_TOOLS = 50;
/** Characters of one tool result passed on. */
export const MCP_CLIENT_RESULT_MAX_CHARS = 8_000;

export const McpServerConfigSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name: z.string().min(1).max(60),
  url: z.string().min(1).max(500),
  enabled: z.boolean().default(true),
  /** A bearer token is stored in the OS keychain, never here. */
  hasToken: z.boolean().optional(),
});
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

export type McpUrlCheck =
  | { ok: true; url: string }
  | { ok: false; problem: "invalid" | "scheme" | "credentials" | "insecure" };

/**
 * A server URL must be HTTPS, or plain HTTP on this computer; credentials in
 * the URL are refused (they would end up in logs).
 */
export function validateMcpServerUrl(raw: string): McpUrlCheck {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, problem: "invalid" };
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    return { ok: false, problem: "scheme" };
  }
  if (url.username || url.password)
    return { ok: false, problem: "credentials" };
  if (url.protocol === "http:" && !isLoopbackUrl(url.toString())) {
    return { ok: false, problem: "insecure" };
  }
  url.hash = "";
  return { ok: true, url: url.toString() };
}

export const McpRemoteToolSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(1_000),
  /** True only when the server annotates the tool `readOnlyHint: true`. */
  readOnly: z.boolean(),
  inputSchema: z.unknown().optional(),
});
export type McpRemoteTool = z.infer<typeof McpRemoteToolSchema>;

export const McpServerToolsSchema = z.object({
  serverName: z.string().max(200),
  protocolVersion: z.string().max(40),
  tools: z.array(McpRemoteToolSchema).max(MCP_CLIENT_MAX_TOOLS),
});
export type McpServerTools = z.infer<typeof McpServerToolsSchema>;

/** Tools from a `tools/list` result, cleaned and capped. */
export function cleanRemoteTools(raw: unknown): McpRemoteTool[] {
  const list =
    typeof raw === "object" && raw !== null
      ? (raw as { tools?: unknown }).tools
      : null;
  if (!Array.isArray(list)) return [];
  const tools: McpRemoteTool[] = [];
  for (const entry of list) {
    if (typeof entry !== "object" || entry === null) continue;
    const t = entry as Record<string, unknown>;
    if (typeof t.name !== "string" || !/^[\w.\-/]{1,128}$/.test(t.name))
      continue;
    const annotations = (t.annotations ?? {}) as Record<string, unknown>;
    tools.push({
      name: t.name,
      description:
        typeof t.description === "string" ? t.description.slice(0, 1_000) : "",
      readOnly: annotations.readOnlyHint === true,
      inputSchema: t.inputSchema,
    });
    if (tools.length === MCP_CLIENT_MAX_TOOLS) break;
  }
  return tools;
}

/** Text of a `tools/call` result (text parts only), capped. */
export function toolResultText(raw: unknown): {
  text: string;
  isError: boolean;
} {
  const result = (raw ?? {}) as { content?: unknown; isError?: unknown };
  const parts = Array.isArray(result.content) ? result.content : [];
  const text = parts
    .map((part) =>
      typeof part === "object" &&
      part !== null &&
      (part as { type?: unknown }).type === "text" &&
      typeof (part as { text?: unknown }).text === "string"
        ? (part as { text: string }).text
        : "",
    )
    .filter(Boolean)
    .join("\n")
    .slice(0, MCP_CLIENT_RESULT_MAX_CHARS);
  return { text, isError: result.isError === true };
}

export const McpToolCallResultSchema = z.object({
  text: z.string().max(MCP_CLIENT_RESULT_MAX_CHARS),
  isError: z.boolean(),
});
export type McpToolCallResult = z.infer<typeof McpToolCallResultSchema>;
