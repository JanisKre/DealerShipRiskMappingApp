import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import L from "leaflet";
import "leaflet.markercluster";
import type { AnalyzedDealership } from "@shared/types";
import { effectiveVehicleCount } from "@shared/risk-math";
import { eur } from "@renderer/lib/format";
import { riskColor, riskLevel } from "@renderer/lib/riskColor";
import { useMap } from "./leaflet-react";
import { riskMarkerIcon } from "./markerIcons";

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

/** Builds the HTML content for an imperative Leaflet popup. */
function popupHtml(d: AnalyzedDealership, t: (key: string) => string): string {
  const score = d.risk?.overallScore;
  const color = score != null ? riskColor(score) : "#6b7280";
  const levelLabel = score != null ? t(`risk.${riskLevel(score)}`) : "—";
  const eal = d.risk?.eal != null ? eur(d.risk.eal) : "—";
  const vehicles = vehicleLabel(d, t);

  const scoreBar =
    score != null
      ? `<div class="popup-risk-track">
           <div class="popup-risk-bar" style="width:${score}%;background:${color}"></div>
         </div>`
      : "";

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

  return `
    <div class="drm-popup">
      <div class="popup-title">${d.name}</div>
      <div class="popup-row">
        <span>${t("ui.hailRisk")}</span>
        <span style="color:${color};font-weight:600">
          ${score != null ? `${Math.round(score)}/100` : t("ui.analyzing")} ${score != null ? `(${levelLabel})` : ""}
        </span>
      </div>
      ${scoreBar}
      <div class="popup-row">
        <span>${t("ui.ealYear")}</span><span>${eal}</span>
      </div>
      <div class="popup-row">
        <span>${t("common.vehicles")}</span><span>${vehicles}</span>
      </div>
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
        const size = count < 10 ? 36 : count < 50 ? 44 : 52;
        return L.divIcon({
          className: "",
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
          html: `<div class="cluster-icon" style="--cluster-color:${color};width:${size}px;height:${size}px">${count}</div>`,
        });
      },
    });
    map.addLayer(group);
    clusterRef.current = group;

    return () => {
      map.removeLayer(group);
      clusterRef.current = null;
    };
  }, [map]);

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
        icon: riskMarkerIcon(d.risk?.overallScore ?? null, isSelected),
        opacity: pending ? 0.6 : 1,
        alt: `${d.name}${d.risk ? ` – ${t("ui.hailRisk")} ${Math.round(d.risk.overallScore)}/100` : ""}`,
        keyboard: true,
        title: d.name,
        riseOnHover: true,
      }) as L.Marker & { _riskScore?: number; _dealershipId?: string };

      // Store the score on the marker for the cluster icon calculation.
      marker._riskScore = d.risk?.overallScore ?? 0;
      marker._dealershipId = d.id;

      // Hover tooltip: hail risk (the map's single score) and vehicle count.
      const tooltipText = [
        `<strong>${d.name}</strong>`,
        d.risk
          ? `${t("ui.hailRisk")}: ${Math.round(d.risk.overallScore)}/100 (${t(`risk.${riskLevel(d.risk.overallScore)}`)})`
          : t("ui.analyzing"),
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
