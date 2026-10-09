/**
 * Minimal React bindings for Leaflet.
 *
 * Replaces react-leaflet, whose Hippocratic-2.1 licence adds use restrictions
 * that are incompatible with this project's GPL-3.0-or-later licence. Only the
 * subset of the react-leaflet API this app uses is implemented, with the same
 * component names and props so call sites read the same:
 *
 * - `MapContainer`: `center`, `zoom` and other map options are read once on
 *   mount, as in react-leaflet.
 * - Layers are created on mount (and when a creation-only option such as
 *   `interactive` changes) and updated in place for geometry and style.
 * - `Tooltip` binds to the enclosing layer and renders its children through a
 *   portal, so React state and context keep working inside it.
 */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import L from "leaflet";

const MapContext = createContext<L.Map | null>(null);
const LayerContext = createContext<L.Layer | null>(null);

export function useMap(): L.Map {
  const map = useContext(MapContext);
  if (!map) throw new Error("useMap must be used inside <MapContainer>");
  return map;
}

/** Subscribes the handlers to map events and returns the map. */
export function useMapEvents(handlers: L.LeafletEventHandlerFnMap): L.Map {
  const map = useMap();
  useEffect(() => {
    map.on(handlers);
    return () => {
      map.off(handlers);
    };
  }, [map, handlers]);
  return map;
}

type MapContainerProps = L.MapOptions & {
  center: L.LatLngExpression;
  zoom: number;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
};

export function MapContainer({
  className,
  style,
  children,
  ...options
}: Readonly<MapContainerProps>): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  // Like react-leaflet, map options only apply on mount.
  const [initialOptions] = useState(() => options);
  const [map, setMap] = useState<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const instance = L.map(containerRef.current, initialOptions);
    setMap(instance);
    return () => {
      instance.remove();
      setMap(null);
    };
  }, [initialOptions]);

  return (
    <div ref={containerRef} className={className} style={style}>
      {map && <MapContext.Provider value={map}>{children}</MapContext.Provider>}
    </div>
  );
}

type TileLayerProps = L.TileLayerOptions & { url: string };

export function TileLayer({
  url,
  opacity,
  ...options
}: Readonly<TileLayerProps>): null {
  const map = useMap();
  const layerRef = useRef<L.TileLayer | null>(null);
  // Options other than url and opacity are creation-time options; callers key
  // the component when they change (see MapPage).
  const [initialOptions] = useState(() => options);

  useEffect(() => {
    const layer = L.tileLayer(url, initialOptions).addTo(map);
    layerRef.current = layer;
    return () => {
      layer.remove();
      layerRef.current = null;
    };
  }, [map, url, initialOptions]);

  useEffect(() => {
    layerRef.current?.setOpacity(opacity ?? 1);
  }, [opacity, url]);

  return null;
}

/** Adds a layer created by `create` to the map for the component's lifetime. */
function useLayer<T extends L.Layer>(
  create: () => T,
  recreateKey: unknown,
): T | null {
  const map = useMap();
  const createRef = useRef(create);
  createRef.current = create;
  const [layer, setLayer] = useState<T | null>(null);

  useEffect(() => {
    const instance = createRef.current().addTo(map);
    setLayer(instance);
    return () => {
      instance.remove();
      setLayer(null);
    };
  }, [map, recreateKey]);

  return layer;
}

function useEventHandlers(
  layer: L.Layer | null,
  handlers: L.LeafletEventHandlerFnMap | undefined,
): void {
  useEffect(() => {
    if (!layer || !handlers) return;
    layer.on(handlers);
    return () => {
      layer.off(handlers);
    };
  }, [layer, handlers]);
}

function usePathStyle(
  layer: L.Path | null,
  pathOptions: L.PathOptions | undefined,
): void {
  useEffect(() => {
    if (layer && pathOptions) layer.setStyle(pathOptions);
  }, [layer, pathOptions]);
}

function LayerChildren({
  layer,
  children,
}: Readonly<{
  layer: L.Layer | null;
  children?: ReactNode;
}>): React.JSX.Element | null {
  if (!layer || children == null) return null;
  return (
    <LayerContext.Provider value={layer}>{children}</LayerContext.Provider>
  );
}

interface PathProps {
  pathOptions?: L.PathOptions;
  eventHandlers?: L.LeafletEventHandlerFnMap;
  interactive?: boolean;
  children?: ReactNode;
}

export function Circle({
  center,
  radius,
  pathOptions,
  eventHandlers,
  interactive = true,
  children,
}: Readonly<
  PathProps & { center: L.LatLngExpression; radius: number }
>): React.JSX.Element | null {
  const layer = useLayer(
    () => L.circle(center, { ...pathOptions, radius, interactive }),
    interactive,
  );
  useEffect(() => {
    layer?.setLatLng(center);
  }, [layer, center]);
  useEffect(() => {
    layer?.setRadius(radius);
  }, [layer, radius]);
  usePathStyle(layer, pathOptions);
  useEventHandlers(layer, eventHandlers);
  return <LayerChildren layer={layer}>{children}</LayerChildren>;
}

export function CircleMarker({
  center,
  radius = 10,
  pathOptions,
  eventHandlers,
  interactive = true,
  children,
}: Readonly<
  PathProps & { center: L.LatLngExpression; radius?: number }
>): React.JSX.Element | null {
  const layer = useLayer(
    () => L.circleMarker(center, { ...pathOptions, radius, interactive }),
    interactive,
  );
  useEffect(() => {
    layer?.setLatLng(center);
  }, [layer, center]);
  useEffect(() => {
    layer?.setRadius(radius);
  }, [layer, radius]);
  usePathStyle(layer, pathOptions);
  useEventHandlers(layer, eventHandlers);
  return <LayerChildren layer={layer}>{children}</LayerChildren>;
}

type LatLngPositions =
  | L.LatLngExpression[]
  | L.LatLngExpression[][]
  | L.LatLngExpression[][][];

export function Polygon({
  positions,
  pathOptions,
  eventHandlers,
  interactive = true,
  children,
}: Readonly<
  PathProps & { positions: LatLngPositions }
>): React.JSX.Element | null {
  const layer = useLayer(
    () => L.polygon(positions, { ...pathOptions, interactive }),
    interactive,
  );
  useEffect(() => {
    layer?.setLatLngs(positions);
  }, [layer, positions]);
  usePathStyle(layer, pathOptions);
  useEventHandlers(layer, eventHandlers);
  return <LayerChildren layer={layer}>{children}</LayerChildren>;
}

export function Polyline({
  positions,
  pathOptions,
  eventHandlers,
  interactive = true,
  children,
}: Readonly<
  PathProps & { positions: L.LatLngExpression[] | L.LatLngExpression[][] }
>): React.JSX.Element | null {
  const layer = useLayer(
    () => L.polyline(positions, { ...pathOptions, interactive }),
    interactive,
  );
  useEffect(() => {
    layer?.setLatLngs(positions);
  }, [layer, positions]);
  usePathStyle(layer, pathOptions);
  useEventHandlers(layer, eventHandlers);
  return <LayerChildren layer={layer}>{children}</LayerChildren>;
}

export function Marker({
  position,
  icon,
  eventHandlers,
  interactive = true,
  children,
}: Readonly<{
  position: L.LatLngExpression;
  icon?: L.Icon | L.DivIcon;
  eventHandlers?: L.LeafletEventHandlerFnMap;
  interactive?: boolean;
  children?: ReactNode;
}>): React.JSX.Element | null {
  const layer = useLayer(
    () => L.marker(position, { interactive, ...(icon ? { icon } : {}) }),
    interactive,
  );
  useEffect(() => {
    layer?.setLatLng(position);
  }, [layer, position]);
  useEffect(() => {
    if (layer && icon) layer.setIcon(icon);
  }, [layer, icon]);
  useEventHandlers(layer, eventHandlers);
  return <LayerChildren layer={layer}>{children}</LayerChildren>;
}

/** Tooltip bound to the enclosing layer; children render via a portal. */
export function Tooltip({
  children,
  ...options
}: Readonly<
  L.TooltipOptions & { children?: ReactNode }
>): React.ReactPortal | null {
  const layer = useContext(LayerContext);
  const [container] = useState(() => document.createElement("div"));
  const [initialOptions] = useState(() => options);

  useEffect(() => {
    if (!layer) return;
    const tooltip = L.tooltip(initialOptions).setContent(container);
    layer.bindTooltip(tooltip);
    return () => {
      layer.unbindTooltip();
    };
  }, [layer, container, initialOptions]);

  return layer ? createPortal(children, container) : null;
}
