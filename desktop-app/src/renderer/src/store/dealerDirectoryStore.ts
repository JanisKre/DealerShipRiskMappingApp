import { create } from "zustand";
import type {
  DealerDirectoryChunk,
  DealerDirectoryStatus,
} from "@shared/ipc-schema";

type Progress = Extract<DealerDirectoryChunk, { type: "progress" }>;

interface DealerDirectoryState {
  /** `undefined` until loaded from main; `null` when never downloaded. */
  status: DealerDirectoryStatus | null | undefined;
  running: boolean;
  progress: Progress | null;
  error: string | null;
  loadStatus: () => Promise<void>;
  startRefresh: () => void;
  cancelRefresh: () => void;
}

/**
 * State of the Overture dealer-directory download. Kept outside the settings
 * page so a multi-minute download keeps reporting while the user works on
 * the map.
 */
let cancelActive: (() => void) | null = null;

export const useDealerDirectoryStore = create<DealerDirectoryState>(
  (set, get) => ({
    status: undefined,
    running: false,
    progress: null,
    error: null,

    loadStatus: async () => {
      try {
        set({ status: await window.api.dealerDirectoryStatus() });
      } catch (err) {
        console.error("Dealer directory status failed:", err);
        set({ status: null });
      }
    },

    startRefresh: () => {
      if (get().running) return;
      set({ running: true, progress: null, error: null });
      cancelActive = window.api.refreshDealerDirectory((chunk) => {
        if (chunk.type === "progress") {
          set({ progress: chunk });
        } else if (chunk.type === "done") {
          cancelActive = null;
          set({ running: false, progress: null, status: chunk.status });
        } else {
          cancelActive = null;
          set({ running: false, progress: null, error: chunk.message });
        }
      });
    },

    cancelRefresh: () => {
      cancelActive?.();
      cancelActive = null;
      set({ running: false, progress: null });
    },
  }),
);
