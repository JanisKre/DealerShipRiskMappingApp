import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import L from "leaflet";
import "leaflet.markercluster";
import type { AnalyzedDealership } from "@shared/types";
import { dealershipHailZone, effectiveVehicleCount } from "@shared/risk-math";
import { isHttpWebsiteUrl, websiteLabel } from "@shared/website";
import { eur } from "@renderer/lib/format";
import { hailZoneColor, riskColor, riskLevel } from "@renderer/lib/riskColor";
import { useMap } from "./leaflet-react";
import { riskMarkerIcon } from "./markerIcons";
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
  return d.detection.model === "stub-area-heuristic"
    ? `~${count} (${t("ui.estimated")})`
    : String(count);
}

/** Escapes text for the imperative Leaflet HTML (names come from imports/OSM). */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function zoneOf(d: AnalyzedDealership): number | undefined {
  return dealershipHailZone(d)?.zone;
}

/** lucide "building-2": a group of locations, as opposed to a single pin. */
const CLUSTER_ICON_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/></svg>';

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
function popupHtml(
  d: AnalyzedDealership,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const score = d.risk?.overallScore;
  const color = score != null ? riskColor(score) : "#6b7280";
  const levelLabel = score != null ? t(`risk.${riskLevel(score)}`) : "—";
  const eal = d.risk?.eal != null ? eur(d.risk.eal) : "—";
  const vehicles = vehicleLabel(d, t);
  const zone = dealershipHailZone(d)?.zone;

  const boundaryWarningHtml =
    d.boundary?.source === "synthetic"
      ? `<div class="popup-row" style="color:#b45309">
           <span>${t("ui.propertyBoundaryMissing")}</span>
         </div>`
      : d.boundary?.reviewRequired
        ? `<div class="popup-row" style="color:#b45309">
             <span>${t("ui.boundaryReviewNeeded")}</span>
           </div>
           <button class="popup-details-btn popup-confirm-boundary-btn" data-id="${d.id}">${t("ui.confirmBoundary")}</button>`
        : "";

  const modelWarningHtml =
    d.detection?.model === "stub-area-heuristic"
      ? `<div class="popup-row" style="color:#b45309">
           <span>${t("ui.vehicleCountEstimated")}</span>
         </div>`
      : "";

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
        <span style="color:${color};font-weight:600">
          ${score != null && zone != null ? `${t("dashboard.hailZoneLabel", { zone })} (${levelLabel})` : t("ui.analyzing")}
        </span>
      </div>
      ${zone != null ? zoneScaleHtml(zone) : ""}
      <div class="popup-row">
        <span>${t("ui.ealYear")}</span><span>${eal}</span>
      </div>
      <div class="popup-row">
        <span>${t("common.vehicles")}</span><span>${vehicles}</span>
      </div>
      ${websiteHtml}
      ${boundaryWarningHtml}
      ${modelWarningHtml}
      <button class="popup-details-btn" data-id="${d.id}">${t("ui.viewDetails")}</button>
    </div>`;
}

/**
 * Imperative marker-cluster component. Uses `L.MarkerClusterGroup` directly
 * because the declarative bindings in ./leaflet-react cover plain layers only.
 * Rebuilds the cluster on every change to `dealerships`/`selectedId`.
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

  useEffect(() => {
    // Create the cluster group once and add it to the map.
    const group = L.markerClusterGroup({
      chunkedLoading: true,
      maxClusterRadius: 60,
      showCoverageOnHover: false,
      iconCreateFunction(cluster) {
        const count = cluster.getChildCount();
        // Cluster icon: colored by risk, using the max score among its markers.
        const markers = cluster.getAllChildMarkers() as Array<
          L.Marker & { _riskScore?: number }
        >;
        const maxScore = markers.reduce(
          (mx, m) => Math.max(mx, m._riskScore ?? 0),
          0,
        );
        const color = riskColor(maxScore);
        const label = `${count} ${t("dashboard.locations")}`;
        // Fixed box so Leaflet can anchor it; the pill itself is centered inside.
        const width = 56 + label.length * 7;
        return L.divIcon({
          className: "",
          iconSize: [width, 32],
          iconAnchor: [width / 2, 16],
          html: `<div class="cluster-icon" style="--cluster-color:${color}"><i></i>${CLUSTER_ICON_SVG}<span>${escapeHtml(label)}</span></div>`,
        });
      },
    });
    map.addLayer(group);
    clusterRef.current = group;

    return () => {
      map.removeLayer(group);
      clusterRef.current = null;
    };
  }, [map, t]);

  // Sync markers when data or selection changes.
  useEffect(() => {
    const group = clusterRef.current;
    if (!group) return;
    group.clearLayers();

    // Collected and added in one `addLayers` call: per-marker `addLayer` on a
    // live cluster group re-clusters each time, which is far too slow for a
    // few hundred locations rebuilt on every analysis tick.
    const markers: L.Marker[] = [];
    const pendingIds = new Set(analyzingIds);
    for (const d of dealerships) {
      const pending = !d.risk || pendingIds.has(d.id);
      const isSelected = d.id === selectedId;
      const marker = L.marker([d.lat, d.lon], {
        icon: riskMarkerIcon(
          d.risk?.overallScore ?? null,
          zoneOf(d),
          isSelected,
          businessType(d),
        ),
        opacity: pending ? 0.6 : 1,
        alt: `${d.name}${zoneOf(d) != null ? ` – ${t("dashboard.hailZoneLabel", { zone: zoneOf(d) })}` : ""}`,
        keyboard: true,
        title: d.name,
        riseOnHover: true,
      }) as L.Marker & { _riskScore?: number; _dealershipId?: string };

      // Store the score on the marker for the cluster icon calculation.
      marker._riskScore = d.risk?.overallScore ?? 0;
      marker._dealershipId = d.id;

      // Hover tooltip: hail risk (the map's single score) and vehicle count.
      const tooltipText = [
        `<strong>${escapeHtml(d.name)}</strong>`,
        d.risk
          ? `${t("dashboard.hailZoneLabel", { zone: zoneOf(d) })} (${t(`risk.${riskLevel(d.risk.overallScore)}`)})`
          : t("ui.analyzing"),
        zoneOf(d) != null ? zoneScaleHtml(zoneOf(d)!) : null,
        d.detection ? `${t("common.vehicles")}: ${vehicleLabel(d, t)}` : null,
        d.boundary?.reviewRequired ? t("ui.boundaryReviewNeeded") : null,
      ]
        .filter(Boolean)
        .join("<br>");
      marker.bindTooltip(tooltipText, {
        direction: "top",
        offset: [0, -34],
        opacity: 0.95,
      });

      // Rich popup.
      marker.bindPopup(popupHtml(d, t), {
        maxWidth: 240,
        className: "drm-popup-wrapper",
      });

      marker.on("click", () => onSelect(d.id));
      marker.on("contextmenu", (e) => {
        const orig = e.originalEvent;
        orig.preventDefault();
        onContextMenu(d, { x: orig.clientX, y: orig.clientY });
      });

      // "View details" button in the popup via event delegation.
      marker.on("popupopen", (e) => {
        const root = e.popup.getElement() as HTMLElement | null;
        const detailsBtn = root?.querySelector(
          ".popup-details-btn:not(.popup-confirm-boundary-btn)",
        ) as HTMLButtonElement | null;
        if (detailsBtn) {
          detailsBtn.onclick = () => {
            const id = detailsBtn.dataset.id;
            if (id) onOpenDetails(id);
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
            onConfirmBoundary(id);
          };
        }
      });

      markers.push(marker);
    }
    group.addLayers(markers);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealerships, selectedId, analyzingIds, t]);

  return null;
}
