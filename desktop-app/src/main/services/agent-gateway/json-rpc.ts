/** Minimal JSON-RPC 2.0 helpers shared by the MCP and A2A routes. */

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: JsonRpcId; result: unknown }
  | {
      jsonrpc: "2.0";
      id: JsonRpcId;
      error: { code: number; message: string; data?: unknown };
    };

export const RPC_PARSE_ERROR = -32700;
export const RPC_INVALID_REQUEST = -32600;
export const RPC_METHOD_NOT_FOUND = -32601;
export const RPC_INVALID_PARAMS = -32602;
export const RPC_INTERNAL_ERROR = -32603;

export function rpcResult(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

export function rpcError(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

/** A request or notification object; null for anything else (incl. batches). */
export function asJsonRpcRequest(value: unknown): JsonRpcRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const v = value as Record<string, unknown>;
  if (v.jsonrpc !== "2.0" || typeof v.method !== "string") return null;
  if (
    v.id !== undefined &&
    v.id !== null &&
    typeof v.id !== "string" &&
    typeof v.id !== "number"
  )
    return null;
  return v as unknown as JsonRpcRequest;
}
