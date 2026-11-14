/**
 * Minimal React bindings for Leaflet.
 *
 * Replaces react-leaflet, whose Hippocratic-2.1 licence adds use restrictions
 * that would bind every user of the app. Only the
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
import {
  ancestorTile,
  TILE_FALLBACK_LEVELS,
  type TileCoords,
} from "./tileFallback";

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
    // "Reduce motion" (OS setting): no zoom, fade or marker animations.
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const instance = L.map(containerRef.current, {
      ...(reduceMotion
        ? {
            zoomAnimation: false,
            fadeAnimation: false,
            markerZoomAnimation: false,
          }
        : {}),
      ...initialOptions,
    });
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

type TileLayerProps = L.TileLayerOptions & {
  url: string;
  /**
   * Draws the upscaled ancestor of a tile the source does not have, instead
   * of leaving a hole (archived imagery often ends above the map's max zoom).
   */
  ancestorFallback?: boolean;
};

/** A replaced source is dropped at the latest after this long. */
const TILE_HANDOVER_MS = 8000;

/** TileLayer that retries a failed tile with its ancestors, cropped. */
class FallbackTileLayer extends L.TileLayer {
  private readonly attempts = new WeakMap<
    HTMLElement,
    { coords: TileCoords; level: number }
  >();

  protected override createTile(
    coords: L.Coords,
    done: L.DoneCallback,
  ): HTMLElement {
    const tile = super.createTile(coords, done);
    this.attempts.set(tile, {
      coords: { x: coords.x, y: coords.y, z: coords.z },
      level: 0,
    });
    return tile;
  }

  /** Leaflet's error handler of a tile image. */
  protected override _tileOnError(
    done: L.DoneCallback,
    tile: HTMLElement,
    e: Error,
  ): void {
    const attempt = this.attempts.get(tile);
    const next =
      attempt && attempt.level < TILE_FALLBACK_LEVELS
        ? ancestorTile(attempt.coords, attempt.level + 1)
        : null;
    if (!attempt || !next) {
      super._tileOnError(done, tile, e);
      return;
    }
    attempt.level += 1;
    const internals = this as unknown as {
      _url: string;
      _getSubdomain: (coords: TileCoords) => string;
    };
    tile.style.setProperty("object-view-box", next.viewBox);
    (tile as HTMLImageElement).src = L.Util.template(internals._url, {
      r: "",
      s: internals._getSubdomain(next.coords),
      ...next.coords,
      ...this.options,
    });
  }
}

export function TileLayer({
  url,
  opacity,
  attribution,
  ancestorFallback = false,
  ...options
}: Readonly<TileLayerProps>): null {
  const map = useMap();
  const layerRef = useRef<L.TileLayer | null>(null);
  // Layers of earlier URLs, kept under the current one until it has drawn.
  const retiredRef = useRef(new Set<L.TileLayer>());
  // Options other than url, opacity and attribution are creation-time
  // options; callers key the component when they change (see MapPage).
  const [initialOptions] = useState(() => options);
  const attributionRef = useRef(attribution);
  attributionRef.current = attribution;

  useEffect(() => {
    const retired = retiredRef.current;
    const layerOptions = {
      ...initialOptions,
      attribution: attributionRef.current,
    };
    const layer = (
      ancestorFallback
        ? new FallbackTileLayer(url, layerOptions)
        : L.tileLayer(url, layerOptions)
    ).addTo(map);
    layerRef.current = layer;
    // Swapping the source must not blank the map while the new tiles load
    // (state WMS services take seconds): the old layer goes once the new one
    // is complete.
    const dropRetired = (): void => {
      for (const old of retired) old.remove();
      retired.clear();
    };
    const timer =
      retired.size > 0 ? window.setTimeout(dropRetired, TILE_HANDOVER_MS) : 0;
    if (retired.size > 0) layer.once("load", dropRetired);
    return () => {
      window.clearTimeout(timer);
      layer.off("load", dropRetired);
      layerRef.current = null;
      retired.add(layer);
    };
  }, [map, url, initialOptions, ancestorFallback]);

  // Unmount (declared after the effect above, so it runs after its cleanup).
  useEffect(() => {
    const retired = retiredRef.current;
    return () => {
      for (const old of retired) old.remove();
      retired.clear();
    };
  }, []);

  // The attribution changes with the place and zoom (Esri names the scene's
  // vendor); recreating the layer for it would reload every tile.
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || layer.options.attribution === attribution) return;
    const control = map.attributionControl as L.Control.Attribution | undefined;
    if (layer.options.attribution) {
      control?.removeAttribution(layer.options.attribution);
    }
    layer.options.attribution = attribution;
    if (attribution) control?.addAttribution(attribution);
  }, [map, attribution, url]);

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
  L.LatLngExpression[] | L.LatLngExpression[][] | L.LatLngExpression[][][];

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
