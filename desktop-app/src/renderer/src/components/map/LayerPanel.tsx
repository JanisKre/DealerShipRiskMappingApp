import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  Camera,
  ChevronDown,
  CloudHail,
  ChevronRight,
  Clipboard,
  Layers,
  Loader2,
  Map,
  MousePointerClick,
  Pencil,
  Zap,
} from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import { Checkbox } from "@renderer/components/ui/checkbox";
import { Label } from "@renderer/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import {
  waybackCandidateForVersion,
  type ImageryTimeline,
} from "@shared/imagery-wayback";
import { imageryCandidateSummary } from "@renderer/lib/imageryFormat";
import type { ImageryCandidate } from "@shared/imagery-sources";
import {
  BASEMAPS,
  countActiveLayers,
  useMapStore,
  type Basemap,
  type MapLayers,
} from "@renderer/store/mapStore";
import { ScenarioBuilder } from "./ScenarioBuilder";
import { HailSimSection } from "./HailSimSection";
import { useHailReplayStore } from "@renderer/store/hailReplayStore";
import {
  PANEL_ACTION_CLASS,
  PANEL_CONTROL_CLASS,
  PANEL_HINT_CLASS,
} from "./panelStyles";

/** Basemap display labels, translated. */
function basemapLabels(t: TFunction): Record<Basemap, string> {
  return {
    satellite: t("map.satellite"),
    official: t("map.layerPanel.basemapOfficial"),
    streets: t("map.street"),
    terrain: t("map.layerPanel.basemapTerrain"),
  };
}

/** Collapsible section with a title and optional badge for the active state. */
function Section({
  icon,
  title,
  badge,
  defaultOpen = false,
  forceOpen = false,
  children,
}: Readonly<{
  icon?: React.ReactNode;
  title: string;
  badge?: string;
  defaultOpen?: boolean;
  /** Opens the section when it turns true (e.g. editing started elsewhere). */
  forceOpen?: boolean;
  children: React.ReactNode;
}>): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen || forceOpen);
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);
  return (
    <div className="border-t first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 rounded-sm px-1 py-2 text-left focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        aria-expanded={open}
      >
        <ChevronRight
          className={`size-3 shrink-0 text-muted-foreground transition-transform duration-150 ${open ? "rotate-90" : ""}`}
        />
        {icon && <span className="text-muted-foreground">{icon}</span>}
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-muted-foreground">
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
    // Long labels wrap in a narrow panel instead of being clipped.
    <label className="flex cursor-pointer items-start gap-2 text-sm leading-snug">
      <Checkbox
        checked={checked}
        onCheckedChange={onChange}
        className="mt-px shrink-0"
      />
      <span className="min-w-0">{label}</span>
    </label>
  );
}

/** Toggles in the "overlays" section (parcels sit with the basemap). */
const OVERLAY_KEYS: readonly (keyof MapLayers)[] = [
  "boundaries",
  "detections",
  "nearbyInsured",
  "accumulationClusters",
  "hailZones",
];

export interface LayerPanelProps {
  drawing: boolean;
  onToggleDraw: () => void;
  capturing: boolean;
  onExport: (mode: "save" | "clipboard") => void;
  selectedId: string | null;
  detectionEditing: boolean;
  onStartDetectionEditing: () => void;
  onSaveDetectionEdits: () => void;
  onCancelDetectionEdits: () => void;
  /** Wayback versions at the map centre; null below the selection zoom. */
  imageryTimeline: ImageryTimeline | null;
  imageryTimelineLoading: boolean;
  /** False when the basemap is not satellite or a custom WMS replaces Esri. */
  imageryTimelineAvailable: boolean;
  /** Counted image of the selected site (null when none or out of view). */
  countedImagery: ImageryCandidate | null;
  /** What automatic selection yields at the map centre (null while loading). */
  autoImagery: ImageryCandidate | null;
}

const AUTO_IMAGERY = "auto";
const COUNTED_IMAGERY = "counted";

/** Two-line entry: what it is, then the image it stands for. */
function ImageryOption({
  title,
  detail,
}: Readonly<{ title: string; detail?: string }>): React.JSX.Element {
  return (
    <span className="flex min-w-0 flex-col text-left">
      <span className="truncate font-medium">{title}</span>
      {detail && (
        <span className="truncate text-[11px] text-muted-foreground">
          {detail}
        </span>
      )}
    </span>
  );
}

/**
 * Picks which version of the satellite image the map shows: the image the
 * selected site's vehicles were counted on, the automatic per-location
 * choice, or an archived Esri Wayback version.
 *
 * The control is never disabled and never swapped for a placeholder: the
 * archive list depends on the map centre and zoom and is looked up after
 * every pan, but "Automatic" is always a valid choice. While the archive is
 * looked up, the previous list stays and a spinner says so.
 */
function ImageryVersionSelect({
  timeline,
  loading,
  countedImagery,
  autoImagery,
}: Readonly<{
  timeline: ImageryTimeline | null;
  loading: boolean;
  /** Image a selected site's vehicles were counted on, when it can be drawn. */
  countedImagery: ImageryCandidate | null;
  /** What "Automatic" resolves to at the map centre (null while it is looked up). */
  autoImagery: ImageryCandidate | null;
}>): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const pinned = useMapStore((s) => s.pinnedWayback);
  const setPinned = useMapStore((s) => s.setPinnedWayback);
  const useCountedImage = useMapStore((s) => s.useCountedImage);
  const setUseCountedImage = useMapStore((s) => s.setUseCountedImage);
  // The list always shows what the map really draws: a pinned version, else
  // the counted image of the selected site, else the automatic choice.
  const countedActive = countedImagery != null && useCountedImage;
  const summary = (c: ImageryCandidate): string =>
    `${imageryCandidateSummary(c, t, i18n.language)} · ${c.label}`;
  const candidates = (timeline?.candidates ?? []).filter((c) => c.wayback);
  const pinnedCandidate = pinned
    ? waybackCandidateForVersion(candidates, pinned)
    : null;
  const value = pinned
    ? String(pinnedCandidate?.wayback?.release ?? pinned.release)
    : countedActive
      ? COUNTED_IMAGERY
      : AUTO_IMAGERY;

  const autoDetail = autoImagery
    ? summary(autoImagery)
    : t("map.layerPanel.imageryVersionResolving");
  const current: { title: string; detail: string } = pinned
    ? {
        title: t("map.layerPanel.imageryVersionArchiveTitle"),
        detail: pinnedCandidate
          ? imageryCandidateSummary(pinnedCandidate, t, i18n.language)
          : t("map.layerPanel.imageryVersionPublished", {
              date: pinned.publishedAt,
            }),
      }
    : countedActive
      ? {
          title: t("map.layerPanel.imageryVersionCountedTitle"),
          detail: summary(countedImagery),
        }
      : { title: t("map.layerPanel.imageryVersionAuto"), detail: autoDetail };

  const archiveStatus = !timeline
    ? loading
      ? t("map.layerPanel.imageryVersionLoading")
      : t("map.layerPanel.imageryVersionZoomHint")
    : candidates.length === 0
      ? t("map.layerPanel.imageryVersionNone")
      : t("map.layerPanel.imageryVersionHint", { count: candidates.length });

  return (
    <div className="space-y-1.5">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <Label
          htmlFor="imagery-version"
          className="flex items-center gap-1.5 text-xs"
        >
          {t("map.layerPanel.imageryVersionLabel")}
          {loading && (
            <Loader2
              className="size-3 animate-spin text-muted-foreground"
              aria-label={t("map.layerPanel.imageryVersionLoading")}
            />
          )}
        </Label>
        {pinned && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={() => {
              setPinned(null);
              setUseCountedImage(true);
            }}
          >
            {t("map.layerPanel.imageryVersionReset")}
          </Button>
        )}
      </div>
      <Select
        value={value}
        onValueChange={(v) => {
          if (v === AUTO_IMAGERY || v === COUNTED_IMAGERY) {
            setPinned(null);
            setUseCountedImage(v === COUNTED_IMAGERY);
            return;
          }
          const c = candidates.find((x) => String(x.wayback?.release) === v);
          if (c?.wayback) setPinned(c.wayback);
        }}
      >
        <SelectTrigger
          id="imagery-version"
          className={PANEL_CONTROL_CLASS}
          title={`${current.title} · ${current.detail}`}
        >
          <SelectValue>{current.title}</SelectValue>
        </SelectTrigger>
        <SelectContent className="max-w-[min(24rem,90vw)] text-xs">
          <SelectGroup>
            {countedImagery && (
              <SelectItem value={COUNTED_IMAGERY} className="text-xs">
                <ImageryOption
                  title={t("map.layerPanel.imageryVersionCountedTitle")}
                  detail={summary(countedImagery)}
                />
              </SelectItem>
            )}
            <SelectItem value={AUTO_IMAGERY} className="text-xs">
              <ImageryOption
                title={t("map.layerPanel.imageryVersionAuto")}
                detail={autoDetail}
              />
            </SelectItem>
          </SelectGroup>
          <SelectGroup>
            <SelectLabel>
              {t("map.layerPanel.imageryVersionArchiveGroup")}
            </SelectLabel>
            {pinned && !pinnedCandidate && (
              <SelectItem value={String(pinned.release)} className="text-xs">
                <ImageryOption
                  title={t("map.layerPanel.imageryVersionPublished", {
                    date: pinned.publishedAt,
                  })}
                />
              </SelectItem>
            )}
            {candidates.map((c) => (
              <SelectItem
                key={c.id}
                value={String(c.wayback!.release)}
                className="text-xs"
              >
                <ImageryOption
                  title={imageryCandidateSummary(c, t, i18n.language)}
                  detail={t("map.layerPanel.imageryVersionPublished", {
                    date: c.wayback!.publishedAt,
                  })}
                />
              </SelectItem>
            ))}
            {candidates.length === 0 && (
              <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
                {archiveStatus}
              </p>
            )}
          </SelectGroup>
        </SelectContent>
      </Select>
      <div className="space-y-0.5 text-[11px] leading-snug">
        <dl className="flex gap-1.5">
          <dt className="shrink-0 text-muted-foreground">
            {t("map.layerPanel.imageryVersionShown")}
          </dt>
          <dd className="min-w-0 truncate" title={current.detail}>
            {current.detail}
          </dd>
        </dl>
        <p className="text-[11px] leading-snug text-muted-foreground">
          {archiveStatus}
        </p>
      </div>
    </div>
  );
}

export function LayerPanel({
  drawing,
  onToggleDraw,
  capturing,
  onExport,
  selectedId,
  detectionEditing,
  onStartDetectionEditing,
  onSaveDetectionEdits,
  onCancelDetectionEdits,
  imageryTimeline,
  imageryTimelineLoading,
  imageryTimelineAvailable,
  countedImagery,
  autoImagery,
}: LayerPanelProps): React.JSX.Element {
  const { t } = useTranslation();
  const layers = useMapStore((s) => s.layers);
  const toggleLayer = useMapStore((s) => s.toggleLayer);
  const basemap = useMapStore((s) => s.basemap);
  const setBasemap = useMapStore((s) => s.setBasemap);
  const editing = useMapStore((s) => s.editing);
  const setEditing = useMapStore((s) => s.setEditing);
  const setDetectionEditing = useMapStore((s) => s.setDetectionEditing);

  const activeLayerCount = countActiveLayers(layers);
  const activeOverlayCount = countActiveLayers(layers, OVERLAY_KEYS);
  const [open, setOpen] = useState(false);
  const hailPlaying = useHailReplayStore((st) => st.detail != null);
  // Editing started from a map notice must not stay hidden in a closed panel.
  useEffect(() => {
    if (editing || detectionEditing) setOpen(true);
  }, [editing, detectionEditing]);
  const bmLabels = basemapLabels(t);
  const pinnedWayback = useMapStore((s) => s.pinnedWayback);
  // The year the pinned image was taken, not when Esri published the
  // version (a 2022 version can show a 2020 orthophoto).
  const pinnedCandidate =
    pinnedWayback && imageryTimeline
      ? waybackCandidateForVersion(imageryTimeline.candidates, pinnedWayback)
      : null;
  const pinnedYear = pinnedCandidate?.capturedAt?.slice(0, 4);
  const basemapBadge =
    basemap === "satellite" && pinnedWayback && imageryTimelineAvailable
      ? pinnedYear
        ? `${bmLabels[basemap]} · ${pinnedYear}`
        : `${bmLabels[basemap]} · ${t("map.layerPanel.imageryVersionPinnedBadge")}`
      : bmLabels[basemap];

  return (
    <div className="pointer-events-auto flex max-h-full min-h-0 flex-col rounded-lg border bg-card shadow-lg">
      {/* Fixed header — collapses/expands the entire panel */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
          {/* Scrolls when the open sections are taller than the map. */}
          <div className="min-h-0 overflow-y-auto px-3">
            {/* Basemap — collapsed, current value as badge */}
            <Section
              icon={<Map className="size-3" />}
              title={t("map.layerPanel.basemapSectionTitle")}
              badge={basemapBadge}
              defaultOpen={pinnedWayback != null}
            >
              <div className="space-y-2">
                <Select
                  value={basemap}
                  onValueChange={(v) => setBasemap(v as Basemap)}
                >
                  <SelectTrigger
                    className={PANEL_CONTROL_CLASS}
                    aria-label={t("map.layerPanel.basemapSelectAriaLabel")}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BASEMAPS.map((bm) => (
                      <SelectItem key={bm} value={bm}>
                        {bmLabels[bm]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <LayerToggle
                  label={t("map.layerPanel.parcelsLayerLabel")}
                  checked={layers.parcels}
                  onChange={() => toggleLayer("parcels")}
                />
                {layers.parcels && (
                  <p className={PANEL_HINT_CLASS}>
                    {t("map.layerPanel.parcelsLayerHint")}
                  </p>
                )}
                {imageryTimelineAvailable && (
                  <ImageryVersionSelect
                    timeline={imageryTimeline}
                    loading={imageryTimelineLoading}
                    countedImagery={countedImagery}
                    autoImagery={autoImagery}
                  />
                )}
              </div>
            </Section>

            {/* Overlays — open by default */}
            <Section
              icon={<Layers className="size-3" />}
              title={t("map.layerPanel.overlaysSectionTitle")}
              badge={
                activeOverlayCount > 0
                  ? t("map.layerPanel.activeCount", {
                      count: activeOverlayCount,
                    })
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
                <LayerToggle
                  label={t("map.layerPanel.hailZonesLayerLabel")}
                  checked={layers.hailZones}
                  onChange={() => toggleLayer("hailZones")}
                />
              </div>
            </Section>

            {/* Edit boundaries — collapsed */}
            <Section
              icon={<Pencil className="size-3" />}
              title={t("map.boundaries")}
              badge={
                editing ? t("map.layerPanel.editingActiveBadge") : undefined
              }
              forceOpen={editing}
            >
              <Button
                variant={editing ? "default" : "outline"}
                size="sm"
                className={PANEL_ACTION_CLASS}
                onClick={() => {
                  if (!editing && detectionEditing) onCancelDetectionEdits();
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
              {!layers.boundaries && (
                <p className={PANEL_HINT_CLASS}>
                  {t("map.layerPanel.boundariesLayerOffHint")}
                </p>
              )}
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
              forceOpen={detectionEditing}
            >
              <Button
                variant={detectionEditing ? "default" : "outline"}
                size="sm"
                className={PANEL_ACTION_CLASS}
                disabled={!layers.detections || !selectedId}
                onClick={() => {
                  if (detectionEditing) {
                    onSaveDetectionEdits();
                  } else {
                    onStartDetectionEditing();
                  }
                }}
              >
                <MousePointerClick className="size-3" />
                {detectionEditing
                  ? t("map.layerPanel.saveDetectionEditsButton")
                  : t("map.layerPanel.editDetectionsButton")}
              </Button>
              {!detectionEditing && (!layers.detections || !selectedId) && (
                <p className={PANEL_HINT_CLASS}>
                  {!layers.detections
                    ? t("map.layerPanel.detectionLayerOffHint")
                    : t("map.layerPanel.detectionNeedsSelectionHint")}
                </p>
              )}
              {detectionEditing && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-1.5 w-full text-xs"
                    onClick={onCancelDetectionEdits}
                  >
                    {t("map.layerPanel.cancelDetectionEditsButton")}
                  </Button>
                  <p className={PANEL_HINT_CLASS}>
                    {t("map.layerPanel.detectionEditingHint")}
                  </p>
                </>
              )}
            </Section>

            {/* Hail simulation: generated, drawn, historic or archived storms */}
            <Section
              icon={<CloudHail className="size-3" />}
              title={t("hailReplay.title")}
              badge={hailPlaying ? t("hailReplay.loadedBadge") : undefined}
            >
              <HailSimSection />
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
