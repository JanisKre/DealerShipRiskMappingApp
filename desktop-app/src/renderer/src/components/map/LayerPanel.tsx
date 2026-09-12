import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  Camera,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Layers,
  Loader2,
  Map,
  MousePointerClick,
  Pencil,
  Zap,
} from "lucide-react";
import type { Peril } from "@shared/types";
import { PERILS } from "@shared/types";
import { Button } from "@renderer/components/ui/button";
import { Checkbox } from "@renderer/components/ui/checkbox";
import { Slider } from "@renderer/components/ui/slider";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@renderer/components/ui/toggle-group";
import { useMapStore, type Basemap } from "@renderer/store/mapStore";
import { ScenarioBuilder } from "./ScenarioBuilder";

const BASEMAP_ORDER: Basemap[] = [
  "satellite",
  "streets",
  "light",
  "dark",
  "terrain",
];

/** Basemap display labels, translated. */
function basemapLabels(t: TFunction): Record<Basemap, string> {
  return {
    satellite: t("map.satellite"),
    streets: t("map.street"),
    light: t("map.layerPanel.basemapLight"),
    dark: t("map.layerPanel.basemapDark"),
    terrain: t("map.layerPanel.basemapTerrain"),
  };
}

/** Collapsible section with a title and optional badge for the active state. */
function Section({
  icon,
  title,
  badge,
  defaultOpen = false,
  children,
}: Readonly<{
  icon?: React.ReactNode;
  title: string;
  badge?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}>): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-1 py-2 text-left"
        aria-expanded={open}
      >
        <ChevronRight
          className={`size-3 shrink-0 text-muted-foreground transition-transform duration-150 ${open ? "rotate-90" : ""}`}
        />
        {icon && <span className="text-muted-foreground">{icon}</span>}
        <span className="flex-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
        {badge && !open && (
          <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            {badge}
          </span>
        )}
      </button>
      {open && <div className="pb-2.5">{children}</div>}
    </div>
  );
}

function LayerToggle({
  label,
  checked,
  onChange,
}: Readonly<{
  label: string;
  checked: boolean;
  onChange: () => void;
}>): React.JSX.Element {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <Checkbox checked={checked} onCheckedChange={onChange} />
      {label}
    </label>
  );
}

export interface LayerPanelProps {
  drawing: boolean;
  onToggleDraw: () => void;
  capturing: boolean;
  onExport: (mode: "save" | "clipboard") => void;
  selectedId: string | null;
}

export function LayerPanel({
  drawing,
  onToggleDraw,
  capturing,
  onExport,
  selectedId,
}: LayerPanelProps): React.JSX.Element {
  const { t } = useTranslation();
  const layers = useMapStore((s) => s.layers);
  const toggleLayer = useMapStore((s) => s.toggleLayer);
  const basemap = useMapStore((s) => s.basemap);
  const setBasemap = useMapStore((s) => s.setBasemap);
  const satelliteOpacity = useMapStore((s) => s.satelliteOpacity);
  const setSatelliteOpacity = useMapStore((s) => s.setSatelliteOpacity);
  const perilOverlay = useMapStore((s) => s.perilOverlay);
  const setPerilOverlay = useMapStore((s) => s.setPerilOverlay);
  const editing = useMapStore((s) => s.editing);
  const setEditing = useMapStore((s) => s.setEditing);
  const detectionEditing = useMapStore((s) => s.detectionEditing);
  const setDetectionEditing = useMapStore((s) => s.setDetectionEditing);

  const activeLayerCount = Object.values(layers).filter(Boolean).length;
  const [open, setOpen] = useState(false);
  const bmLabels = basemapLabels(t);

  return (
    <div className="glass flex flex-col rounded-lg border shadow-lg">
      {/* Fixed header — collapses/expands the entire panel */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-3 py-2.5 text-sm font-semibold"
        aria-expanded={open}
      >
        <Layers className="size-4" />
        {t("map.layerPanel.title")}
        {activeLayerCount > 0 && (
          <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            {t("map.layerPanel.activeCount", { count: activeLayerCount })}
          </span>
        )}
        {open ? (
          <ChevronDown className="size-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 text-muted-foreground" />
        )}
      </button>

      {open && (
        <>
          <div className="px-3">
            {/* Basemap — collapsed, current value as badge */}
            <Section
              icon={<Map className="size-3" />}
              title={t("map.layerPanel.basemapSectionTitle")}
              badge={bmLabels[basemap]}
            >
              <div className="space-y-2">
                <select
                  value={basemap}
                  onChange={(e) => setBasemap(e.target.value as Basemap)}
                  className="w-full rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  aria-label={t("map.layerPanel.basemapSelectAriaLabel")}
                >
                  {BASEMAP_ORDER.map((bm) => (
                    <option key={bm} value={bm}>
                      {bmLabels[bm]}
                    </option>
                  ))}
                </select>
                {basemap === "satellite" && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{t("map.layerPanel.opacityLabel")}</span>
                      <span>{Math.round(satelliteOpacity * 100)} %</span>
                    </div>
                    <Slider
                      min={0.1}
                      max={1}
                      step={0.05}
                      value={satelliteOpacity}
                      onValueChange={setSatelliteOpacity}
                      aria-label={t("map.layerPanel.satelliteOpacityAriaLabel")}
                    />
                  </div>
                )}
              </div>
            </Section>

            {/* Layers — open by default */}
            <Section
              icon={<Layers className="size-3" />}
              title={t("map.layerPanel.title")}
              badge={
                activeLayerCount > 0
                  ? t("map.layerPanel.activeCount", { count: activeLayerCount })
                  : undefined
              }
              defaultOpen
            >
              <div className="space-y-2">
                <LayerToggle
                  label={t("map.layerPanel.boundariesLayerLabel")}
                  checked={layers.boundaries}
                  onChange={() => toggleLayer("boundaries")}
                />
                <LayerToggle
                  label={t("common.vehicles")}
                  checked={layers.detections}
                  onChange={() => toggleLayer("detections")}
                />
                <LayerToggle
                  label={t("map.layerPanel.nearbyInsuredLayerLabel")}
                  checked={layers.nearbyInsured}
                  onChange={() => toggleLayer("nearbyInsured")}
                />
                <LayerToggle
                  label={t("map.layerPanel.accumulationClustersLayerLabel")}
                  checked={layers.accumulationClusters}
                  onChange={() => toggleLayer("accumulationClusters")}
                />
              </div>
            </Section>

            {/* Peril overlays — collapsed, badge when active */}
            <Section
              title={t("map.layerPanel.overlaysSectionTitle")}
              badge={
                perilOverlay
                  ? t(`dashboard.detailDialog.ealPeril.${perilOverlay}`)
                  : undefined
              }
              defaultOpen={!!perilOverlay}
            >
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={perilOverlay ?? ""}
                onValueChange={(v) => setPerilOverlay(v ? (v as Peril) : null)}
                className="grid w-full grid-cols-3 gap-1"
              >
                {PERILS.map((p) => (
                  <ToggleGroupItem
                    key={p}
                    value={p}
                    aria-label={t(`dashboard.detailDialog.ealPeril.${p}`)}
                    className="flex-none rounded-md! border-l! text-xs"
                  >
                    {t(`dashboard.detailDialog.ealPeril.${p}`)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Section>

            {/* Edit boundaries — collapsed */}
            <Section
              icon={<Pencil className="size-3" />}
              title={t("map.boundaries")}
              badge={
                editing ? t("map.layerPanel.editingActiveBadge") : undefined
              }
            >
              <Button
                variant={editing ? "default" : "outline"}
                size="sm"
                className="w-full"
                onClick={() => {
                  setEditing(!editing);
                  if (!editing) setDetectionEditing(false);
                }}
                disabled={!layers.boundaries}
              >
                <Pencil className="size-3" />
                {editing
                  ? t("map.layerPanel.stopEditingButton")
                  : t("map.layerPanel.editBoundariesButton")}
              </Button>
            </Section>

            {/* Manual vehicle review — explicit mode so ordinary map clicks stay safe. */}
            <Section
              icon={<MousePointerClick className="size-3" />}
              title={t("map.layerPanel.detectionEditingTitle")}
              badge={
                detectionEditing
                  ? t("map.layerPanel.detectionEditingActiveBadge")
                  : undefined
              }
            >
              <Button
                variant={detectionEditing ? "default" : "outline"}
                size="sm"
                className="w-full"
                disabled={!layers.detections || !selectedId}
                onClick={() => {
                  setDetectionEditing(!detectionEditing);
                  if (!detectionEditing) setEditing(false);
                }}
              >
                <MousePointerClick className="size-3" />
                {detectionEditing
                  ? t("map.layerPanel.saveDetectionEditsButton")
                  : t("map.layerPanel.editDetectionsButton")}
              </Button>
              {detectionEditing && (
                <p className="mt-1.5 text-[10px] text-muted-foreground">
                  {t("map.layerPanel.detectionEditingHint")}
                </p>
              )}
            </Section>

            {/* Hailstorm scenario — collapsed */}
            <Section
              icon={<Zap className="size-3" />}
              title={t("map.scenario")}
              badge={drawing ? t("map.layerPanel.drawingBadge") : undefined}
            >
              <ScenarioBuilder drawing={drawing} onToggleDraw={onToggleDraw} />
            </Section>
          </div>

          {/* Compact export bar at the bottom */}
          <div className="flex gap-1.5 border-t px-3 py-2">
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 text-xs"
              onClick={() => onExport("save")}
              disabled={capturing}
              title={t("map.layerPanel.saveMapTitle")}
            >
              {capturing ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Camera className="size-3" />
              )}
              {t("common.save")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 text-xs"
              onClick={() => onExport("clipboard")}
              disabled={capturing}
              title={t("map.layerPanel.copyTitle")}
            >
              <Clipboard className="size-3" />
              {t("map.layerPanel.copyButton")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
