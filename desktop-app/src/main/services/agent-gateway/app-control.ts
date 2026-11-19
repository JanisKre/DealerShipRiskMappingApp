import { randomUUID } from "node:crypto";
import {
  AgentCommandResultSchema,
  AgentCommandSchema,
  type AgentCommand,
  type AgentCommandRequest,
  type AgentCommandResult,
} from "@shared/agent-control";

/**
 * Carries remote-control commands from the gateway's MCP server to the app
 * window and the window's answer back. The window does the work with the
 * same store actions its buttons use; this module only transports and
 * validates: a command is checked before it is sent, an answer before it is
 * passed on, and a window that does not answer gets a timeout instead of a
 * hanging request.
 */

/** A portfolio switch reads the database; everything else is immediate. */
export const CONTROL_TIMEOUT_MS = 15_000;
/** Commands waiting for the window at once; more are refused. */
export const CONTROL_MAX_PENDING = 8;

export interface AppControl {
  run(command: AgentCommand): Promise<AgentCommandResult>;
}

/** Sends a command to the window; false when there is no window to send to. */
export type CommandSender = (request: AgentCommandRequest) => boolean;

export class WindowAppControl implements AppControl {
  private readonly pending = new Map<
    string,
    { resolve: (result: AgentCommandResult) => void; timer: NodeJS.Timeout }
  >();

  constructor(
    private readonly send: CommandSender,
    private readonly timeoutMs = CONTROL_TIMEOUT_MS,
  ) {}

  run(command: AgentCommand): Promise<AgentCommandResult> {
    const parsed = AgentCommandSchema.safeParse(command);
    if (!parsed.success) {
      return Promise.resolve({ ok: false, error: "failed" });
    }
    if (this.pending.size >= CONTROL_MAX_PENDING) {
      return Promise.resolve({
        ok: false,
        error: "noAnswer",
        detail: "too many commands are waiting for the app window",
      });
    }
    const id = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, error: "noAnswer" });
      }, this.timeoutMs);
      this.pending.set(id, { resolve, timer });
      if (!this.trySend({ id, command: parsed.data })) {
        this.settle(id, { ok: false, error: "noAnswer" });
      }
    });
  }

  /**
   * The window's answer (`agent:commandResult`). An unknown id (late or
   * made up) and a malformed answer are ignored; returns whether a waiting
   * command was answered.
   */
  answer(id: string, raw: unknown): boolean {
    if (!this.pending.has(id)) return false;
    const parsed = AgentCommandResultSchema.safeParse(raw);
    this.settle(
      id,
      parsed.success ? parsed.data : { ok: false, error: "failed" },
    );
    return true;
  }

  /** Ends every waiting command (the gateway stops). */
  cancelAll(): void {
    for (const id of [...this.pending.keys()]) {
      this.settle(id, { ok: false, error: "noAnswer" });
    }
  }

  private trySend(request: AgentCommandRequest): boolean {
    try {
      return this.send(request);
    } catch {
      return false;
    }
  }

  private settle(id: string, result: AgentCommandResult): void {
    const waiting = this.pending.get(id);
    if (!waiting) return;
    clearTimeout(waiting.timer);
    this.pending.delete(id);
    waiting.resolve(result);
  }
}
