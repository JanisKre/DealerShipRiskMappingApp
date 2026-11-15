import { timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import {
  GATEWAY_HOST,
  checkGatewayRequest,
  isLoopbackOrigin,
  type AgentGatewaySettings,
} from "@shared/agent-gateway";
import { A2A_CARD_PATH, A2aAgent, buildAgentCard } from "./a2a";
import {
  RunAgentInputSchema,
  agUiRun,
  chatMessagesFromAgUi,
  encodeAgUiEvent,
} from "./ag-ui";
import { resolvePortfolio, type GatewayData } from "./gateway-data";
import { RPC_PARSE_ERROR, rpcError } from "./json-rpc";
import { handleMcpMessage } from "./mcp-server";
import { portfolioContextText, portfolioSummary } from "./portfolio-facts";
import type { ChatMessage } from "@shared/types";

/**
 * HTTP server of the agent gateway. Binds to 127.0.0.1 only; every request
 * passes `checkGatewayRequest` (Host, Origin, bearer token) before a route
 * runs. Bodies are JSON and capped; no route writes data.
 */

export const GATEWAY_MAX_BODY_BYTES = 1_000_000;

export interface GatewayDeps {
  data: GatewayData;
  token: string;
  appVersion: string;
  /** Answer stream of the portfolio chat (AG-UI); throws when no AI is set up. */
  chat: (
    messages: ChatMessage[],
    context: string,
    signal: AbortSignal,
  ) => AsyncIterable<string>;
  /** Wraps a route so AI calls inside it are attributed in the record book. */
  withFeature?: <T>(feature: string, fn: () => T) => T;
}

function tokensEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function readBody(req: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > GATEWAY_MAX_BODY_BYTES) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", () => resolve(null));
  });
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(JSON.stringify(body));
}

export class AgentGatewayServer {
  private server: Server | null = null;
  private port = 0;
  private requestCount = 0;
  private readonly a2a: A2aAgent;

  constructor(
    private readonly settings: AgentGatewaySettings,
    private readonly deps: GatewayDeps,
  ) {
    this.a2a = new A2aAgent(deps.data);
  }

  get boundPort(): number {
    return this.port;
  }

  get requests(): number {
    return this.requestCount;
  }

  /** Resolves with the bound port (`port: 0` in tests picks a free one). */
  start(port: number = this.settings.port): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        void this.route(req, res).catch(() => {
          if (!res.headersSent) sendJson(res, 500, { error: "internal" });
          else res.end();
        });
      });
      server.once("error", reject);
      server.listen(port, GATEWAY_HOST, () => {
        this.server = server;
        this.port = (server.address() as AddressInfo).port;
        resolve(this.port);
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      const server = this.server;
      this.server = null;
      if (!server) return resolve();
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }

  private async route(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    this.requestCount += 1;
    const path = (req.url ?? "/").split("?")[0];
    const origin = req.headers.origin;
    const isCard = path === A2A_CARD_PATH && this.settings.a2a;
    const cors: Record<string, string> =
      origin && isLoopbackOrigin(origin)
        ? {
            "Access-Control-Allow-Origin": origin,
            Vary: "Origin",
            "Access-Control-Allow-Headers":
              "Authorization, Content-Type, Accept, A2A-Version, Mcp-Protocol-Version, Mcp-Session-Id",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          }
        : {};
    const preflight = req.method === "OPTIONS";
    const rejection = checkGatewayRequest({
      host: req.headers.host,
      origin,
      authorization: req.headers.authorization,
      port: this.port,
      token: this.deps.token,
      // Preflights carry no credentials; the card is public by design.
      requireToken: !preflight && !isCard,
      tokensEqual,
    });
    if (rejection) {
      return sendJson(
        res,
        rejection.status,
        { error: rejection.reason },
        rejection.status === 401 ? { "WWW-Authenticate": "Bearer" } : {},
      );
    }
    if (preflight) {
      res.writeHead(204, cors);
      return void res.end();
    }

    if (isCard && req.method === "GET") {
      return sendJson(
        res,
        200,
        buildAgentCard(this.port, this.deps.appVersion),
        cors,
      );
    }
    const enabled =
      (path === "/mcp" && this.settings.mcp) ||
      (path === "/a2a" && this.settings.a2a) ||
      (path === "/ag-ui" && this.settings.agUi);
    if (!enabled) return sendJson(res, 404, { error: "not found" }, cors);
    if (req.method !== "POST") {
      // MCP: no server-initiated stream (GET) and no sessions (DELETE).
      return sendJson(
        res,
        405,
        { error: "method not allowed" },
        {
          ...cors,
          Allow: "POST, OPTIONS",
        },
      );
    }
    const body = await readBody(req);
    if (!body) return sendJson(res, 413, { error: "body too large" }, cors);
    let json: unknown;
    try {
      json = JSON.parse(body.toString("utf8"));
    } catch {
      return path === "/ag-ui"
        ? sendJson(res, 400, { error: "invalid JSON" }, cors)
        : sendJson(
            res,
            400,
            rpcError(null, RPC_PARSE_ERROR, "Parse error"),
            cors,
          );
    }

    if (path === "/mcp") {
      const response = handleMcpMessage(
        json,
        this.deps.data,
        this.deps.appVersion,
      );
      if (!response) {
        res.writeHead(202, cors);
        return void res.end();
      }
      return sendJson(res, 200, response, cors);
    }
    if (path === "/a2a") {
      const header = req.headers["a2a-version"];
      return sendJson(
        res,
        200,
        this.a2a.handle(json, Array.isArray(header) ? header[0] : header),
        cors,
      );
    }
    return this.runAgUi(json, res, cors);
  }

  private async runAgUi(
    json: unknown,
    res: ServerResponse,
    cors: Record<string, string>,
  ): Promise<void> {
    const parsed = RunAgentInputSchema.safeParse(json);
    if (!parsed.success) {
      return sendJson(res, 400, { error: "invalid RunAgentInput" }, cors);
    }
    const input = parsed.data;
    const session = resolvePortfolio(
      this.deps.data,
      input.forwardedProps?.portfolioId,
    );
    const controller = new AbortController();
    res.on("close", () => controller.abort());
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Content-Type-Options": "nosniff",
      ...cors,
    });
    const messages = chatMessagesFromAgUi(input);
    const run = (): AsyncIterable<string> =>
      messages.length === 0
        ? NO_TOKENS
        : this.deps.chat(
            messages,
            session
              ? portfolioContextText(session)
              : "No portfolio has been saved yet.",
            controller.signal,
          );
    const snapshot = session
      ? { portfolio: portfolioSummary(session) }
      : undefined;
    const write = async (): Promise<void> => {
      for await (const event of agUiRun(input, lazy(run), snapshot)) {
        if (controller.signal.aborted) break;
        res.write(encodeAgUiEvent(event));
      }
    };
    await (this.deps.withFeature
      ? this.deps.withFeature("gateway:ag-ui", write)
      : write());
    res.end();
  }
}

/** The answer to a run without a user message: nothing. */
const NO_TOKENS: AsyncIterable<string> = {
  [Symbol.asyncIterator]: () => ({
    next: async () => ({ done: true as const, value: undefined }),
  }),
};

/** Defers creating the stream until it is read, so a set-up error becomes RUN_ERROR. */
function lazy(make: () => AsyncIterable<string>): AsyncIterable<string> {
  return {
    [Symbol.asyncIterator]: () => {
      let iterator: AsyncIterator<string> | null = null;
      return {
        next: () => {
          iterator ??= make()[Symbol.asyncIterator]();
          return iterator.next();
        },
        return: async () => {
          await iterator?.return?.();
          return { done: true as const, value: undefined };
        },
      };
    },
  };
}
