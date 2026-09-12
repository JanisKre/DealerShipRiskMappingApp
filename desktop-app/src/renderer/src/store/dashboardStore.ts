import { create } from "zustand";
import type { AnalyzedDealership, Dashboard, DashboardSpec } from "@shared/types";

/**
 * Store for generated AI dashboards: a list of persisted dashboards
 * (left) plus the currently open/generated dashboard (right). Persistence
 * runs over SQLite (`window.api.*Dashboard*`). Unlike chat, generation
 * runs via invoke (no stream) — no committed-ref dance needed.
 */

/** Sentinel title for a dashboard that hasn't been named yet. */
export const NEW_DASHBOARD_TITLE = "New Dashboard";

interface DashboardMeta {
  id: string;
  name: string;
  updatedAt: string;
}

interface DashboardState {
  list: DashboardMeta[];
  activeId: string | null;
  activeName: string;
  activeCreatedAt: string | null;
  activePrompt: string;
  activeSpec: DashboardSpec | null;
  generating: boolean;
  error: string | null;

  loadList: () => Promise<void>;
  selectDashboard: (id: string) => Promise<void>;
  newDashboard: () => void;
  generate: (prompt: string, dealerships: AnalyzedDealership[]) => Promise<void>;
  persistActive: () => Promise<void>;
  deleteDashboard: (id: string) => Promise<void>;
}

/** Title heuristic: first line of the prompt, truncated to ~40 characters. */
function deriveTitle(prompt: string): string {
  const line = prompt.split("\n")[0]?.trim() ?? "";
  if (!line) return NEW_DASHBOARD_TITLE;
  return line.length > 40 ? `${line.slice(0, 40).trimEnd()}…` : line;
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  list: [],
  activeId: null,
  activeName: NEW_DASHBOARD_TITLE,
  activeCreatedAt: null,
  activePrompt: "",
  activeSpec: null,
  generating: false,
  error: null,

  loadList: async () => {
    const list = await window.api.listDashboards();
    set({ list });
  },

  selectDashboard: async (id) => {
    const dash = await window.api.loadDashboard(id);
    if (!dash) return;
    set({
      activeId: dash.id,
      activeName: dash.name,
      activeCreatedAt: dash.createdAt,
      activePrompt: dash.prompt,
      activeSpec: dash.spec,
      generating: false,
      error: null,
    });
  },

  newDashboard: () => {
    set({
      activeId: null,
      activeName: NEW_DASHBOARD_TITLE,
      activeCreatedAt: null,
      activePrompt: "",
      activeSpec: null,
      generating: false,
      error: null,
    });
  },

  generate: async (prompt, dealerships) => {
    set({
      generating: true,
      error: null,
      activeId: null,
      activeName: deriveTitle(prompt),
      activePrompt: prompt,
      activeSpec: null,
      activeCreatedAt: new Date().toISOString(),
    });
    try {
      // The main side falls back to a valid default spec when the key is
      // missing or the response is invalid — we always get something renderable.
      const spec = await window.api.llmDashboardSpec(prompt, dealerships.length);
      set({ activeSpec: spec, generating: false });
      await get().persistActive();
    } catch (e) {
      set({
        generating: false,
        error: e instanceof Error ? e.message : "Generation failed",
      });
    }
  },

  persistActive: async () => {
    const { activeId, activeName, activeCreatedAt, activePrompt, activeSpec } =
      get();
    if (!activeSpec) return;
    const now = new Date().toISOString();
    const id = activeId ?? crypto.randomUUID();
    const dashboard: Dashboard = {
      id,
      name: activeName,
      createdAt: activeCreatedAt ?? now,
      updatedAt: now,
      prompt: activePrompt,
      spec: activeSpec,
    };
    set({ activeId: id, activeCreatedAt: dashboard.createdAt });
    await window.api.saveDashboard(dashboard);
    await get().loadList();
  },

  deleteDashboard: async (id) => {
    await window.api.deleteDashboard(id);
    if (get().activeId === id) get().newDashboard();
    await get().loadList();
  },
}));
