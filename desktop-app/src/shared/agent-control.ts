import { z } from "zod";

/**
 * Remote control of the app window through the agent gateway's MCP server
 * (docs/agent-protocols.md). Off by default and switched on separately from
 * the read-only tools.
 *
 * A command names something the user can do with a click: open a saved
 * portfolio, show a location, change the page, start or stop an analysis.
 * It carries ids and enum values only: no file path, no URL, no free text
 * that ends up in the data. The main process validates a command before it
 * reaches the window and the window's answer before it leaves the app.
 */

export const APP_VIEWS = [
  "map",
  "dashboard",
  "parameters",
  "settings",
] as const;
export type AppView = (typeof APP_VIEWS)[number];

/** Route of each view (router config in the renderer's `App.tsx`). */
export const APP_VIEW_ROUTES: Record<AppView, string> = {
  map: "/",
  dashboard: "/dashboard",
  parameters: "/parameters",
  settings: "/settings",
};

export function viewOfRoute(pathname: string): AppView {
  const match = (Object.entries(APP_VIEW_ROUTES) as Array<[AppView, string]>)
    .filter(([, route]) => route !== "/")
    .find(([, route]) => pathname.startsWith(route));
  return match?.[0] ?? "map";
}

/** Locations one analysis command may name. */
export const CONTROL_MAX_LOCATIONS = 500;

const Ref = z.string().trim().min(1).max(200);

export const ANALYSIS_SCOPES = ["unanalysed", "all"] as const;

export const AgentCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("getState") }),
  z.object({ type: z.literal("openPortfolio"), portfolioId: Ref }),
  z.object({
    type: z.literal("showLocation"),
    /** Location id, or its exact name when that is unique. */
    location: Ref,
    /** Also open the detail dialog (evidence, sources, limitations). */
    details: z.boolean(),
  }),
  z.object({ type: z.literal("openView"), view: z.enum(APP_VIEWS) }),
  z.object({
    type: z.literal("startAnalysis"),
    /** Ids or exact names; omitted, `scope` picks the locations. */
    locations: z.array(Ref).min(1).max(CONTROL_MAX_LOCATIONS).optional(),
    scope: z.enum(ANALYSIS_SCOPES),
  }),
  z.object({ type: z.literal("stopAnalysis") }),
]);
export type AgentCommand = z.infer<typeof AgentCommandSchema>;

/** What the window shows right now. No notes, addresses or coordinates. */
export const AppStateSchema = z.object({
  view: z.enum(APP_VIEWS),
  portfolio: z.object({
    /** null: a new portfolio that has not been saved yet. */
    id: z.string().max(200).nullable(),
    name: z.string().max(300),
    locations: z.number().int().nonnegative(),
    analyzed: z.number().int().nonnegative(),
    /** False while changes wait for the automatic save. */
    saved: z.boolean(),
  }),
  selectedLocation: z
    .object({ id: z.string().max(200), name: z.string().max(300) })
    .nullable(),
  /** Location whose detail dialog is open. */
  detailsOpenFor: z.string().max(200).nullable(),
  analysis: z.object({
    running: z.boolean(),
    done: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    /** Imported rows of an interrupted run that still wait. */
    waiting: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
});
export type AppState = z.infer<typeof AppStateSchema>;

export const AGENT_COMMAND_ERRORS = [
  "unknownPortfolio",
  "unknownLocation",
  /** Several locations carry the name; the id is needed. */
  "ambiguousLocation",
  "analysisRunning",
  "nothingToAnalyse",
  "noAnalysisRunning",
  /** The window did not answer in time (closed, busy or still loading). */
  "noAnswer",
  "failed",
] as const;
export type AgentCommandError = (typeof AGENT_COMMAND_ERRORS)[number];

export const AgentCommandResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    /** The window after the command. */
    state: AppStateSchema,
    /** Locations an analysis was started for. */
    started: z.number().int().nonnegative().optional(),
  }),
  z.object({
    ok: z.literal(false),
    error: z.enum(AGENT_COMMAND_ERRORS),
    /** The reference that was not found, or a short technical message. */
    detail: z.string().max(300).optional(),
  }),
]);
export type AgentCommandResult = z.infer<typeof AgentCommandResultSchema>;

/** A command on its way to the window (`agent:command`, main → renderer). */
export const AgentCommandRequestSchema = z.object({
  id: z.string().uuid(),
  command: AgentCommandSchema,
});
export type AgentCommandRequest = z.infer<typeof AgentCommandRequestSchema>;

/**
 * The location a reference means: its id, else the one location with
 * exactly this name (case and surrounding spaces ignored). Models pass
 * names as readily as ids.
 */
export function resolveLocationRef<T extends { id: string; name: string }>(
  locations: readonly T[],
  ref: string,
): { found: T } | { error: "unknownLocation" | "ambiguousLocation" } {
  const byId = locations.find((l) => l.id === ref);
  if (byId) return { found: byId };
  const wanted = ref.trim().toLowerCase();
  const byName = locations.filter(
    (l) => l.name.trim().toLowerCase() === wanted,
  );
  if (byName.length === 1) return { found: byName[0] };
  return { error: byName.length > 1 ? "ambiguousLocation" : "unknownLocation" };
}
