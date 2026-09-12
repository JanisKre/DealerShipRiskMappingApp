import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet.markercluster";
import type { AnalyzedDealership } from "@shared/types";
import { eur } from "@renderer/lib/format";
import { perilLabel, perilColor } from "@renderer/lib/perilLabel";
import { riskColor, riskLevelLabel, riskLevel } from "@renderer/lib/riskColor";
import { useMap } from "react-leaflet";
import { riskMarkerIcon } from "./markerIcons";

interface Props {
  dealerships: AnalyzedDealership[];
  selectedId: string | null;
  analyzingIds: string[];
  onSelect: (id: string) => void;
  onOpenDetails: (id: string) => void;
  /** Right-click on a marker — opens a context menu at the cursor position. */
  onContextMenu: (dealership: AnalyzedDealership, point: { x: number; y: number }) => void;
}

/** Top peril of a dealership (highest score). Returns null if there are no perils. */
function topPeril(
  d: AnalyzedDealership,
): { peril: string; score: number } | null {
  if (!d.risk?.perils.length) return null;
  return d.risk.perils.reduce((best, p) =>
    p.score > best.score ? p : best,
  ) as { peril: string; score: number };
}

/** Builds the HTML content for an imperative Leaflet popup. */
function popupHtml(d: AnalyzedDealership): string {
  const score = d.risk?.overallScore;
  const color = score != null ? riskColor(score) : "#6b7280";
  const levelLabel = score != null ? riskLevelLabel(riskLevel(score)) : "—";
  const tp = topPeril(d);
  const eal = d.risk?.eal != null ? eur(d.risk.eal) : "—";
  const vehicles = d.detection?.vehicleCount ?? "—";

  const scoreBar =
    score != null
      ? `<div class="popup-risk-track">
           <div class="popup-risk-bar" style="width:${score}%;background:${color}"></div>
         </div>`
      : "";

  const topPerilHtml = tp
    ? `<div class="popup-row">
         <span>Top peril</span>
         <span style="color:${perilColor(tp.peril as never)};font-weight:600">
           ${perilLabel(tp.peril as never)} ${Math.round(tp.score)}/100
         </span>
       </div>`
    : "";

  const boundaryWarningHtml =
    d.boundary?.source === "synthetic"
      ? `<div class="popup-row" style="color:#b45309">
           <span>⚠ Property boundary not detected</span>
         </div>`
      : "";

  const modelWarningHtml =
    d.detection?.model === "stub-area-heuristic"
      ? `<div class="popup-row" style="color:#b45309">
           <span>⚠ Vehicle count estimated (no AI model)</span>
         </div>`
      : "";

  return `
    <div class="drm-popup">
      <div class="popup-title">${d.name}</div>
      <div class="popup-row">
        <span>Risk</span>
        <span style="color:${color};font-weight:600">
          ${score != null ? `${Math.round(score)}/100` : "Analyzing…"} ${score != null ? `(${levelLabel})` : ""}
        </span>
      </div>
      ${scoreBar}
      ${topPerilHtml}
      <div class="popup-row">
        <span>EAL / year</span><span>${eal}</span>
      </div>
      <div class="popup-row">
        <span>Vehicles</span><span>${vehicles}</span>
      </div>
      ${boundaryWarningHtml}
      ${modelWarningHtml}
      <button class="popup-details-btn" data-id="${d.id}">View details →</button>
    </div>`;
}

/**
 * Imperative marker-cluster component. Uses `L.MarkerClusterGroup` directly
 * because react-leaflet v5 has no clean declarative integration.
 * Rebuilds the cluster on every change to `dealerships`/`selectedId`.
 */
export function ClusteredMarkers({
  dealerships,
  selectedId,
  analyzingIds,
  onSelect,
  onOpenDetails,
  onContextMenu,
}: Props): null {
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
        const markers = cluster.getAllChildMarkers() as Array<L.Marker & { _riskScore?: number }>;
        const maxScore = markers.reduce((mx, m) => Math.max(mx, m._riskScore ?? 0), 0);
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

    for (const d of dealerships) {
      const pending = !d.risk || analyzingIds.includes(d.id);
      const isSelected = d.id === selectedId;
      const marker = L.marker([d.lat, d.lon], {
        icon: riskMarkerIcon(d.risk?.overallScore ?? null, isSelected),
        opacity: pending ? 0.6 : 1,
        alt: `${d.name}${d.risk ? ` – Risk ${Math.round(d.risk.overallScore)}/100` : ""}`,
        keyboard: true,
        title: d.name,
        riseOnHover: true,
      }) as L.Marker & { _riskScore?: number; _dealershipId?: string };

      // Store the score on the marker for the cluster icon calculation.
      marker._riskScore = d.risk?.overallScore ?? 0;
      marker._dealershipId = d.id;

      // Hover tooltip: short info.
      const tp = topPeril(d);
      const tooltipText = [
        `<strong>${d.name}</strong>`,
        d.risk ? `Risk: ${Math.round(d.risk.overallScore)}/100` : "Analyzing…",
        tp ? `${perilLabel(tp.peril as never)}: ${Math.round(tp.score)}/100` : null,
      ]
        .filter(Boolean)
        .join("<br>");
      marker.bindTooltip(tooltipText, {
        direction: "top",
        offset: [0, -34],
        opacity: 0.95,
      });

      // Rich popup.
      marker.bindPopup(popupHtml(d), {
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
        const btn = (e.popup.getElement() as HTMLElement | null)?.querySelector(
          ".popup-details-btn",
        ) as HTMLButtonElement | null;
        if (btn) {
          btn.onclick = () => {
            const id = btn.dataset.id;
            if (id) onOpenDetails(id);
          };
        }
      });

      group.addLayer(marker);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealerships, selectedId, analyzingIds]);

  return null;
}
