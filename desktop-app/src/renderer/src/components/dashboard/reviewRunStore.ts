import { create } from "zustand";

/**
 * A review run paused for a boundary correction on the map. The run's queue
 * and the location being corrected survive leaving the dashboard; the map
 * offers to go back, and the dashboard resumes the run at that location.
 * Session-only: a restart forgets it, as it forgets an open dialog.
 */
interface PausedReview {
  ids: string[] | null;
  /** The location whose boundary is being corrected. */
  resumeId: string | null;
  /** Notes of an AI-ordered run, kept so they survive the pause. */
  notes: Record<string, string> | undefined;
  pause: (ids: string[], id: string, notes?: Record<string, string>) => void;
  /** Returns the paused run once and forgets it. */
  take: () => {
    ids: string[];
    id: string;
    notes?: Record<string, string>;
  } | null;
  clear: () => void;
}

export const usePausedReview = create<PausedReview>((set, get) => ({
  ids: null,
  resumeId: null,
  notes: undefined,
  pause: (ids, id, notes) => set({ ids, resumeId: id, notes }),
  take: () => {
    const { ids, resumeId, notes } = get();
    if (!ids || !resumeId) return null;
    set({ ids: null, resumeId: null, notes: undefined });
    return { ids, id: resumeId, notes };
  },
  clear: () => set({ ids: null, resumeId: null, notes: undefined }),
}));
