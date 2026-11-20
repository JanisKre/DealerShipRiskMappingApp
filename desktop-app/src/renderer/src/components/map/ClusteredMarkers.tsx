import { useHailReplayStore } from "@renderer/store/hailReplayStore";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import L from "leaflet";
import "leaflet.markercluster";
import { hasEalBasis } from "@shared/estimates";
import type { AnalyzedDealership } from "@shared/types";
import { dealershipHailZone, effectiveVehicleCount } from "@shared/risk-math";
import { isHttpWebsiteUrl, websiteLabel } from "@shared/website";
import { escapeHtml } from "@renderer/lib/escapeHtml";
import { eur } from "@renderer/lib/format";
import { hailZoneColor, hailZoneTextColor } from "@renderer/lib/riskColor";

/** Small inline icons for the popup (lucide's paths, 24 grid). */
const ICON_WARNING =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';
const ICON_CHECK =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const ICON_INFO =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>';

/** A point in the popup that needs a check, as a small warning notice. */
function noticeHtml(text: string): string {
  return `<div class="popup-notice">${ICON_WARNING}<span>${escapeHtml(text)}</span></div>`;
}
import { useMap } from "./leaflet-react";
import { clusterIcon, riskMarkerIcon } from "./markerIcons";
import { businessType } from "@renderer/store/appStore";

interface Props {
  dealerships: AnalyzedDealership[];
  selectedId: string | null;
  analyzingIds: string[];
  onSelect: (id: string) => void;
  onOpenDetails: (id: string) => void;
  /** Confirms a boundary flagged for review as covering the lot. */
  onConfirmBoundary: (id: string) => void;
  /** Right-click on a marker — opens a context menu at the cursor position. */
  onContextMenu: (
    dealership: AnalyzedDealership,
    point: { x: number; y: number },
  ) => void;
}

/** Vehicle count as shown on the map; "—" until detection has run. */
function vehicleLabel(
  d: AnalyzedDealership,
  t: (key: string) => string,
): string {
  if (!d.detection) return "—";
  const count = effectiveVehicleCount(d.detection);
  return d.detection.model === "stub-area-heuristic" &&
    d.detection.manualVehicleCount == null
    ? `~${count} (${t("ui.estimated")})`
    : String(count);
}

function zoneOf(d: AnalyzedDealership): number | undefined {
  return dealershipHailZone(d)?.zone;
}

/** Six-step hail zone bar; the site's zone is lit, the others are dimmed. */
function zoneScaleHtml(zone: number): string {
  const cells = [1, 2, 3, 4, 5, 6]
    .map(
      (z) =>
        `<i class="${z === zone ? "on" : ""}" style="background:${hailZoneColor(z)}"></i>`,
    )
    .join("");
  return `<div class="hail-scale" aria-hidden="true">${cells}</div>`;
}

/** Builds the HTML content for an imperative Leaflet popup. */
/**
 * Text in place of the hail zone while there is none: "being analysed"
 * only for a location that is, otherwise "not analysed yet" (a stopped or
 * failed row is not in progress).
 */
function noZoneText(
  analysing: boolean,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  return analysing ? t("ui.analyzing") : t("map.locationsPanel.notAnalyzed");
}

function popupHtml(
  d: AnalyzedDealership,
  t: (key: string, opts?: Record<string, unknown>) => string,
  analysing = false,
): string {
  const eal =
    d.risk == null
      ? "—"
      : hasEalBasis(d)
        ? eur(d.risk.eal)
        : escapeHtml(t("dashboard.noEal.badge"));
  const vehicles = vehicleLabel(d, t);
  const zone = dealershipHailZone(d)?.zone;
  const color = zone != null ? hailZoneColor(zone) : "#6b7280";
  const needsConfirm =
    d.boundary?.source !== "synthetic" && d.boundary?.reviewRequired === true;
  const noticesHtml = [
    d.boundary?.source === "synthetic"
      ? noticeHtml(t("ui.fallbackBoundaryReview"))
      : needsConfirm
        ? noticeHtml(t("ui.boundaryReviewNeeded"))
        : "",
    d.detection?.model === "stub-area-heuristic"
      ? noticeHtml(t("ui.vehicleCountEstimated"))
      : "",
  ].join("");

  // Opened via the main process' window-open handler (http/https only).
  const websiteHtml =
    d.website && isHttpWebsiteUrl(d.website)
      ? `<div class="popup-row">
           <span>${t("ui.website")}</span>
           <a href="${escapeHtml(d.website)}" target="_blank" rel="noreferrer" title="${escapeHtml(d.website)}">${escapeHtml(websiteLabel(d.website))}</a>
         </div>`
      : "";

  return `
    <div class="drm-popup">
      <div class="popup-title">${escapeHtml(d.name)}</div>
      <div class="popup-row">
        <span>${t("ui.hailRisk")}</span>
        ${
          zone != null
            ? `<span class="popup-zone" style="background:${color};color:${hailZoneTextColor(zone)}">${t("dashboard.hailZoneLabel", { zone })}</span>`
            : `<span>${noZoneText(analysing, t)}</span>`
        }
      </div>
      ${zone != null ? zoneScaleHtml(zone) : ""}
      <div class="popup-row">
        <span>${t("dashboard.hailEal")}</span><span>${eal}</span>
      </div>
      <div class="popup-row">
        <span>${t("common.vehicles")}</span><span>${vehicles}</span>
      </div>
      ${websiteHtml}
      ${noticesHtml}
      <div class="popup-actions">
        ${
          needsConfirm
            ? `<button type="button" class="popup-btn popup-btn-primary popup-confirm-boundary-btn" data-id="${d.id}">${ICON_CHECK}${t("ui.confirmBoundary")}</button>`
            : ""
        }
        <button type="button" class="popup-btn popup-details-btn" data-id="${d.id}">${ICON_INFO}${t("ui.viewDetails")}</button>
      </div>
    </div>`;
}

/** A location marker with what the cluster badge reads from it. */
type ZonedMarker = L.Marker & { _dealershipId?: string; _hailZone?: number };

interface MarkerEntry {
  marker: L.Marker;
  dealership: AnalyzedDealership;
  pending: boolean;
  selected: boolean;
}

/** Hover tooltip: hail zone and vehicle count. */
function tooltipHtml(
  d: AnalyzedDealership,
  t: (key: string, opts?: Record<string, unknown>) => string,
  analysing = false,
): string {
  const zone = zoneOf(d);
  return (
    [
      `<strong>${escapeHtml(d.name)}</strong>`,
      zone != null
        ? t("dashboard.hailZoneLabel", { zone })
        : noZoneText(analysing, t),
      zone != null ? zoneScaleHtml(zone) : null,
      d.detection ? `${t("common.vehicles")}: ${vehicleLabel(d, t)}` : null,
      d.boundary?.reviewRequired ? t("ui.boundaryReviewNeeded") : null,
    ]
      .filter(Boolean)
      // One block per line: the zone bar is a block itself, and a <br>
      // after it left an empty line.
      .map((line) => `<div>${line}</div>`)
      .join("")
  );
}

/**
 * Imperative marker-cluster component. Uses `L.MarkerClusterGroup` directly
 * because the declarative bindings in ./leaflet-react cover plain layers only.
 * Keeps the cluster in step with `dealerships`/`selectedId` by replacing
 * only the markers that changed.
 */
export function ClusteredMarkers({
  dealerships,
  selectedId,
  analyzingIds,
  onSelect,
  onOpenDetails,
  onConfirmBoundary,
  onContextMenu,
}: Props): null {
  const { t } = useTranslation();
  const map = useMap();
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  /** The selected marker, kept out of the cluster so it is never hidden. */
  const selectedRef = useRef<L.LayerGroup | null>(null);
  /** Markers on the map by location id, with the state they were built from. */
  const entriesRef = useRef(new Map<string, MarkerEntry>());
  // Read at event time, so a new callback identity does not rebuild markers.
  const callbacks = useRef({
    onSelect,
    onOpenDetails,
    onConfirmBoundary,
    onContextMenu,
  });
  callbacks.current = {
    onSelect,
    onOpenDetails,
    onConfirmBoundary,
    onContextMenu,
  };

  useEffect(() => {
    // Create the cluster group once and add it to the map.
    const group = L.markerClusterGroup({
      chunkedLoading: true,
      maxClusterRadius: 60,
      showCoverageOnHover: false,
      iconCreateFunction(cluster) {
        const count = cluster.getChildCount();
        // A round badge with the number only: wide "30 Standorte" pills
        // overlapped each other once a portfolio had hundreds of locations.
        // Its ring shows the worst hail zone inside, so a group of zone-6
        // sites does not look like a group of zone-1 ones.
        const zones = cluster
          .getAllChildMarkers()
          .map((m) => (m as ZonedMarker)._hailZone)
          .filter((z): z is number => z != null);
        const maxZone = zones.length > 0 ? Math.max(...zones) : null;
        const label = escapeHtml(
          maxZone != null
            ? `${count} ${t("dashboard.locations")}, ${t("map.page.clusterMaxZone", { zone: maxZone })}`
            : `${count} ${t("dashboard.locations")}`,
        );
        return clusterIcon(count, maxZone, label);
      },
    });
    map.addLayer(group);
    clusterRef.current = group;
    const selectedLayer = L.layerGroup().addTo(map);
    selectedRef.current = selectedLayer;

    return () => {
      map.removeLayer(group);
      selectedLayer.remove();
      clusterRef.current = null;
      selectedRef.current = null;
      entriesRef.current = new Map();
    };
  }, [map, t]);

  // Sync markers when data or selection changes. Only markers whose location,
  // pending state or selection changed are replaced: rebuilding all of them
  // on every click and every analysis tick re-clustered the whole portfolio.
  useEffect(() => {
    const group = clusterRef.current;
    const selectedLayer = selectedRef.current;
    if (!group || !selectedLayer) return;
    const entries = entriesRef.current;

    const stale: L.Marker[] = [];
    const drop = (id: string, entry: MarkerEntry): void => {
      if (entry.selected) selectedLayer.removeLayer(entry.marker);
      else stale.push(entry.marker);
      entries.delete(id);
    };

    // Collected and added in one `addLayers` call: per-marker `addLayer` on a
    // live cluster group re-clusters each time.
    const added: L.Marker[] = [];
    const pendingIds = new Set(analyzingIds);
    const seen = new Set<string>();
    for (const d of dealerships) {
      seen.add(d.id);
      const pending = !d.risk || pendingIds.has(d.id);
      const isSelected = d.id === selectedId;
      const current = entries.get(d.id);
      if (
        current &&
        current.dealership === d &&
        current.pending === pending &&
        current.selected === isSelected
      ) {
        continue;
      }
      if (current) drop(d.id, current);

      const zone = zoneOf(d);
      const marker = L.marker([d.lat, d.lon], {
        icon: riskMarkerIcon(zone, isSelected, businessType(d), d.name),
        opacity: pending ? 0.6 : 1,
        alt: `${d.name}${zone != null ? ` – ${t("dashboard.hailZoneLabel", { zone })}` : ""}`,
        keyboard: true,
        title: d.name,
        riseOnHover: true,
        zIndexOffset: isSelected ? 1000 : 0,
      }) as ZonedMarker;

      marker._dealershipId = d.id;
      marker._hailZone = zone;

      // Near the top edge the tooltip opens below the pin instead of being
      // clipped by the map. Registered before bindTooltip so it runs before
      // the tooltip opens.
      marker.on("mouseover", () => {
        const tooltip = marker.getTooltip();
        if (!tooltip) return;
        const below = map.latLngToContainerPoint(marker.getLatLng()).y < 140;
        tooltip.options.direction = below ? "bottom" : "top";
        tooltip.options.offset = below ? [0, 6] : [0, -34];
      });
      // Tooltip and popup HTML are built when they open, not for every pin.
      const analysing = pendingIds.has(d.id);
      marker.bindTooltip(() => tooltipHtml(d, t, analysing), {
        direction: "top",
        offset: [0, -34],
        opacity: 0.95,
      });

      // Rich popup.
      marker.bindPopup(() => popupHtml(d, t, analysing), {
        maxWidth: 240,
        className: "drm-popup-wrapper",
      });

      marker.on("click", (e) => {
        // While a start point is picked or a track is drawn, a click on a
        // pin is a click on the map at that place: it used to select the
        // location and zoom away with the mode still active.
        if (useHailReplayStore.getState().mapMode) {
          marker.closePopup();
          map.fire("click", {
            latlng: e.latlng,
            layerPoint: map.latLngToLayerPoint(e.latlng),
            containerPoint: map.latLngToContainerPoint(e.latlng),
            originalEvent: e.originalEvent,
          });
          return;
        }
        callbacks.current.onSelect(d.id);
      });
      marker.on("contextmenu", (e) => {
        const orig = e.originalEvent;
        orig.preventDefault();
        // The hover tooltip would cover the menu.
        marker.closeTooltip();
        callbacks.current.onContextMenu(d, {
          x: orig.clientX,
          y: orig.clientY,
        });
      });

      // "View details" button in the popup via event delegation.
      marker.on("popupopen", (e) => {
        const root = e.popup.getElement() as HTMLElement | null;
        const detailsBtn = root?.querySelector(
          ".popup-details-btn",
        ) as HTMLButtonElement | null;
        if (detailsBtn) {
          detailsBtn.onclick = () => {
            const id = detailsBtn.dataset.id;
            if (id) callbacks.current.onOpenDetails(id);
          };
        }
        const confirmBtn = root?.querySelector(
          ".popup-confirm-boundary-btn",
        ) as HTMLButtonElement | null;
        if (confirmBtn) {
          confirmBtn.onclick = () => {
            const id = confirmBtn.dataset.id;
            if (!id) return;
            marker.closePopup();
            callbacks.current.onConfirmBoundary(id);
          };
        }
      });

      // The selected site sits outside the cluster: hidden inside a cluster
      // badge, a selection from the list or the chat showed nothing.
      if (isSelected) selectedLayer.addLayer(marker);
      else added.push(marker);
      entries.set(d.id, {
        marker,
        dealership: d,
        pending,
        selected: isSelected,
      });
    }
    for (const [id, entry] of entries) {
      if (!seen.has(id)) drop(id, entry);
    }
    if (stale.length > 0) group.removeLayers(stale);
    if (added.length > 0) group.addLayers(added);
  }, [dealerships, selectedId, analyzingIds, t, map]);

  return null;
}
