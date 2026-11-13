import { create } from "zustand";
import { containsFigure, type A2uiIssue, type A2uiSurface } from "@shared/a2ui";
import { filterValues } from "@shared/a2ui-data";
import type { Dashboard } from "@shared/types";
import { useAppStore } from "./appStore";

/**
 * AI dashboards: the saved list, the one shown on the dashboard page (null =
 * the standard dashboard) and building or changing one from a chat request.
 * Dashboards are portfolio-independent: they hold the layout and the
 * questions (catalog function calls), the figures come from whichever
 * portfolio is open.
 */

interface DashboardMeta {
  id: string;
  name: string;
  updatedAt: string;
}

export type BuildOutcome =
  | { ok: true; dashboard: Dashboard; created: boolean; repaired: boolean }
  | { ok: false; issues: A2uiIssue[] };

interface DashboardState {
  list: DashboardMeta[];
  /** Shown AI dashboard; null shows the standard dashboard. */
  active: Dashboard | null;
  building: boolean;
  loadList: () => Promise<void>;
  open: (id: string | null) => Promise<void>;
  /** Builds a new dashboard, or changes the shown one (`edit`). */
  build: (prompt: string, mode: "create" | "edit") => Promise<BuildOutcome>;
  /** Saves a ready surface (the starter template) as a new dashboard. */
  saveNew: (surface: A2uiSurface, prompt: string) => Promise<Dashboard>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

const ACTIVE_KEY = "drm-ai-dashboard-active";

function rememberActive(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(ACTIVE_KEY, id);
    else window.localStorage.removeItem(ACTIVE_KEY);
  } catch {
    // Storage can be unavailable; the standard dashboard is the fallback.
  }
}

export function rememberedDashboardId(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  list: [],
  active: null,
  building: false,

  loadList: async () => {
    set({ list: await window.api.listDashboards() });
  },

  open: async (id) => {
    if (!id) {
      set({ active: null });
      rememberActive(null);
      return;
    }
    const dashboard = await window.api.loadDashboard(id);
    set({ active: dashboard });
    rememberActive(dashboard ? dashboard.id : null);
  },

  build: async (prompt, mode) => {
    const current = mode === "edit" ? get().active : null;
    const dealerships = useAppStore.getState().dealerships;
    set({ building: true });
    try {
      const result = await window.api.generateDashboard({
        prompt,
        current: current?.surface ?? null,
        context: {
          locationCount: dealerships.length,
          salesPartners: filterValues(dealerships, "salesPartner"),
          subPortfolios: filterValues(dealerships, "subPortfolio"),
          groups: filterValues(dealerships, "group"),
        },
      });
      if (!result.ok) return { ok: false, issues: result.issues };
      const now = new Date().toISOString();
      const dashboard: Dashboard = current
        ? {
            ...current,
            name: result.surface.title,
            prompt: `${current.prompt}\n${prompt}`.slice(-4000),
            surface: result.surface,
            updatedAt: now,
          }
        : {
            id: crypto.randomUUID(),
            name: result.surface.title,
            createdAt: now,
            updatedAt: now,
            prompt,
            surface: result.surface,
          };
      await window.api.saveDashboard(dashboard);
      set({ active: dashboard });
      rememberActive(dashboard.id);
      await get().loadList();
      return {
        ok: true,
        dashboard,
        created: !current,
        repaired: result.repaired,
      };
    } finally {
      set({ building: false });
    }
  },

  saveNew: async (surface, prompt) => {
    const now = new Date().toISOString();
    const dashboard: Dashboard = {
      id: crypto.randomUUID(),
      name: surface.title,
      createdAt: now,
      updatedAt: now,
      prompt,
      surface,
    };
    await window.api.saveDashboard(dashboard);
    set({ active: dashboard });
    rememberActive(dashboard.id);
    await get().loadList();
    return dashboard;
  },

  rename: async (id, name) => {
    const trimmed = name.trim().slice(0, 80);
    if (!trimmed) return;
    // Same rule as for model titles: a name must not look like a result.
    if (containsFigure(trimmed)) throw new Error("figure-in-name");
    const dashboard =
      get().active?.id === id
        ? get().active
        : await window.api.loadDashboard(id);
    if (!dashboard) return;
    const next = {
      ...dashboard,
      name: trimmed,
      surface: { ...dashboard.surface, title: trimmed },
    };
    await window.api.saveDashboard(next);
    if (get().active?.id === id) set({ active: next });
    await get().loadList();
  },

  remove: async (id) => {
    await window.api.deleteDashboard(id);
    if (get().active?.id === id) {
      set({ active: null });
      rememberActive(null);
    }
    await get().loadList();
  },
}));
