import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { AnalyzedDealership, BoundaryGeometry } from "@shared/types";
import {
  resolveStateService,
  stateTileTemplate,
} from "@shared/imagery-sources";
import { waybackTileTemplate } from "@shared/imagery-wayback";
import {
  CircleMarker,
  MapContainer,
  Polygon,
  TileLayer,
  useMap,
} from "@renderer/components/map/leaflet-react";
import {
  BBOX_TEMPLATE_OPTION,
  TILE_URLS,
  tileAttributions,
} from "@renderer/components/map/basemapTiles";
import { geometryBounds } from "@renderer/components/map/mapSelection";

/** [lon,lat] rings → Leaflet [lat,lon] positions (Polygon or MultiPolygon). */
function positionsOf(geometry: BoundaryGeometry): [number, number][][][] {
  const rings =
    geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return rings.map((polygon) =>
    polygon.map((ring) => ring.map(([lon, lat]) => [lat, lon])),
  );
}

/**
 * The image the vehicles were counted on, so the outline and the dots sit
 * on the same capture as on the map; Esri otherwise.
 */
function countedImageTiles(d: AnalyzedDealership): {
  url: string;
  maxNativeZoom?: number;
} {
  const chosen = d.detection?.imagery?.chosen;
  if (chosen?.kind === "state-dop" && chosen.state) {
    const service = resolveStateService(chosen.state, chosen.vintage);
    if (service)
      return {
        url: stateTileTemplate(service),
        maxNativeZoom: service.maxZoom,
      };
  }
  if (chosen?.kind === "esri-wayback" && chosen.wayback)
    return { url: waybackTileTemplate(chosen.wayback.release) };
  return { url: TILE_URLS.satellite };
}

/** Fits the current boundary and the compared one once both are known. */
function FitTo({
  geometries,
}: Readonly<{ geometries: BoundaryGeometry[] }>): null {
  const map = useMap();
  useEffect(() => {
    const boxes = geometries
      .map((g) => geometryBounds(g))
      .filter((b): b is NonNullable<typeof b> => b != null);
    if (boxes.length === 0) return;
    const south = Math.min(...boxes.map((b) => b[0][0]));
    const west = Math.min(...boxes.map((b) => b[0][1]));
    const north = Math.max(...boxes.map((b) => b[1][0]));
    const east = Math.max(...boxes.map((b) => b[1][1]));
    map.fitBounds(
      [
        [south, west],
        [north, east],
      ],
      { padding: [12, 12], maxZoom: 19 },
    );
  }, [map, geometries]);
  return null;
}

/**
 * The lot on its aerial image, inside the detail: the current boundary
 * solid, a suggestion being compared dashed, the counted vehicles as dots.
 * A boundary is confirmed or swapped here, so it has to be seen here, not
 * only after a jump to the map (UX review, November 2026).
 */
export function BoundaryPreview({
  d,
  compare,
  frame,
}: Readonly<{
  d: AnalyzedDealership;
  /** A suggestion to draw next to the current boundary (hovered or chosen). */
  compare?: BoundaryGeometry | null;
  /**
   * Every suggestion that may be compared: the view frames them all once,
   * so pointing at one does not make the image jump.
   */
  frame?: BoundaryGeometry[];
}>): React.JSX.Element | null {
  const { t } = useTranslation();
  const boundary = d.boundary;
  const tiles = useMemo(() => countedImageTiles(d), [d]);
  const current = useMemo(
    () => (boundary ? positionsOf(boundary.polygon) : null),
    [boundary],
  );
  const compared = useMemo(
    () => (compare ? positionsOf(compare) : null),
    [compare],
  );
  const fit = useMemo(
    () =>
      [boundary?.polygon, ...(frame ?? [])].filter(
        (g): g is BoundaryGeometry => g != null,
      ),
    // Refit only when the site's boundary or its suggestions change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boundary, frame?.length],
  );
  const points = useMemo(
    () =>
      (d.detection?.boxes ?? []).flatMap((box) =>
        box.lat != null && box.lon != null
          ? [[box.lat, box.lon] as [number, number]]
          : [],
      ),
    [d.detection],
  );
  if (!boundary || !current) return null;
  return (
    <figure className="space-y-1">
      <MapContainer
        // Remount per site: map options only apply on mount.
        key={d.id}
        center={[d.lat, d.lon]}
        zoom={18}
        zoomControl={false}
        attributionControl={false}
        scrollWheelZoom={false}
        className="h-64 w-full overflow-hidden rounded-md border bg-muted"
      >
        <TileLayer
          key={tiles.url}
          url={tiles.url}
          maxZoom={20}
          maxNativeZoom={tiles.maxNativeZoom}
          attribution={tileAttributions(t).satellite}
          // WMS templates of the state orthophotos take a bbox per tile.
          {...BBOX_TEMPLATE_OPTION}
        />
        <Polygon
          positions={current}
          interactive={false}
          pathOptions={{
            color: "#2563eb",
            weight: 2,
            fillOpacity: 0.08,
            dashArray: boundary.source === "synthetic" ? "6 4" : undefined,
          }}
        />
        {compared && (
          <Polygon
            positions={compared}
            interactive={false}
            pathOptions={{
              color: "#f59e0b",
              weight: 2.5,
              fillOpacity: 0.06,
              dashArray: "5 4",
            }}
          />
        )}
        {points.map((point, index) => (
          <CircleMarker
            key={index}
            center={point}
            radius={2.5}
            interactive={false}
            pathOptions={{
              color: "#ffffff",
              weight: 1,
              fillColor: "#2563eb",
              fillOpacity: 1,
            }}
          />
        ))}
        <FitTo geometries={fit} />
      </MapContainer>
      <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-0.5 w-3 bg-[#2563eb]" />
          {t("dashboard.detailDialog.previewCurrent")}
        </span>
        {compared && (
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-0.5 w-3 border-t-2 border-dashed border-[#f59e0b]" />
            {t("dashboard.detailDialog.previewCompared")}
          </span>
        )}
        {points.length > 0 && (
          <span className="inline-flex items-center gap-1">
            <span className="inline-block size-1.5 rounded-full bg-[#2563eb]" />
            {t("dashboard.detailDialog.previewVehicles", {
              count: points.length,
            })}
          </span>
        )}
      </figcaption>
    </figure>
  );
}
