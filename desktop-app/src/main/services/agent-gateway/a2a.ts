import { randomUUID } from "node:crypto";
import { z } from "zod";
import { gatewayBaseUrl } from "@shared/agent-gateway";
import {
  listLocations,
  locationEvidence,
  portfolioSummary,
  summaryText,
} from "./portfolio-facts";
import { resolvePortfolio, type GatewayData } from "./gateway-data";
import {
  RPC_INVALID_PARAMS,
  RPC_INVALID_REQUEST,
  RPC_METHOD_NOT_FOUND,
  asJsonRpcRequest,
  rpcError,
  rpcResult,
  type JsonRpcResponse,
} from "./json-rpc";

/**
 * Agent2Agent protocol 1.0, JSON-RPC binding. The app answers as a
 * deterministic agent: a request is matched to one of three read-only
 * skills and answered from the stored portfolio, without a language model.
 * Every task completes immediately; there is no streaming and no push.
 */

export const A2A_PROTOCOL_VERSION = "1.0";
export const A2A_CARD_PATH = "/.well-known/agent-card.json";

export const A2A_ERROR = {
  taskNotFound: -32001,
  taskNotCancelable: -32002,
  unsupportedOperation: -32004,
  versionNotSupported: -32009,
} as const;

export const A2A_SKILLS = [
  {
    id: "portfolio-summary",
    name: "Portfolio summary",
    description:
      "Totals of a motor-dealer portfolio: locations, hail EAL and exposure (screening estimates), hail zones, locations needing review, highest-EAL locations.",
    tags: ["hail", "portfolio", "underwriting"],
    examples: ["Summarise the portfolio", '{"skill":"portfolio-summary"}'],
  },
  {
    id: "top-locations",
    name: "Locations by hail EAL",
    description:
      "The locations with the highest hail EAL, optionally only from a hail zone upwards or only those needing review.",
    tags: ["hail", "ranking"],
    examples: ['{"skill":"top-locations","limit":20,"minHailZone":4}'],
  },
  {
    id: "location-evidence",
    name: "Location evidence",
    description:
      "One location: hail EAL inputs, provenance of each input, boundary quality, weakest assumptions and limitations.",
    tags: ["hail", "evidence", "provenance"],
    examples: ['{"skill":"location-evidence","locationId":"…"}'],
  },
] as const;
type SkillId = (typeof A2A_SKILLS)[number]["id"];

export function buildAgentCard(port: number, appVersion: string): unknown {
  return {
    name: "Dealership Risk Mapping",
    description:
      "Read-only hail-risk screening data for the user's motor-dealer portfolios. Amounts are screening estimates, not insurance, engineering or legal decisions.",
    supportedInterfaces: [
      {
        url: `${gatewayBaseUrl(port)}/a2a`,
        protocolBinding: "JSONRPC",
        protocolVersion: A2A_PROTOCOL_VERSION,
      },
    ],
    version: appVersion,
    capabilities: { streaming: false, pushNotifications: false },
    securitySchemes: {
      bearer: { httpAuthSecurityScheme: { scheme: "Bearer" } },
    },
    securityRequirements: [{ schemes: { bearer: { list: [] } } }],
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],
    skills: A2A_SKILLS,
  };
}

const PartSchema = z
  .object({
    text: z.string().max(20_000).optional(),
    data: z.unknown().optional(),
  })
  .passthrough();
const SendMessageParamsSchema = z.object({
  message: z
    .object({
      messageId: z.string().min(1).max(200),
      role: z.string().optional(),
      parts: z.array(PartSchema).min(1).max(20),
      contextId: z.string().max(200).optional(),
    })
    .passthrough(),
});

const SkillRequestSchema = z
  .object({
    skill: z.string().optional(),
    portfolioId: z.string().min(1).max(200).optional(),
    locationId: z.string().min(1).max(200).optional(),
    limit: z.number().int().min(1).max(200).optional(),
    minHailZone: z.number().int().min(1).max(6).optional(),
    reviewOnly: z.boolean().optional(),
  })
  .passthrough();
type SkillRequest = z.infer<typeof SkillRequestSchema>;

/**
 * Which skill a message asks for. A data part names it; plain text is
 * matched by keywords and location names, falling back to the summary.
 */
export function matchSkill(
  parts: Array<{ text?: string; data?: unknown }>,
  locations: ReadonlyArray<{ id: string; name: string }>,
): SkillRequest & { skill: SkillId } {
  for (const part of parts) {
    const parsed = SkillRequestSchema.safeParse(part.data);
    if (parsed.success && A2A_SKILLS.some((s) => s.id === parsed.data.skill)) {
      return parsed.data as SkillRequest & { skill: SkillId };
    }
  }
  const text = parts
    .map((p) => p.text ?? "")
    .join(" ")
    .toLowerCase();
  const named = locations.find(
    (l) => l.name.length >= 3 && text.includes(l.name.toLowerCase()),
  );
  if (named) return { skill: "location-evidence", locationId: named.id };
  if (/\b(top|highest|höchste|ranking|rank|review|prüf)/.test(text)) {
    return {
      skill: "top-locations",
      reviewOnly: /\b(review|prüf)/.test(text),
    };
  }
  return { skill: "portfolio-summary" };
}

interface A2aTask {
  id: string;
  contextId: string;
  status: { state: string; timestamp: string; message?: unknown };
  artifacts?: unknown[];
}

function agentMessage(text: string): unknown {
  return { messageId: randomUUID(), role: "ROLE_AGENT", parts: [{ text }] };
}

function runSkill(
  request: SkillRequest & { skill: SkillId },
  data: GatewayData,
):
  | { ok: true; name: string; text: string; data: unknown }
  | { ok: false; text: string } {
  const session = resolvePortfolio(data, request.portfolioId);
  if (!session) return { ok: false, text: "No portfolio found." };
  if (request.skill === "location-evidence") {
    const evidence = locationEvidence(session, request.locationId ?? "");
    if (!evidence) return { ok: false, text: "Location not found." };
    const row = evidence.location;
    return {
      ok: true,
      name: "location-evidence",
      text: `${row.name}: hail zone ${row.hailZone ?? "n/a"}, ${row.vehicles ?? "no"} vehicles (${row.vehicleSource ?? "n/a"}), hail EAL ${row.hailEalEur == null ? "not available" : `${row.hailEalEur} EUR per year (screening estimate)`}.`,
      data: { portfolioId: session.id, ...evidence },
    };
  }
  if (request.skill === "top-locations") {
    const result = listLocations(session, {
      limit: request.limit ?? 10,
      minHailZone: request.minHailZone,
      reviewOnly: request.reviewOnly,
    });
    return {
      ok: true,
      name: "top-locations",
      text: result.locations
        .map(
          (row, i) =>
            `${i + 1}. ${row.name}: ${row.hailEalEur == null ? "no hail EAL" : `${row.hailEalEur} EUR`} (hail zone ${row.hailZone ?? "n/a"})`,
        )
        .join("\n"),
      data: { portfolioId: session.id, ...result },
    };
  }
  const summary = portfolioSummary(session);
  return {
    ok: true,
    name: "portfolio-summary",
    text: summaryText(summary),
    data: summary,
  };
}

/** Finished tasks kept for GetTask. */
export const A2A_TASK_HISTORY = 50;

export class A2aAgent {
  private readonly tasks = new Map<string, A2aTask>();

  constructor(private readonly data: GatewayData) {}

  handle(raw: unknown, versionHeader: string | undefined): JsonRpcResponse {
    const request = asJsonRpcRequest(raw);
    if (!request || request.id === undefined) {
      return rpcError(null, RPC_INVALID_REQUEST, "Not a JSON-RPC 2.0 request");
    }
    const { id } = request;
    // An empty header means 0.3 (spec 3.6.1), which this agent does not speak.
    if ((versionHeader ?? "").trim() !== A2A_PROTOCOL_VERSION) {
      return rpcError(
        id,
        A2A_ERROR.versionNotSupported,
        `Send "A2A-Version: ${A2A_PROTOCOL_VERSION}"`,
        { supportedVersions: [A2A_PROTOCOL_VERSION] },
      );
    }
    const params = (request.params ?? {}) as Record<string, unknown>;
    switch (request.method) {
      case "SendMessage": {
        const parsed = SendMessageParamsSchema.safeParse(params);
        if (!parsed.success) {
          return rpcError(id, RPC_INVALID_PARAMS, "Invalid SendMessage params");
        }
        return rpcResult(id, { task: this.run(parsed.data.message) });
      }
      case "GetTask": {
        const task = this.tasks.get(String(params.id ?? ""));
        return task
          ? rpcResult(id, task)
          : rpcError(id, A2A_ERROR.taskNotFound, "Task not found");
      }
      case "CancelTask":
        return this.tasks.has(String(params.id ?? ""))
          ? rpcError(id, A2A_ERROR.taskNotCancelable, "Task already finished")
          : rpcError(id, A2A_ERROR.taskNotFound, "Task not found");
      case "SendStreamingMessage":
      case "SubscribeToTask":
      case "ListTasks":
      case "CreateTaskPushNotificationConfig":
      case "GetTaskPushNotificationConfig":
      case "ListTaskPushNotificationConfigs":
      case "DeleteTaskPushNotificationConfig":
      case "GetExtendedAgentCard":
        return rpcError(
          id,
          A2A_ERROR.unsupportedOperation,
          `${request.method} is not supported`,
        );
      default:
        return rpcError(
          id,
          RPC_METHOD_NOT_FOUND,
          `Method not found: ${request.method}`,
        );
    }
  }

  private run(message: {
    parts: Array<{ text?: string; data?: unknown }>;
    contextId?: string;
  }): A2aTask {
    const latest = resolvePortfolio(this.data, undefined);
    const skill = matchSkill(
      message.parts,
      latest?.dealerships.map((d) => ({ id: d.id, name: d.name })) ?? [],
    );
    const result = runSkill(skill, this.data);
    const task: A2aTask = {
      id: randomUUID(),
      contextId: message.contextId ?? randomUUID(),
      status: {
        state: result.ok ? "TASK_STATE_COMPLETED" : "TASK_STATE_FAILED",
        timestamp: new Date().toISOString(),
        ...(result.ok ? {} : { message: agentMessage(result.text) }),
      },
      ...(result.ok
        ? {
            artifacts: [
              {
                artifactId: randomUUID(),
                name: result.name,
                parts: [{ text: result.text }, { data: result.data }],
              },
            ],
          }
        : {}),
    };
    this.tasks.set(task.id, task);
    while (this.tasks.size > A2A_TASK_HISTORY) {
      const oldest = this.tasks.keys().next().value;
      if (oldest === undefined) break;
      this.tasks.delete(oldest);
    }
    return task;
  }
}
