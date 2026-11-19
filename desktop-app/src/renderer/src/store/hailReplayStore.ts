import { create } from "zustand";
import {
  NO_SHIFT,
  type EventShift,
  type HailEventDetail,
  type HailEventList,
} from "@shared/hail-events";
import type { SimHeading, SimStrength } from "@shared/hail-sim";
import type { HailstormScenario } from "@shared/types";
import { RADAR_HAIL_RADIUS_KM } from "@shared/radar-hail";

/** Replay speeds: radar time per second of playback. */
export const REPLAY_SPEEDS = [
  { id: "slow", msPerSecond: 3 * 60 * 1000 },
  { id: "normal", msPerSecond: 8 * 60 * 1000 },
  { id: "fast", msPerSecond: 25 * 60 * 1000 },
] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number]["id"];

/** The panel's two modes: make a storm, or open a real or saved one. */
export type HailPanelTab = "create" | "open";

/**
 * Where a new storm's path comes from: aimed by the app, from a clicked
 * start point, or along a line drawn on the map.
 */
export type StormPath = "auto" | "start" | "line";

/**
 * What a drawn line becomes: a storm that moves along it (played like a
 * simulation) or a static corridor screened with a return period.
 */
export type DrawKind = "track" | "corridor";

/** Settings a newly drawn corridor starts with. */
export interface CorridorSettings {
  widthKm: number;
  intensityLevel: HailstormScenario["intensityLevel"];
  returnPeriodYears: 10 | 50 | 100;
  exposureMultiplier: number;
}

/** What a map click does while the hail panel is open. */
export type HailMapMode = "pickStart" | "draw" | null;

/**
 * State of the hail simulation and replay on the map. Not persisted: a
 * simulation is played with, not kept (saved scenarios live in the main
 * process); only the panel's settings would be worth keeping, and they
 * have sensible defaults.
 */
interface HailReplayState {
  /** Mode of the layer panel's hail section. */
  tab: HailPanelTab;
  /** How the next storm gets its path. */
  path: StormPath;
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
  /** A drawn line: storm track or corridor; a track uses `sim.strength`. */
  draw: { kind: DrawKind; speedKmh: number };
  /** Settings of the next corridor (the drawn one carries its own). */
  corridor: CorridorSettings;
  /** Points of the track being drawn ([lon, lat]). */
  drawPoints: [number, number][];
  historicDay: string;
  historicLoading: boolean;

  setDetailsOpen: (open: boolean) => void;
  setTab: (tab: HailPanelTab) => void;
  setPath: (path: StormPath) => void;
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
  setCorridor: (patch: Partial<CorridorSettings>) => void;
  setDrawPoints: (points: [number, number][]) => void;
  setHistoricDay: (day: string) => void;
  setHistoricLoading: (loading: boolean) => void;
}

export const useHailReplayStore = create<HailReplayState>((set) => ({
  detailsOpen: false,
  tab: "create",
  path: "auto",
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
  draw: { kind: "track", speedKmh: 50 },
  corridor: {
    widthKm: 20,
    intensityLevel: "HIGH",
    returnPeriodYears: 100,
    exposureMultiplier: 1,
  },
  drawPoints: [],
  historicDay: "2013-07-28",
  historicLoading: false,

  setDetailsOpen: (detailsOpen) => set({ detailsOpen }),
  setTab: (tab) => set({ tab, mapMode: null, drawPoints: [] }),
  setPath: (path) => set({ path, mapMode: null, drawPoints: [] }),
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
  setCorridor: (patch) =>
    set((s) => ({ corridor: { ...s.corridor, ...patch } })),
  setDrawPoints: (drawPoints) => set({ drawPoints }),
  setHistoricDay: (historicDay) => set({ historicDay }),
  setHistoricLoading: (historicLoading) => set({ historicLoading }),
}));
