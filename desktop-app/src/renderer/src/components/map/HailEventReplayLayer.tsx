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
import { groundKm } from "@shared/hail-sim";
import { useHailSimActions } from "@renderer/lib/useHailSimActions";
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

  const mapMode = useHailReplayStore((s) => s.mapMode);
  const { simulateAt, simulateAlong } = useHailSimActions();

  const renderer = useMemo(() => L.canvas({ padding: 0.3 }), []);

  // "Pick a start point": the next click on the map starts a storm there.
  useEffect(() => {
    if (mapMode !== "pickStart") return undefined;
    const container = map.getContainer();
    container.style.cursor = "crosshair";
    const onClick = (e: L.LeafletMouseEvent): void =>
      simulateAt([e.latlng.lng, e.latlng.lat]);
    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
      container.style.cursor = "";
    };
  }, [map, mapMode, simulateAt]);

  // "Draw a track": clicks add points, a double click (or the panel's
  // "done" button) turns the line into a storm. Own handling instead of
  // Geoman: its hint marker under the cursor swallowed the double click.
  const drawPoints = useHailReplayStore((s) => s.drawPoints);
  useEffect(() => {
    if (mapMode !== "draw") return undefined;
    const container = map.getContainer();
    container.style.cursor = "crosshair";
    map.doubleClickZoom.disable();
    const onClick = (e: L.LeafletMouseEvent): void => {
      const st = useHailReplayStore.getState();
      const point: [number, number] = [e.latlng.lng, e.latlng.lat];
      const last = st.drawPoints.at(-1);
      // The two clicks of a double click land on the same spot.
      if (last && groundKm(last, point) < 0.2) return;
      st.setDrawPoints([...st.drawPoints, point]);
    };
    const onDblClick = (): void => {
      const points = useHailReplayStore.getState().drawPoints;
      if (points.length >= 2) simulateAlong(points);
    };
    map.on("click", onClick);
    map.on("dblclick", onDblClick);
    return () => {
      map.off("click", onClick);
      map.off("dblclick", onDblClick);
      map.doubleClickZoom.enable();
      container.style.cursor = "";
    };
  }, [map, mapMode, simulateAlong]);

  // The track being drawn.
  useEffect(() => {
    if (drawPoints.length === 0) return undefined;
    const latlngs = drawPoints.map(([lon, lat]) => [lat, lon] as L.LatLngTuple);
    const group = L.layerGroup().addTo(map);
    L.polyline(latlngs, {
      interactive: false,
      color: "#b91c1c",
      weight: 3,
      dashArray: "6 6",
    }).addTo(group);
    for (const ll of latlngs)
      L.circleMarker(ll, {
        interactive: false,
        radius: 5,
        color: "#b91c1c",
        weight: 2,
        fillColor: "#fff",
        fillOpacity: 1,
      }).addTo(group);
    return () => {
      group.remove();
    };
  }, [map, drawPoints]);
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
      {
        // Room for the event card at the top and the layer panel at the
        // bottom right; at most a third of a narrow map each, or Leaflet
        // would zoom out to Europe.
        paddingTopLeft: [48, Math.min(200, map.getSize().y * 0.3)],
        paddingBottomRight: [
          Math.min(280, map.getSize().x * 0.3),
          Math.min(96, map.getSize().y * 0.15),
        ],
        maxZoom: 11,
      },
    );
    // Only on a new event, not on every shift.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, eventId]);

  // A handle in the middle of the event: drag it to move the whole storm
  // ("what if it had passed 30 km further south").
  const shift = useHailReplayStore((st) => st.shift);
  const handle = useRef<L.Marker | null>(null);
  const dragStart = useRef<{
    lat: number;
    lon: number;
    east: number;
    north: number;
  } | null>(null);
  useEffect(() => {
    if (!detail) return undefined;
    const [w, s0, e, n] = detail.summary.bbox;
    const lat0 = (s0 + n) / 2;
    const lon0 = (w + e) / 2;
    const icon = L.divIcon({
      className: "",
      iconSize: [30, 30],
      iconAnchor: [15, 15],
      html:
        '<div style="width:30px;height:30px;border-radius:9999px;background:#fff;border:2px solid #b91c1c;box-shadow:0 1px 4px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;cursor:grab">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#b91c1c" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3"/></svg></div>',
    });
    const marker = L.marker([lat0, lon0], {
      icon,
      draggable: true,
      keyboard: false,
      zIndexOffset: 1000,
    }).addTo(map);
    marker.on("dragstart", () => {
      const st = useHailReplayStore.getState();
      const ll = marker.getLatLng();
      dragStart.current = {
        lat: ll.lat,
        lon: ll.lng,
        east: st.shift.eastKm,
        north: st.shift.northKm,
      };
    });
    marker.on("drag", () => {
      const from = dragStart.current;
      if (!from) return;
      const ll = marker.getLatLng();
      const kx = 111.32 * Math.cos((lat0 * Math.PI) / 180);
      useHailReplayStore.getState().setShift({
        eastKm: Math.round((from.east + (ll.lng - from.lon) * kx) * 10) / 10,
        northKm:
          Math.round((from.north + (ll.lat - from.lat) * 111.32) * 10) / 10,
      });
    });
    marker.on("dragend", () => {
      dragStart.current = null;
    });
    handle.current = marker;
    return () => {
      marker.remove();
      handle.current = null;
    };
    // A new handle per event; the shift moves it below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, eventId]);

  // Keep the handle on the moved event (e.g. after "reset").
  useEffect(() => {
    const marker = handle.current;
    if (!marker || !detail || dragStart.current) return;
    const [w, s0, e, n] = detail.summary.bbox;
    const lat0 = (s0 + n) / 2;
    const kx = 111.32 * Math.cos((lat0 * Math.PI) / 180);
    marker.setLatLng([
      lat0 + shift.northKm / 111.32,
      (w + e) / 2 + shift.eastKm / kx,
    ]);
  }, [shift, detail]);

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
        fillOpacity: 0.22,
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
          weight: 2.5,
          fillColor: HAIL_CLASS_COLOR[cell.c],
          fillOpacity: 0.7,
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
