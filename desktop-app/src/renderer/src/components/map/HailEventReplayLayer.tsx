import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import {
  replayFrame,
  upperBoundByTime,
  type HailEventCell,
} from "@shared/hail-events";
import type { RadarHailClass } from "@shared/radar-hail";
import { useAppStore } from "@renderer/store/appStore";
import { useHailReplayStore } from "@renderer/store/hailReplayStore";
import {
  useHailEventImpact,
  useShiftedEventCells,
} from "@renderer/lib/useHailEventImpact";
import { useMap } from "./leaflet-react";

/** Colours per hail class, the same ramp as the scenario intensities. */
export const HAIL_CLASS_COLOR: Record<RadarHailClass, string> = {
  mixed: "#eab308",
  hail: "#ea580c",
  large: "#b91c1c",
};

/** A site counts as "just hit" for this long (radar time) and pulses. */
const JUST_HIT_MS = 15 * 60 * 1000;

function ringLatLngs(
  ring: readonly number[],
  dLon = 0,
  dLat = 0,
): L.LatLngTuple[] {
  const out: L.LatLngTuple[] = [];
  for (let i = 0; i + 1 < ring.length; i += 2)
    out.push([ring[i + 1] + dLat, ring[i] + dLon]);
  return out;
}

function cellLatLngs(
  cell: HailEventCell,
  dLon = 0,
  dLat = 0,
): L.LatLngTuple[][] {
  return cell.r.map((ring) => ringLatLngs(ring, dLon, dLat));
}

/**
 * Draws the loaded hail event on the map, on one canvas: the swath the
 * storms have left so far (faint), the track lines (dashed), the cells as
 * they are at the replay time (solid, gliding between radar steps) and the
 * locations they reached (red rings, pulsing just after the hit). Fits the
 * map to the event when one is loaded. Nothing here is interactive, so the
 * replay never gets in the way of clicking a pin.
 */
export function HailEventReplayLayer(): null {
  const map = useMap();
  const detail = useHailReplayStore((s) => s.detail);
  const time = useHailReplayStore((s) => s.time);
  const cells = useShiftedEventCells();
  const impact = useHailEventImpact();
  const dealerships = useAppStore((s) => s.dealerships);

  const renderer = useMemo(() => L.canvas({ padding: 0.3 }), []);
  const groups = useRef<{
    swath: L.LayerGroup;
    tracks: L.LayerGroup;
    live: L.LayerGroup;
    hits: L.LayerGroup;
  } | null>(null);
  const swathDrawn = useRef(0);
  const hitMarkers = useRef<Array<{ firstAt: number; marker: L.CircleMarker }>>(
    [],
  );

  // Layer groups live as long as the map.
  useEffect(() => {
    const g = {
      swath: L.layerGroup().addTo(map),
      tracks: L.layerGroup().addTo(map),
      live: L.layerGroup().addTo(map),
      hits: L.layerGroup().addTo(map),
    };
    groups.current = g;
    return () => {
      Object.values(g).forEach((layer) => layer.remove());
      groups.current = null;
    };
  }, [map]);

  // Zoom to a newly loaded event (Germany-wide events show the whole day).
  const eventId = detail?.summary.id ?? null;
  useEffect(() => {
    if (!detail) return;
    const [w, s, e, n] = detail.summary.bbox;
    map.fitBounds(
      [
        [s, w],
        [n, e],
      ],
      { paddingTopLeft: [48, 120], paddingBottomRight: [48, 140], maxZoom: 11 },
    );
    // Only on a new event, not on every shift.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, eventId]);

  // Track lines: static per event and shift.
  useEffect(() => {
    const g = groups.current;
    if (!g) return;
    g.tracks.clearLayers();
    g.swath.clearLayers();
    swathDrawn.current = 0;
    const byTrack = new Map<number, L.LatLngTuple[]>();
    for (const c of cells) {
      const line = byTrack.get(c.track) ?? [];
      line.push([c.p[1], c.p[0]]);
      byTrack.set(c.track, line);
    }
    for (const line of byTrack.values()) {
      if (line.length < 2) continue;
      L.polyline(line, {
        renderer,
        interactive: false,
        color: "#7f1d1d",
        weight: 1.5,
        opacity: 0.55,
        dashArray: "4 4",
      }).addTo(g.tracks);
    }
  }, [cells, renderer]);

  // Hit markers: one per reached site, styled by the replay time below.
  useEffect(() => {
    const g = groups.current;
    if (!g) return;
    g.hits.clearLayers();
    const byId = new Map(dealerships.map((d) => [d.id, d]));
    hitMarkers.current = (impact?.hits ?? []).flatMap((hit) => {
      const d = byId.get(hit.id);
      if (!d) return [];
      const marker = L.circleMarker([d.lat, d.lon], {
        renderer,
        interactive: false,
        radius: 14,
        color: HAIL_CLASS_COLOR[hit.hailClass],
        weight: 3,
        opacity: 0,
        fillOpacity: 0,
      }).addTo(g.hits);
      return [{ firstAt: hit.firstAt, marker }];
    });
  }, [impact, dealerships, renderer]);

  // Per frame: the swath so far, the live cells and the hit rings.
  useEffect(() => {
    const g = groups.current;
    if (!g) return;
    const upTo = upperBoundByTime(cells, time);
    if (upTo < swathDrawn.current) {
      g.swath.clearLayers();
      swathDrawn.current = 0;
    }
    for (let i = swathDrawn.current; i < upTo; i++) {
      const c = cells[i];
      L.polygon(cellLatLngs(c), {
        renderer,
        interactive: false,
        stroke: false,
        fillColor: HAIL_CLASS_COLOR[c.c],
        fillOpacity: 0.12,
      }).addTo(g.swath);
    }
    swathDrawn.current = upTo;

    g.live.clearLayers();
    const static_ = detail != null && !detail.summary.timed;
    if (!static_) {
      for (const { cell, dLon, dLat } of replayFrame(cells, time)) {
        L.polygon(cellLatLngs(cell, dLon, dLat), {
          renderer,
          interactive: false,
          color: HAIL_CLASS_COLOR[cell.c],
          weight: 2,
          fillColor: HAIL_CLASS_COLOR[cell.c],
          fillOpacity: 0.55,
        }).addTo(g.live);
      }
    }

    for (const { firstAt, marker } of hitMarkers.current) {
      const since = time - firstAt;
      if (since < 0 && !static_) {
        marker.setStyle({ opacity: 0, fillOpacity: 0 });
        continue;
      }
      const fresh = !static_ && since < JUST_HIT_MS;
      const pulse = fresh ? 1 - since / JUST_HIT_MS : 0;
      marker.setRadius(12 + 10 * pulse);
      marker.setStyle({ opacity: 0.9, fillOpacity: 0.1 + 0.25 * pulse });
    }
  }, [cells, time, detail, renderer, impact]);

  // Clear everything when the event is closed.
  useEffect(() => {
    if (detail) return;
    const g = groups.current;
    if (!g) return;
    Object.values(g).forEach((layer) => layer.clearLayers());
    swathDrawn.current = 0;
    hitMarkers.current = [];
  }, [detail]);

  return null;
}
