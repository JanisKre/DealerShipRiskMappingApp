import { create } from "zustand";
import {
  NO_SHIFT,
  type EventShift,
  type HailEventDetail,
  type HailEventList,
} from "@shared/hail-events";

/** Replay speeds: radar time per second of playback. */
export const REPLAY_SPEEDS = [
  { id: "slow", msPerSecond: 2 * 60 * 1000 },
  { id: "normal", msPerSecond: 6 * 60 * 1000 },
  { id: "fast", msPerSecond: 20 * 60 * 1000 },
] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number]["id"];

/**
 * State of the hail event replay on the map. Not persisted: a replay is
 * looked at, not kept, and the events come from the main process.
 */
interface HailReplayState {
  list: HailEventList | null;
  listLoading: boolean;
  listError: string | null;
  /** The loaded event, or null when none is selected. */
  detail: HailEventDetail | null;
  detailLoading: boolean;
  /** Replay clock (Unix ms) within the event. */
  time: number;
  playing: boolean;
  speed: ReplaySpeed;
  /** Event moved on the ground ("what if 30 km further south"). */
  shift: EventShift;

  setList: (list: HailEventList | null) => void;
  setListLoading: (loading: boolean) => void;
  setListError: (error: string | null) => void;
  setDetail: (detail: HailEventDetail | null) => void;
  setDetailLoading: (loading: boolean) => void;
  setTime: (time: number) => void;
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: ReplaySpeed) => void;
  setShift: (shift: EventShift) => void;
}

export const useHailReplayStore = create<HailReplayState>((set) => ({
  list: null,
  listLoading: false,
  listError: null,
  detail: null,
  detailLoading: false,
  time: 0,
  playing: false,
  speed: "normal",
  shift: NO_SHIFT,

  setList: (list) => set({ list }),
  setListLoading: (listLoading) => set({ listLoading }),
  setListError: (listError) => set({ listError }),
  // A new event starts at its beginning, unshifted and paused.
  setDetail: (detail) =>
    set({
      detail,
      time: detail?.summary.timed
        ? detail.summary.start
        : (detail?.summary.end ?? 0),
      playing: false,
      shift: NO_SHIFT,
    }),
  setDetailLoading: (detailLoading) => set({ detailLoading }),
  setTime: (time) => set({ time }),
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  setShift: (shift) => set({ shift }),
}));
