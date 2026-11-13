import { z } from "zod";

/**
 * A2UI (https://a2ui.org, protocol v1.0) for AI-built dashboards.
 *
 * The model never writes code or numbers. It answers with one A2UI message —
 * `createSurface` for a new dashboard, `updateComponents` to change one —
 * whose components come from the app's own locked catalog below. Data is
 * attached through catalog functions (`{"@call": "ranking", "args": …}`)
 * that the renderer evaluates deterministically on the portfolio, so every
 * figure on screen is computed by the app.
 *
 * This module holds the wire schemas, the catalog and the structural checks
 * (one `root`, known children, no cycles, bounded size and depth). Main
 * validates every model answer with it before anything reaches the renderer;
 * the issue list goes back to the model for one repair attempt, as the A2UI
 * spec recommends (prompt → generate → validate).
 */

export const A2UI_VERSION = "1.0";
/** Opaque catalog id (A2UI catalogs are identified, never fetched). */
export const DRM_DASHBOARD_CATALOG_ID =
  "https://dealership-risk-mapping.app/a2ui/catalogs/dashboard/v1";
export const A2UI_MAX_COMPONENTS = 40;
export const A2UI_MAX_DEPTH = 5;

// --- Values -------------------------------------------------------------

/**
 * Labels must not carry figures: a model that writes "EAL 120.000 €" into a
 * title would present an invented number as a result. Plain counts in
 * wording ("Top 10") stay allowed.
 */
const FIGURE = /(\d[\d.,\s]*\s*(€|eur\b|%|mio\b|tsd\b|mrd\b))|€/i;
export function containsFigure(text: string): boolean {
  return FIGURE.test(text);
}

const Label = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((text) => !containsFigure(text), {
    message: "must not contain amounts or percentages",
  });

export const ComponentIdSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_-]{0,47}$/, "invalid component id");

export const A2UI_MEASURES = ["count", "eal", "exposure", "vehicles"] as const;
export const MeasureSchema = z.enum(A2UI_MEASURES);
export type A2uiMeasure = z.infer<typeof MeasureSchema>;
/** Measures a location can be ranked by (a count of one is not a ranking). */
const RankMeasureSchema = z.enum(["eal", "exposure", "vehicles"]);

export const A2UI_DIMENSIONS = [
  "hailZone",
  "business",
  "salesPartner",
  "subPortfolio",
  "group",
] as const;
export const DimensionSchema = z.enum(A2UI_DIMENSIONS);
export type A2uiDimension = z.infer<typeof DimensionSchema>;

/**
 * Which locations a function looks at. Strict on purpose: an unknown key
 * (a typo like "minZone") must fail validation, not silently widen the
 * selection the dashboard claims to show.
 */
export const FilterSchema = z
  .object({
    minHailZone: z.number().int().min(1).max(6).optional(),
    maxHailZone: z.number().int().min(1).max(6).optional(),
    business: z.enum(["existing", "new"]).optional(),
    salesPartner: z.string().trim().min(1).max(120).optional(),
    subPortfolio: z.string().trim().min(1).max(120).optional(),
    group: z.string().trim().min(1).max(120).optional(),
    /** Only locations whose lot boundary still needs a check. */
    boundaryReview: z.literal(true).optional(),
  })
  .strict()
  .refine(
    (f) =>
      f.minHailZone == null ||
      f.maxHailZone == null ||
      f.minHailZone <= f.maxHailZone,
    { message: "minHailZone must not exceed maxHailZone" },
  );
export type A2uiFilter = z.infer<typeof FilterSchema>;

export const AggregateCallSchema = z
  .object({
    "@call": z.literal("aggregate"),
    args: z
      .object({ measure: MeasureSchema, filter: FilterSchema.optional() })
      .strict(),
  })
  .strict();
export const RankingCallSchema = z
  .object({
    "@call": z.literal("ranking"),
    args: z
      .object({
        measure: RankMeasureSchema,
        limit: z.number().int().min(1).max(25).default(10),
        filter: FilterSchema.optional(),
      })
      .strict(),
  })
  .strict();
export const BreakdownCallSchema = z
  .object({
    "@call": z.literal("breakdown"),
    args: z
      .object({
        measure: MeasureSchema,
        by: DimensionSchema,
        limit: z.number().int().min(1).max(20).default(10),
        filter: FilterSchema.optional(),
      })
      .strict(),
  })
  .strict();
export const LocationsCallSchema = z
  .object({
    "@call": z.literal("locations"),
    args: z
      .object({
        sortBy: RankMeasureSchema,
        limit: z.number().int().min(1).max(50).default(20),
        filter: FilterSchema.optional(),
      })
      .strict(),
  })
  .strict();
export type AggregateCall = z.infer<typeof AggregateCallSchema>;
export type RankingCall = z.infer<typeof RankingCallSchema>;
export type BreakdownCall = z.infer<typeof BreakdownCallSchema>;
export type LocationsCall = z.infer<typeof LocationsCallSchema>;
export type A2uiCall =
  | AggregateCall
  | RankingCall
  | BreakdownCall
  | LocationsCall;

export const TABLE_COLUMNS = [
  "name",
  "hailZone",
  "eal",
  "exposure",
  "vehicles",
  "business",
  "salesPartner",
  "subPortfolio",
  "group",
] as const;
export const TableColumnSchema = z.enum(TABLE_COLUMNS);
export type A2uiTableColumn = z.infer<typeof TableColumnSchema>;

// --- Catalog components --------------------------------------------------

const base = { id: ComponentIdSchema };
function Children(max: number): z.ZodArray<typeof ComponentIdSchema> {
  return z.array(ComponentIdSchema).min(1).max(max);
}

export const A2uiComponentSchema = z.discriminatedUnion("component", [
  z.object({ ...base, component: z.literal("Column"), children: Children(12) }),
  /** Side by side on wide screens (up to four), stacked on narrow ones. */
  z.object({ ...base, component: z.literal("Row"), children: Children(4) }),
  z.object({ ...base, component: z.literal("Heading"), text: Label }),
  z.object({
    ...base,
    component: z.literal("Text"),
    text: z
      .string()
      .trim()
      .min(1)
      .max(400)
      .refine((text) => !containsFigure(text), {
        message: "must not contain amounts or percentages",
      }),
  }),
  z.object({
    ...base,
    component: z.literal("KpiCard"),
    title: Label,
    value: AggregateCallSchema,
  }),
  z.object({
    ...base,
    component: z.literal("BarChart"),
    title: Label,
    data: z.union([RankingCallSchema, BreakdownCallSchema]),
  }),
  z.object({
    ...base,
    component: z.literal("PieChart"),
    title: Label,
    data: BreakdownCallSchema,
  }),
  z.object({
    ...base,
    component: z.literal("Table"),
    title: Label,
    rows: LocationsCallSchema,
    columns: z.array(TableColumnSchema).min(1).max(8).optional(),
  }),
]);
export type A2uiComponent = z.infer<typeof A2uiComponentSchema>;
export const A2UI_COMPONENT_TYPES = [
  "Column",
  "Row",
  "Heading",
  "Text",
  "KpiCard",
  "BarChart",
  "PieChart",
  "Table",
] as const;
const LAYOUT = new Set(["Column", "Row"]);

/** A dashboard as stored and rendered: the components of one surface. */
export const A2uiSurfaceSchema = z.object({
  surfaceId: z.string().min(1).max(80),
  catalogId: z.literal(DRM_DASHBOARD_CATALOG_ID),
  title: Label,
  components: z.array(A2uiComponentSchema).min(1).max(A2UI_MAX_COMPONENTS),
});
export type A2uiSurface = z.infer<typeof A2uiSurfaceSchema>;

// --- Messages (agent → renderer) -----------------------------------------

export const CreateSurfaceMessageSchema = z.object({
  version: z.literal(A2UI_VERSION),
  createSurface: z.object({
    surfaceId: z.string().min(1).max(80),
    catalogId: z.literal(DRM_DASHBOARD_CATALOG_ID),
    components: z.array(A2uiComponentSchema).min(1).max(A2UI_MAX_COMPONENTS),
    metadata: z.object({ title: Label }),
  }),
});
export const UpdateComponentsMessageSchema = z.object({
  version: z.literal(A2UI_VERSION),
  updateComponents: z.object({
    surfaceId: z.string().min(1).max(80),
    components: z.array(A2uiComponentSchema).min(1).max(A2UI_MAX_COMPONENTS),
    /** App extension: ids to drop (A2UI has no component delete). */
    deleteIds: z.array(ComponentIdSchema).max(A2UI_MAX_COMPONENTS).optional(),
    /** App extension: a new dashboard title. */
    title: Label.optional(),
  }),
});
export type CreateSurfaceMessage = z.infer<typeof CreateSurfaceMessageSchema>;
export type UpdateComponentsMessage = z.infer<
  typeof UpdateComponentsMessageSchema
>;

// --- Validation ---------------------------------------------------------

export interface A2uiIssue {
  /** Where, e.g. "components[3].data.args.filter". */
  path: string;
  message: string;
}

function zodIssues(error: z.ZodError, prefix = ""): A2uiIssue[] {
  return error.issues.slice(0, 20).map((issue) => ({
    path:
      prefix +
      issue.path
        .map((p) => (typeof p === "number" ? `[${p}]` : `.${String(p)}`))
        .join("")
        .replace(/^\./, ""),
    message: issue.message,
  }));
}

/**
 * Structural rules of a surface: unique ids, exactly one `root`, every child
 * known, only layout components have children, no cycles, bounded size and
 * depth. Returns an empty list when the tree is sound.
 */
export function surfaceIssues(components: A2uiComponent[]): A2uiIssue[] {
  const issues: A2uiIssue[] = [];
  const byId = new Map<string, A2uiComponent>();
  for (const c of components) {
    if (byId.has(c.id))
      issues.push({ path: c.id, message: "duplicate component id" });
    byId.set(c.id, c);
  }
  const root = byId.get("root");
  if (!root) {
    issues.push({
      path: "root",
      message: 'a component with id "root" is required',
    });
    return issues;
  }
  if (!LAYOUT.has(root.component))
    issues.push({ path: "root", message: "root must be a Column or Row" });

  const seen = new Set<string>();
  const visit = (id: string, depth: number, trail: string[]): void => {
    const c = byId.get(id);
    if (!c) {
      issues.push({
        path: trail.join(" > "),
        message: `unknown child "${id}"`,
      });
      return;
    }
    if (trail.includes(id)) {
      issues.push({ path: trail.join(" > "), message: `cycle at "${id}"` });
      return;
    }
    if (depth > A2UI_MAX_DEPTH) {
      issues.push({
        path: id,
        message: `nesting deeper than ${A2UI_MAX_DEPTH}`,
      });
      return;
    }
    if (seen.has(id)) {
      issues.push({ path: id, message: "component used more than once" });
      return;
    }
    seen.add(id);
    if (c.component === "Column" || c.component === "Row") {
      for (const child of c.children) visit(child, depth + 1, [...trail, id]);
    }
  };
  visit("root", 1, []);
  return issues;
}

/** Keeps the components reachable from `root`, in tree order. */
export function pruneSurface(components: A2uiComponent[]): A2uiComponent[] {
  const byId = new Map(components.map((c) => [c.id, c]));
  const out: A2uiComponent[] = [];
  const seen = new Set<string>();
  const visit = (id: string): void => {
    const c = byId.get(id);
    if (!c || seen.has(id)) return;
    seen.add(id);
    out.push(c);
    if (c.component === "Column" || c.component === "Row")
      c.children.forEach(visit);
  };
  visit("root");
  return out;
}

export type ApplyResult =
  | { ok: true; surface: A2uiSurface }
  | { ok: false; issues: A2uiIssue[] };

/**
 * Validates one agent answer and applies it: `createSurface` starts a new
 * surface, `updateComponents` upserts into `current` (and removes
 * `deleteIds`). The result is pruned to what `root` reaches and checked
 * again, so a stored surface is always sound.
 */
export function applyAgentMessage(
  raw: unknown,
  current: A2uiSurface | null,
): ApplyResult {
  const isUpdate =
    typeof raw === "object" && raw !== null && "updateComponents" in raw;
  let components: A2uiComponent[];
  let title: string;
  let surfaceId: string;
  if (isUpdate) {
    if (!current)
      return {
        ok: false,
        issues: [
          { path: "", message: "updateComponents needs an existing surface" },
        ],
      };
    const parsed = UpdateComponentsMessageSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, issues: zodIssues(parsed.error) };
    const message = parsed.data.updateComponents;
    const removed = new Set(message.deleteIds ?? []);
    const merged = new Map(
      current.components
        .filter((c) => !removed.has(c.id))
        .map((c) => [c.id, c]),
    );
    for (const c of message.components) merged.set(c.id, c);
    components = [...merged.values()];
    title = message.title ?? current.title;
    surfaceId = current.surfaceId;
  } else {
    const parsed = CreateSurfaceMessageSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, issues: zodIssues(parsed.error) };
    components = parsed.data.createSurface.components;
    title = parsed.data.createSurface.metadata.title;
    surfaceId = parsed.data.createSurface.surfaceId;
  }
  const structural = surfaceIssues(components);
  if (structural.length > 0) return { ok: false, issues: structural };
  const pruned = pruneSurface(components);
  const surface = A2uiSurfaceSchema.safeParse({
    surfaceId,
    catalogId: DRM_DASHBOARD_CATALOG_ID,
    title,
    components: pruned,
  });
  if (!surface.success) return { ok: false, issues: zodIssues(surface.error) };
  return { ok: true, surface: surface.data };
}

export interface DefaultDashboardLabels {
  title: string;
  count: string;
  eal: string;
  exposure: string;
  vehicles: string;
  byZone: string;
  topEal: string;
  table: string;
}

/**
 * Deterministic starter dashboard (used without an AI provider): key
 * figures, locations per hail zone, the highest hail EAL and a table.
 */
export function defaultDashboardSurface(
  labels: DefaultDashboardLabels,
  surfaceId = "default",
): A2uiSurface {
  return A2uiSurfaceSchema.parse({
    surfaceId,
    catalogId: DRM_DASHBOARD_CATALOG_ID,
    title: labels.title,
    components: [
      {
        id: "root",
        component: "Column",
        children: ["kpis", "charts", "table"],
      },
      { id: "kpis", component: "Row", children: ["k1", "k2", "k3", "k4"] },
      {
        id: "k1",
        component: "KpiCard",
        title: labels.count,
        value: { "@call": "aggregate", args: { measure: "count" } },
      },
      {
        id: "k2",
        component: "KpiCard",
        title: labels.eal,
        value: { "@call": "aggregate", args: { measure: "eal" } },
      },
      {
        id: "k3",
        component: "KpiCard",
        title: labels.exposure,
        value: { "@call": "aggregate", args: { measure: "exposure" } },
      },
      {
        id: "k4",
        component: "KpiCard",
        title: labels.vehicles,
        value: { "@call": "aggregate", args: { measure: "vehicles" } },
      },
      { id: "charts", component: "Row", children: ["zones", "top"] },
      {
        id: "zones",
        component: "BarChart",
        title: labels.byZone,
        data: {
          "@call": "breakdown",
          args: { measure: "count", by: "hailZone" },
        },
      },
      {
        id: "top",
        component: "BarChart",
        title: labels.topEal,
        data: { "@call": "ranking", args: { measure: "eal", limit: 10 } },
      },
      {
        id: "table",
        component: "Table",
        title: labels.table,
        rows: { "@call": "locations", args: { sortBy: "eal", limit: 20 } },
      },
    ],
  });
}

/**
 * Compact catalog description for the model prompt (kept next to the
 * schemas so the two cannot drift apart unnoticed).
 */
export const A2UI_CATALOG_PROMPT = `Catalog "${DRM_DASHBOARD_CATALOG_ID}" (A2UI v1.0). Components (flat list, children referenced by id; exactly one component has id "root" and is a Column or Row):
- {"id","component":"Column","children":[ids, max 12]} — vertical stack
- {"id","component":"Row","children":[ids, max 4]} — side by side
- {"id","component":"Heading","text"}
- {"id","component":"Text","text"} — short explanation, no figures
- {"id","component":"KpiCard","title","value":<aggregate call>}
- {"id","component":"BarChart","title","data":<ranking call | breakdown call>}
- {"id","component":"PieChart","title","data":<breakdown call>} — use for shares with few categories
- {"id","component":"Table","title","rows":<locations call>,"columns":[${TABLE_COLUMNS.map((c) => `"${c}"`).join(",")}] (optional)}
Function calls (the app computes all values; you never write numbers):
- {"@call":"aggregate","args":{"measure":M,"filter":F?}} — one number
- {"@call":"ranking","args":{"measure":R,"limit":1-25,"filter":F?}} — top locations
- {"@call":"breakdown","args":{"measure":M,"by":D,"limit":1-20,"filter":F?}} — grouped totals
- {"@call":"locations","args":{"sortBy":R,"limit":1-50,"filter":F?}} — table rows
M = ${A2UI_MEASURES.map((m) => `"${m}"`).join("|")} (eal = expected annual hail loss in EUR, exposure = vehicle value in EUR)
R = "eal"|"exposure"|"vehicles"
D = ${A2UI_DIMENSIONS.map((d) => `"${d}"`).join("|")} (business = existing vs new business)
F = {"minHailZone":1-6,"maxHailZone":1-6,"business":"existing"|"new","salesPartner":S,"subPortfolio":S,"group":S,"boundaryReview":true} — only these keys; S must be one of the listed values.`;
