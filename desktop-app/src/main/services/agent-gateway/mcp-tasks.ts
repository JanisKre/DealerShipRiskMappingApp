import { randomUUID } from "node:crypto";
import type { AppState } from "@shared/agent-control";
import type { AppControl } from "./app-control";

/**
 * Tasks of the MCP server (extension `io.modelcontextprotocol/tasks`,
 * protocol revision 2026-07-28). `start_analysis` answers a host that
 * declared the extension with a task handle; the host polls `tasks/get`
 * until the analysis has ended and may stop it with `tasks/cancel`.
 *
 * The analysis runs in the app window, not here. A task therefore holds no
 * work of its own: it remembers which run it stands for and asks the window
 * for its state whenever the host polls. Tasks live in memory and end with
 * the app; a host that polls an unknown id gets "task not found" and can
 * read `get_app_state` instead.
 */

export const MCP_TASKS_EXTENSION_ID = "io.modelcontextprotocol/tasks";

/** How long a task can be polled after it was created. */
export const TASK_TTL_MS = 12 * 60 * 60 * 1000;
/** A location takes seconds to minutes: polling faster shows nothing new. */
export const TASK_POLL_INTERVAL_MS = 5_000;
/** Tasks kept at once; the oldest are dropped first. */
export const TASKS_MAX = 32;

/** `input_required` and `failed` never occur: the analysis asks the host nothing. */
export type AnalysisTaskStatus = "working" | "completed" | "cancelled";

/** A tool result, as `tools/call` would have returned it. */
export interface TaskToolResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

interface AnalysisTask {
  taskId: string;
  status: AnalysisTaskStatus;
  statusMessage: string;
  createdAt: number;
  lastUpdatedAt: number;
  /** Locations the analysis was started for. */
  started: number;
  /** The portfolio and run (`analysis.startedAt`) the task stands for. */
  portfolioId: string | null;
  run: number;
  cancelRequested: boolean;
  result?: TaskToolResult;
}

/** A task as `tasks/get` returns it (without `resultType`). */
export interface TaskView {
  taskId: string;
  status: AnalysisTaskStatus;
  statusMessage: string;
  createdAt: string;
  lastUpdatedAt: string;
  ttlMs: number;
  pollIntervalMs: number;
  result?: TaskToolResult;
}

function view(task: AnalysisTask): TaskView {
  return {
    taskId: task.taskId,
    status: task.status,
    statusMessage: task.statusMessage,
    createdAt: new Date(task.createdAt).toISOString(),
    lastUpdatedAt: new Date(task.lastUpdatedAt).toISOString(),
    ttlMs: TASK_TTL_MS,
    pollIntervalMs: TASK_POLL_INTERVAL_MS,
    ...(task.result ? { result: task.result } : {}),
  };
}

function progressText(state: AppState): string {
  const { done, total } = state.analysis;
  return `${done} of ${total} locations`;
}

export class AnalysisTaskStore {
  private readonly tasks = new Map<string, AnalysisTask>();

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * A task for the analysis `start_analysis` has just started; `state` is
   * the window right after the start.
   */
  create(started: number, state: AppState): TaskView {
    this.prune();
    const at = this.now();
    const task: AnalysisTask = {
      // Unguessable: the id is the only handle to the task.
      taskId: randomUUID(),
      status: "working",
      statusMessage: `Analysis of ${started} location${started === 1 ? "" : "s"} started.`,
      createdAt: at,
      lastUpdatedAt: at,
      started,
      portfolioId: state.portfolio.id,
      run: state.analysis.startedAt,
      cancelRequested: false,
    };
    this.tasks.set(task.taskId, task);
    while (this.tasks.size > TASKS_MAX) {
      // Maps keep insertion order: the first key is the oldest task.
      this.tasks.delete(this.tasks.keys().next().value as string);
    }
    return view(task);
  }

  /** The task after asking the window how far the analysis is; null if unknown. */
  async get(taskId: string, control: AppControl): Promise<TaskView | null> {
    const task = this.find(taskId);
    if (!task) return null;
    if (task.status === "working") await this.refresh(task, control);
    return view(task);
  }

  /**
   * Asks the window to stop the analysis the task stands for. Cooperative:
   * the locations in progress are finished first, and the task turns
   * `cancelled` once the window reports the run as ended. Returns whether
   * the task is known.
   */
  async cancel(taskId: string, control: AppControl): Promise<boolean> {
    const task = this.find(taskId);
    if (!task) return false;
    if (task.status !== "working") return true;
    await this.refresh(task, control);
    if (task.status !== "working") return true;
    task.cancelRequested = true;
    // Only this task's own run: the handle must not stop an analysis the
    // user started later.
    const state = await control.run({ type: "getState" });
    if (state.ok && this.isRunning(task, state.state)) {
      await control.run({ type: "stopAnalysis" });
      this.touch(
        task,
        `Stopping after the locations in progress (${progressText(state.state)} done).`,
      );
    }
    return true;
  }

  /** Whether the id names a task that can still be polled. */
  has(taskId: string): boolean {
    return this.find(taskId) != null;
  }

  private find(taskId: string): AnalysisTask | null {
    this.prune();
    return this.tasks.get(taskId) ?? null;
  }

  private prune(): void {
    const at = this.now();
    for (const [id, task] of this.tasks) {
      if (at - task.createdAt >= TASK_TTL_MS) this.tasks.delete(id);
    }
  }

  private touch(task: AnalysisTask, message: string): void {
    if (task.statusMessage === message) return;
    task.statusMessage = message;
    task.lastUpdatedAt = this.now();
  }

  private isSameRun(task: AnalysisTask, state: AppState): boolean {
    return (
      state.portfolio.id === task.portfolioId &&
      state.analysis.startedAt === task.run
    );
  }

  private isRunning(task: AnalysisTask, state: AppState): boolean {
    return this.isSameRun(task, state) && state.analysis.running;
  }

  private async refresh(
    task: AnalysisTask,
    control: AppControl,
  ): Promise<void> {
    const answer = await control.run({ type: "getState" });
    // A window that does not answer says nothing about the analysis: the
    // task stays as it was and the next poll asks again.
    if (!answer.ok) return;
    const state = answer.state;
    if (this.isRunning(task, state)) {
      this.touch(
        task,
        task.cancelRequested
          ? `Stopping after the locations in progress (${progressText(state)} done).`
          : `Analysing: ${progressText(state)} done.`,
      );
      return;
    }
    const sameRun = this.isSameRun(task, state);
    if (task.cancelRequested) {
      task.status = "cancelled";
      this.touch(
        task,
        sameRun
          ? `Stopped on request after ${progressText(state)}. What was analysed so far is kept.`
          : "Stopped on request. What was analysed so far is kept.",
      );
      return;
    }
    task.status = "completed";
    if (!sameRun) {
      // Another portfolio is open or a newer analysis has started: the
      // window no longer shows this run's counts.
      const text =
        "The analysis has ended. The app has since opened another portfolio or started a newer analysis, so the final counts of this run are no longer on screen. Read the results with list_locations.";
      task.result = {
        content: [{ type: "text", text }],
        structuredContent: {
          started: task.started,
          portfolioId: task.portfolioId,
        },
      };
      this.touch(task, text);
      return;
    }
    const { done, total, failed } = state.analysis;
    const data = { started: task.started, ...state };
    task.result = {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: data,
    };
    this.touch(
      task,
      `${
        done < total
          ? `The analysis was stopped in the app after ${progressText(state)}.`
          : `The analysis has ended: ${progressText(state)} processed.`
      } ${failed} location${failed === 1 ? " has" : "s have"} an analysis error.`,
    );
  }
}
