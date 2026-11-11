import {
  CADASTRE_MAP_COLOR,
  CADASTRE_MIN_ZOOM,
  cadastreAttribution,
  cadastreServicesInView,
  cadastreTileTemplate,
  type CadastreViewBounds,
} from "@shared/cadastre-sources";
import { tileBboxEpsg3857 } from "@shared/imagery-sources";
import { TileLayer } from "./leaflet-react";

/** Fills the `{bbox-epsg-3857}` placeholder of the WMS templates per tile. */
const BBOX_TEMPLATE_OPTION = {
  "bbox-epsg-3857": (d: { x: number; y: number; z: number }) =>
    tileBboxEpsg3857(d.z, d.x, d.y).join(","),
};

/** Same ceiling as the basemap; the services render vector data at any zoom. */
const CADASTRE_MAX_ZOOM = 19;

/** Referenced by the `.cadastre-recolor` rule in globals.css. */
const RECOLOR_FILTER_ID = "cadastre-recolor";

/**
 * Parcel (Flurstück) outlines from the open state cadastre WMS, drawn above
 * the basemap and below the vector layers. Only services whose state box
 * meets the view are mounted, so the attribution lists just those; Leaflet
 * additionally skips tiles outside each box and below the minimum zoom.
 *
 * Over aerial imagery the services' own outline style is shown (mostly
 * yellow). Over streets and terrain every drawn pixel is flooded with one
 * colour by an SVG filter that keeps only the tile's alpha, so lines and
 * parcel numbers of all states look alike and stay readable.
 */
export function CadastreLayer({
  bounds,
  overImagery,
}: Readonly<{
  bounds: CadastreViewBounds | null;
  overImagery: boolean;
}>): React.JSX.Element | null {
  if (!bounds) return null;
  const services = cadastreServicesInView(bounds);
  return (
    <>
      <svg
        aria-hidden
        width="0"
        height="0"
        style={{ position: "absolute", width: 0, height: 0 }}
      >
        <filter id={RECOLOR_FILTER_ID} colorInterpolationFilters="sRGB">
          <feFlood floodColor={CADASTRE_MAP_COLOR} />
          <feComposite in2="SourceAlpha" operator="in" />
        </filter>
      </svg>
      {services.map((service) => {
        const url = cadastreTileTemplate(service);
        return (
          <TileLayer
            // className is a creation-time option: remount on basemap switch.
            key={`${url}|${overImagery ? "imagery" : "map"}`}
            url={url}
            attribution={cadastreAttribution(service)}
            bounds={service.bounds}
            minZoom={CADASTRE_MIN_ZOOM}
            maxZoom={CADASTRE_MAX_ZOOM}
            zIndex={2}
            className={overImagery ? undefined : "cadastre-recolor"}
            {...BBOX_TEMPLATE_OPTION}
          />
        );
      })}
    </>
  );
}
