import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PinnedWayback } from "@shared/imagery-wayback";
import type { RiskLevel } from "@renderer/lib/riskColor";
import {
  DEFAULT_DETECTION_DISPLAY,
  normalizeDetectionDisplay,
  type DetectionDisplay,
} from "@renderer/lib/detectionDisplay";

/** Basemap variants. WMS override (from settings) only applies to "satellite". */
export type Basemap = "satellite" | "official" | "streets" | "terrain";

export const BASEMAPS: readonly Basemap[] = [
  "satellite",
  "official",
  "streets",
  "terrain",
];

function isBasemap(value: unknown): value is Basemap {
  return (BASEMAPS as readonly unknown[]).includes(value);
}

/**
 * Below this window width (Tailwind `xl`) the chat dock and the sidebar start
 * collapsed, so the map keeps a usable width next to the locations dock.
 */
export const WIDE_WINDOW_PX = 1280;

/** Layer visibilities. */
export interface MapLayers {
  satellite: boolean;
  boundaries: boolean;
  detections: boolean;
  /** Ring + marker for insured neighbors around the selected location. */
  nearbyInsured: boolean;
  /** Accumulation clusters (>= 2 locations) as radius circles, opacity ~ EAL share. */
  accumulationClusters: boolean;
  /** Postcode areas colored by hail zone (outlines downloaded on first use). */
  hailZones: boolean;
  /** Cadastral parcel (Flurstück) outlines from the state WMS, zoom 17+. */
  parcels: boolean;
}

/** Search and filter options. */
export interface MapFilter {
  query: string;
  /** Filtered risk levels — empty set = show all. */
  riskLevels: RiskLevel[];
  /** Minimum number of detected vehicles (0 = no filter). */
  minVehicles: number;
}

/** Last map viewport. Restored on mount. */
export interface MapView {
  center: [number, number];
  zoom: number;
}

interface MapState {
  layers: MapLayers;
  basemap: Basemap;
  /** Opacity of the satellite layer (0..1). */
  satelliteOpacity: number;
  /**
   * Esri Wayback version shown instead of the automatic imagery choice
   * (`null` = automatic). Not persisted: a historical basemap must not
   * silently reappear on the next start.
   */
  pinnedWayback: PinnedWayback | null;
  /**
   * Show the image a selected site's vehicles were counted on instead of the
   * automatic choice (default). The imagery version list can switch it off.
   * Not persisted.
   */
  useCountedImage: boolean;
  /** How detected vehicles are drawn (settings page, persisted). */
  detectionDisplay: DetectionDisplay;
  editing: boolean;
  detectionEditing: boolean;
  filter: MapFilter;
  /** `null` if no view has been saved yet — then fit-all. */
  view: MapView | null;
  /** Whether the locations panel (left) is expanded. */
  locationsPanelOpen: boolean;
  /** Whether the chat panel (right in the workspace) is expanded. */
  chatPanelOpen: boolean;
  /** ID of the location whose detail dialog is open in the workspace (`null` = closed). */
  detailDialogId: string | null;
  /**
   * Ids of the locations list as shown (sorted, searched, filtered), so the
   * detail dialog pages in the order the list has. Not persisted.
   */
  locationsOrder: string[];
  setLocationsOrder: (ids: string[]) => void;

  setLayers: (layers: Partial<MapLayers>) => void;
  toggleLayer: (key: keyof MapLayers) => void;
  setBasemap: (basemap: Basemap) => void;
  setSatelliteOpacity: (v: number) => void;
  setPinnedWayback: (v: PinnedWayback | null) => void;
  setUseCountedImage: (v: boolean) => void;
  setDetectionDisplay: (v: Partial<DetectionDisplay>) => void;
  setEditing: (v: boolean) => void;
  setDetectionEditing: (v: boolean) => void;
  setFilter: (f: Partial<MapFilter>) => void;
  resetFilter: () => void;
  saveView: (center: [number, number], zoom: number) => void;
  toggleLocationsPanel: () => void;
  toggleChatPanel: () => void;
  openDetailDialog: (id: string) => void;
  closeDetailDialog: () => void;
}

/**
 * Layers the layer panel offers as toggles. `satellite` is not one of them
 * (the basemap select covers it), so it must not count as "active".
 */
export const PANEL_LAYER_KEYS: readonly (keyof MapLayers)[] = [
  "parcels",
  "boundaries",
  "detections",
  "nearbyInsured",
  "accumulationClusters",
  "hailZones",
];

/** How many of the given toggles are on (default: all panel toggles). */
export function countActiveLayers(
  layers: MapLayers,
  keys: readonly (keyof MapLayers)[] = PANEL_LAYER_KEYS,
): number {
  return keys.filter((key) => layers[key]).length;
}

const DEFAULT_LAYERS: MapLayers = {
  satellite: true,
  boundaries: true,
  detections: true,
  nearbyInsured: false,
  accumulationClusters: false,
  hailZones: false,
  parcels: false,
};

/**
 * Merges the persisted UI state into the defaults. Layers saved before a
 * layer existed keep its default, and basemaps that were removed (the
 * former "light" and "dark" CARTO maps) fall back to streets. Detection
 * display options are checked field by field.
 */
export function mergePersistedMapState<
  T extends {
    layers: MapLayers;
    basemap: Basemap;
    detectionDisplay: DetectionDisplay;
  },
>(persisted: unknown, current: T): T {
  if (!persisted || typeof persisted !== "object") return current;
  const saved = persisted as {
    layers?: unknown;
    basemap?: unknown;
    detectionDisplay?: unknown;
  };
  const layers =
    saved.layers && typeof saved.layers === "object"
      ? { ...current.layers, ...saved.layers }
      : current.layers;
  let basemap = current.basemap;
  if (saved.basemap !== undefined) {
    basemap = isBasemap(saved.basemap) ? saved.basemap : "streets";
  }
  const detectionDisplay =
    saved.detectionDisplay === undefined
      ? current.detectionDisplay
      : normalizeDetectionDisplay(saved.detectionDisplay);
  return { ...current, ...persisted, layers, basemap, detectionDisplay };
}

const DEFAULT_FILTER: MapFilter = {
  query: "",
  riskLevels: [],
  minVehicles: 0,
};

export const useMapStore = create<MapState>()(
  persist(
    (set) => ({
      layers: DEFAULT_LAYERS,
      basemap: "satellite",
      satelliteOpacity: 1,
      pinnedWayback: null,
      useCountedImage: true,
      detectionDisplay: DEFAULT_DETECTION_DISPLAY,
      editing: false,
      detectionEditing: false,
      filter: DEFAULT_FILTER,
      view: null,
      locationsPanelOpen: true,
      chatPanelOpen: true,
      detailDialogId: null,

      setLayers: (partial) =>
        set((s) => ({ layers: { ...s.layers, ...partial } })),
      toggleLayer: (key) =>
        set((s) => ({ layers: { ...s.layers, [key]: !s.layers[key] } })),
      setBasemap: (basemap) => set({ basemap }),
      setSatelliteOpacity: (satelliteOpacity) => set({ satelliteOpacity }),
      setPinnedWayback: (pinnedWayback) => set({ pinnedWayback }),
      setUseCountedImage: (useCountedImage) => set({ useCountedImage }),
      setDetectionDisplay: (partial) =>
        set((s) => ({
          detectionDisplay: { ...s.detectionDisplay, ...partial },
        })),
      setEditing: (editing) => set({ editing }),
      setDetectionEditing: (detectionEditing) => set({ detectionEditing }),
      setFilter: (partial) =>
        set((s) => ({ filter: { ...s.filter, ...partial } })),
      resetFilter: () => set({ filter: DEFAULT_FILTER }),
      saveView: (center, zoom) => set({ view: { center, zoom } }),
      toggleLocationsPanel: () =>
        set((s) => ({ locationsPanelOpen: !s.locationsPanelOpen })),
      toggleChatPanel: () => set((s) => ({ chatPanelOpen: !s.chatPanelOpen })),
      locationsOrder: [],
      setLocationsOrder: (locationsOrder) => set({ locationsOrder }),
      openDetailDialog: (id) => set({ detailDialogId: id }),
      closeDetailDialog: () => set({ detailDialogId: null }),
    }),
    {
      name: "drm-map-ui",
      merge: (persisted, current) => mergePersistedMapState(persisted, current),
      // Only persistent fields — view/filter/layers/basemap/opacity and
      // the detection display options.
      // `editing` is always false on startup (no persisted edit mode).
      partialize: (s) => ({
        layers: s.layers,
        basemap: s.basemap,
        satelliteOpacity: s.satelliteOpacity,
        detectionDisplay: s.detectionDisplay,
        filter: s.filter,
        view: s.view,
        locationsPanelOpen: s.locationsPanelOpen,
        chatPanelOpen: s.chatPanelOpen,
      }),
    },
  ),
);
