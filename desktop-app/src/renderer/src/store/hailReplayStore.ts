import { create } from "zustand";
import {
  NO_SHIFT,
  type EventShift,
  type HailEventDetail,
  type HailEventList,
} from "@shared/hail-events";
import type { SimHeading, SimStrength } from "@shared/hail-sim";
import { RADAR_HAIL_RADIUS_KM } from "@shared/radar-hail";

/** Replay speeds: radar time per second of playback. */
export const REPLAY_SPEEDS = [
  { id: "slow", msPerSecond: 3 * 60 * 1000 },
  { id: "normal", msPerSecond: 8 * 60 * 1000 },
  { id: "fast", msPerSecond: 25 * 60 * 1000 },
] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number]["id"];

export type HailPanelTab = "simulate" | "draw" | "history" | "library";

/** What a map click does while the hail panel is open. */
export type HailMapMode = "pickStart" | "draw" | null;

/**
 * State of the hail simulation and replay on the map. Not persisted: a
 * simulation is played with, not kept (saved scenarios live in the main
 * process); only the panel's settings would be worth keeping, and they
 * have sensible defaults.
 */
interface HailReplayState {
  /** Creation mode in the layer panel's hail section. */
  tab: HailPanelTab;
  /** The event card's list of reached locations and settings is open. */
  detailsOpen: boolean;
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
  /** A location counts as reached within this distance of a cell. */
  radiusKm: number;
  mapMode: HailMapMode;
  sim: {
    strength: SimStrength;
    heading: SimHeading;
    storms: number;
    seed: number;
  };
  draw: { strength: SimStrength; speedKmh: number };
  /** Points of the track being drawn ([lon, lat]). */
  drawPoints: [number, number][];
  historicDay: string;
  historicLoading: boolean;

  setDetailsOpen: (open: boolean) => void;
  setTab: (tab: HailPanelTab) => void;
  setList: (list: HailEventList | null) => void;
  setListLoading: (loading: boolean) => void;
  setListError: (error: string | null) => void;
  /** Loads an event; `autoplay` starts it at once. */
  setDetail: (detail: HailEventDetail | null, autoplay?: boolean) => void;
  setDetailLoading: (loading: boolean) => void;
  setTime: (time: number) => void;
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: ReplaySpeed) => void;
  setShift: (shift: EventShift) => void;
  setRadiusKm: (km: number) => void;
  setMapMode: (mode: HailMapMode) => void;
  setSim: (patch: Partial<HailReplayState["sim"]>) => void;
  setDraw: (patch: Partial<HailReplayState["draw"]>) => void;
  setDrawPoints: (points: [number, number][]) => void;
  setHistoricDay: (day: string) => void;
  setHistoricLoading: (loading: boolean) => void;
}

export const useHailReplayStore = create<HailReplayState>((set) => ({
  detailsOpen: false,
  tab: "simulate",
  list: null,
  listLoading: false,
  listError: null,
  detail: null,
  detailLoading: false,
  time: 0,
  playing: false,
  speed: "normal",
  shift: NO_SHIFT,
  radiusKm: RADAR_HAIL_RADIUS_KM,
  mapMode: null,
  sim: { strength: "severe", heading: "sw-ne", storms: 5, seed: 1 },
  draw: { strength: "severe", speedKmh: 50 },
  drawPoints: [],
  historicDay: "2013-07-28",
  historicLoading: false,

  setDetailsOpen: (detailsOpen) => set({ detailsOpen }),
  setTab: (tab) => set({ tab, mapMode: null, drawPoints: [] }),
  setList: (list) => set({ list }),
  setListLoading: (listLoading) => set({ listLoading }),
  setListError: (listError) => set({ listError }),
  // A new event starts at its beginning, unshifted.
  setDetail: (detail, autoplay = false) =>
    set({
      detail,
      time: detail?.summary.timed
        ? detail.summary.start
        : (detail?.summary.end ?? 0),
      playing: autoplay && detail?.summary.timed === true,
      shift: NO_SHIFT,
    }),
  setDetailLoading: (detailLoading) => set({ detailLoading }),
  setTime: (time) => set({ time }),
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  setShift: (shift) => set({ shift }),
  setRadiusKm: (radiusKm) => set({ radiusKm }),
  setMapMode: (mapMode) => set({ mapMode, drawPoints: [] }),
  setSim: (patch) => set((s) => ({ sim: { ...s.sim, ...patch } })),
  setDraw: (patch) => set((s) => ({ draw: { ...s.draw, ...patch } })),
  setDrawPoints: (drawPoints) => set({ drawPoints }),
  setHistoricDay: (historicDay) => set({ historicDay }),
  setHistoricLoading: (historicLoading) => set({ historicLoading }),
}));
