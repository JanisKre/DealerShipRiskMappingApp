import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Peril } from "@shared/types";
import type { RiskLevel } from "@renderer/lib/riskColor";

/** Basemap variants. WMS override (from settings) only applies to "satellite". */
export type Basemap = "satellite" | "streets" | "light" | "dark" | "terrain";

/** Layer visibilities. */
export interface MapLayers {
  satellite: boolean;
  boundaries: boolean;
  detections: boolean;
  /** Ring + marker for insured neighbors around the selected location. */
  nearbyInsured: boolean;
  /** Accumulation clusters (>= 2 locations) as radius circles, opacity ~ EAL share. */
  accumulationClusters: boolean;
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
  perilOverlay: Peril | null;
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

  setLayers: (layers: Partial<MapLayers>) => void;
  toggleLayer: (key: keyof MapLayers) => void;
  setBasemap: (basemap: Basemap) => void;
  setSatelliteOpacity: (v: number) => void;
  setPerilOverlay: (p: Peril | null) => void;
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

const DEFAULT_FILTER: MapFilter = {
  query: "",
  riskLevels: [],
  minVehicles: 0,
};

export const useMapStore = create<MapState>()(
  persist(
    (set) => ({
      layers: {
        satellite: true,
        boundaries: true,
        detections: true,
        nearbyInsured: false,
        accumulationClusters: false,
      },
      basemap: "satellite",
      satelliteOpacity: 1,
      perilOverlay: null,
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
      setPerilOverlay: (perilOverlay) => set({ perilOverlay }),
      setEditing: (editing) => set({ editing }),
      setDetectionEditing: (detectionEditing) => set({ detectionEditing }),
      setFilter: (partial) =>
        set((s) => ({ filter: { ...s.filter, ...partial } })),
      resetFilter: () => set({ filter: DEFAULT_FILTER }),
      saveView: (center, zoom) => set({ view: { center, zoom } }),
      toggleLocationsPanel: () =>
        set((s) => ({ locationsPanelOpen: !s.locationsPanelOpen })),
      toggleChatPanel: () => set((s) => ({ chatPanelOpen: !s.chatPanelOpen })),
      openDetailDialog: (id) => set({ detailDialogId: id }),
      closeDetailDialog: () => set({ detailDialogId: null }),
    }),
    {
      name: "drm-map-ui",
      // Only persistent fields — view/filter/layers/basemap/opacity/perilOverlay.
      // `editing` is always false on startup (no persisted edit mode).
      partialize: (s) => ({
        layers: s.layers,
        basemap: s.basemap,
        satelliteOpacity: s.satelliteOpacity,
        perilOverlay: s.perilOverlay,
        filter: s.filter,
        view: s.view,
        locationsPanelOpen: s.locationsPanelOpen,
        chatPanelOpen: s.chatPanelOpen,
      }),
    },
  ),
);
