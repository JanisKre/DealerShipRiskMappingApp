import { useEffect, useState } from "react";
import type { TFunction } from "i18next";
import type { AnalyzedDealership } from "@shared/types";
import { haversineKm } from "@shared/risk-math";
import {
  useImagerySelection,
  type MapViewPoint,
} from "@renderer/lib/useImagerySelection";
import { useImageryTimeline } from "@renderer/lib/useImageryTimeline";
import { validateTileTemplate } from "@shared/tile-template";
import { escapeHtml } from "@renderer/lib/escapeHtml";
import {
  CUSTOM_IMAGERY_LABEL,
  IMAGERY_MIN_SELECTION_ZOOM,
  IMAGERY_TOLERANCE_DAYS,
  resolveStateService,
  stateImageryDrawableAt,
  stateTileTemplate,
  type ImageryCandidate,
  type ImagerySelection,
} from "@shared/imagery-sources";
import {
  type ImageryTimeline,
  WAYBACK_ATTRIBUTION,
  waybackCandidateForVersion,
  waybackTileTemplate,
} from "@shared/imagery-wayback";
import { useMapStore, type Basemap } from "@renderer/store/mapStore";
import {
  SITE_IN_VIEW_PX,
  TILE_URLS,
  metersPerPixel,
  tileAttributions,
} from "./basemapTiles";

export interface MapImagery {
  /** Tile template and attribution of the basemap to draw. */
  tileUrl: string;
  tileAttribution: string;
  tileMaxNativeZoom: number | undefined;
  /** The image the legend describes (counted, pinned or automatic). */
  shownImagery: ImagerySelection | null;
  /** Wayback versions at the map centre; null where no choice makes sense. */
  timeline: ImageryTimeline | null;
  timelineLoading: boolean;
  /** False for other basemaps and where the own source is drawn. */
  timelineAvailable: boolean;
  /** The image the selected site's vehicles were counted on, if drawable. */
  countedCandidate: ImageryCandidate | null;
  /** The automatic choice for the current view, once resolved. */
  autoImagery: ImageryCandidate | null;
}

/**
 * Which aerial image the map draws and describes: the automatic choice per
 * view (state orthophoto or Esri), a pinned Wayback version, the image the
 * selected site's vehicles were counted on, or the own source from the
 * settings where it has an image; see the comments below for precedence.
 */
export function useMapImagery({
  t,
  basemap,
  mapView,
  detectionsShown,
  selected,
}: {
  t: TFunction;
  basemap: Basemap;
  mapView: MapViewPoint | null;
  /** Whether the vehicle layer is on. */
  detectionsShown: boolean;
  selected: AnalyzedDealership | null;
}): MapImagery {
  const { selection: resolvedImagery, loading: imageryLoading } =
    useImagerySelection(mapView, basemap === "satellite");
  // A state orthophoto only covers its own state. Zoomed out past a single
  // state the national source (Esri) is used right away, without waiting for
  // the selection of the new view or keeping a stale state choice.
  // The same holds below the zoom a state service starts to draw at (it
  // answers with blank tiles there).
  const viewZoom = mapView?.zoom ?? 0;
  const imagery =
    resolvedImagery?.chosen.kind === "state-dop" &&
    !stateImageryDrawableAt(resolvedImagery.chosen.state, viewZoom)
      ? null
      : resolvedImagery;
  const pinnedWayback = useMapStore((s) => s.pinnedWayback);
  const useCountedImage = useMapStore((s) => s.useCountedImage);

  // Custom tile source from the settings (only for the satellite basemap).
  const [custom, setCustom] = useState<{
    url: string;
    attribution: string;
  } | null>(null);
  useEffect(() => {
    window.api.getSettings().then((s) => {
      if (s.satelliteProvider === "wms" && s.wmsTileUrl) {
        const check = validateTileTemplate(s.wmsTileUrl);
        if (check.ok)
          setCustom({
            url: check.template,
            // The source's own line, never Esri's: its tiles are not Esri's.
            attribution: escapeHtml(
              s.customImagery?.attribution ??
                s.customImagery?.name ??
                CUSTOM_IMAGERY_LABEL,
            ),
          });
      }
    });
  }, []);
  // The own source is drawn where the selection for this view chose it; where
  // it has no image the main process chose automatically and that is drawn.
  // Before the first answer it is drawn right away, so the map does not open
  // on Esri and then swap.
  const customActive =
    custom != null &&
    (resolvedImagery == null || resolvedImagery.chosen.kind === "custom");

  // Wayback history at the map centre — only where a location-level choice
  // makes sense (same zoom floor as the automatic selection) and the own
  // source is not what the map draws.
  const timelineEnabled =
    basemap === "satellite" &&
    !customActive &&
    mapView != null &&
    mapView.zoom >= IMAGERY_MIN_SELECTION_ZOOM;
  const { timeline: imageryTimeline, loading: imageryTimelineLoading } =
    useImageryTimeline(mapView, timelineEnabled);

  // While a version is pinned, the legend describes that version's image at
  // the map centre instead of the automatic choice.
  // A timeline that still belongs to the previous view is not used: it would
  // show the capture date of another place.
  const pinnedCandidate: ImageryCandidate | null = !pinnedWayback
    ? null
    : ((imageryTimeline && !imageryTimelineLoading
        ? waybackCandidateForVersion(imageryTimeline.candidates, pinnedWayback)
        : null) ??
      (imageryTimelineLoading
        ? null
        : // Outside the resolved timeline (overview zoom, older than the
          // listed versions): the version is known, its image date is not.
          {
            id: `wayback:${pinnedWayback.release}`,
            kind: "esri-wayback",
            label: `Esri Wayback ${pinnedWayback.publishedAt}`,
            capturedAt: null,
            dateSource: "none",
            resolutionM: null,
            zoom: mapView?.zoom ?? 0,
            attribution: WAYBACK_ATTRIBUTION,
            wayback: pinnedWayback,
          }));
  const legendImagery: ImagerySelection | null =
    basemap === "satellite" && pinnedWayback && !customActive
      ? pinnedCandidate
        ? {
            mode: imagery?.mode ?? "auto",
            chosen: pinnedCandidate,
            reason: "pinned-version",
            candidates: [pinnedCandidate, ...(imagery?.candidates ?? [])],
            toleranceDays: imagery?.toleranceDays ?? IMAGERY_TOLERANCE_DAYS,
            resolvedAt: imagery?.resolvedAt ?? new Date().toISOString(),
          }
        : null
      : // The kept selection of the previous view still draws the basemap, but
        // it does not describe the map centre any more.
        imageryLoading
        ? null
        : imagery;

  // Only while the selected site is in view: its counted image says nothing
  // about a place the user has panned away to (the legend and the version
  // list describe the map centre).
  const siteInView =
    selected != null &&
    mapView != null &&
    haversineKm(mapView.lat, mapView.lon, selected.lat, selected.lon) * 1000 <=
      metersPerPixel(mapView.lat, mapView.zoom) * SITE_IN_VIEW_PX;

  // The image the selected site's vehicles were counted on, when it is a
  // source the map can draw (a state orthophoto only where one is allowed).
  const countedAvailable =
    basemap === "satellite" && !customActive && detectionsShown && siteInView
      ? (selected?.detection?.imagery ?? null)
      : null;
  const countedCandidate =
    countedAvailable &&
    ((countedAvailable.chosen.kind === "state-dop" &&
      stateImageryDrawableAt(countedAvailable.chosen.state, viewZoom)) ||
      countedAvailable.chosen.kind === "esri-wayback")
      ? countedAvailable.chosen
      : null;
  // Shown instead of the automatic choice (unless the user pinned a version,
  // the own source is drawn or it is switched off in the version list), so the dots sit on the
  // cars they were counted from.
  const countedActive =
    countedCandidate != null && useCountedImage && !pinnedWayback;
  const countedSelection = countedActive ? countedAvailable : null;
  const countedOn = countedActive ? countedCandidate : null;
  const shownImagery = countedOn ? countedSelection : legendImagery;

  // Tile URL for the active basemap. Satellite follows the per-location
  // imagery choice (own source, state orthophoto or Esri).
  // With vehicles shown for a selected site, the map shows the image the
  // vehicles were counted on: dots drawn over a different capture (another
  // year, another provider's registration) land on roofs and empty stalls.
  let tileUrl = TILE_URLS[basemap];
  let tileAttribution = tileAttributions(t)[basemap];
  // A state service without tiles above some zoom (Bayern: z19) is upscaled.
  let stateMaxZoom: number | undefined;
  if (basemap === "satellite") {
    const chosen = imagery?.chosen;
    const service =
      chosen?.kind === "state-dop" && chosen.state
        ? resolveStateService(chosen.state, chosen.vintage)
        : undefined;
    const countedService =
      countedOn?.kind === "state-dop" && countedOn.state
        ? resolveStateService(countedOn.state, countedOn.vintage)
        : undefined;
    if (custom && customActive) {
      tileUrl = custom.url;
      tileAttribution = custom.attribution;
    } else if (pinnedWayback) {
      tileUrl = waybackTileTemplate(pinnedWayback.release);
      tileAttribution = `&copy; ${(pinnedCandidate?.attribution ?? WAYBACK_ATTRIBUTION).replace(/^© /, "")}`;
    } else if (countedService && countedOn) {
      tileUrl = stateTileTemplate(countedService);
      tileAttribution = countedOn.attribution;
      stateMaxZoom = countedService.maxZoom;
    } else if (countedOn?.kind === "esri-wayback" && countedOn.wayback) {
      tileUrl = waybackTileTemplate(countedOn.wayback.release);
      tileAttribution = `&copy; ${countedOn.attribution.replace(/^© /, "")}`;
    } else if (service && chosen) {
      tileUrl = stateTileTemplate(service);
      tileAttribution = chosen.attribution;
      stateMaxZoom = service.maxZoom;
    } else if (chosen?.kind === "esri") {
      tileAttribution = `&copy; ${chosen.attribution.replace(/^© /, "")}`;
    }
  }

  return {
    tileUrl,
    tileAttribution,
    // OpenTopoMap publishes native tiles only through z17. Leaflet may still
    // zoom farther, but must upscale z17 instead of requesting the provider's
    // conspicuous "max zoom / layer = 17" error tiles.
    tileMaxNativeZoom: basemap === "terrain" ? 17 : stateMaxZoom,
    shownImagery,
    timeline: timelineEnabled ? imageryTimeline : null,
    timelineLoading: timelineEnabled && imageryTimelineLoading,
    timelineAvailable: basemap === "satellite" && !customActive,
    countedCandidate,
    autoImagery: imageryLoading ? null : (imagery?.chosen ?? null),
  };
}
