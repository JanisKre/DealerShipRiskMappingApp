"""Download orthophoto tiles around dealership sites for labelling.

Requests each 640x640 tile directly from a state orthophoto WMS at exactly
TARGET_GSD_M, so no resampling artefacts are baked into the training data.

Input CSV columns: `id,lat,lon` and optionally `radius_m` (default 80).

    python fetch_tiles.py sites.csv --service NW
    python fetch_tiles.py sites.csv --service NI --radius 120

Open state services (licence in brackets — keep the attribution when you
publish anything derived from them). Mirrors desktop-app/src/shared/imagery-sources.ts.
"""

from __future__ import annotations

import argparse
import csv
import io
import math
import time
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

from common import DATA, TARGET_GSD_M, TILE_PX, lonlat_to_3857, mercator_scale

SERVICES = {
    # state: (WMS url, layer, native GSD m, licence)
    "NW": ("https://www.wms.nrw.de/geobasis/wms_nw_dop", "nw_dop_rgb", 0.1, "dl-de/zero-2-0"),
    "HB": ("https://geodienste.bremen.de/wms_dop_lb", "dop10_2025_HB", 0.1, "CC BY"),
    "NI": ("https://opendata.lgln.niedersachsen.de/doorman/noauth/dop_wms", "ni_dop20", 0.2, "CC BY 4.0"),
    "BW": ("https://owsproxy.lgl-bw.de/owsproxy/ows/WMS_LGL-BW_ATKIS_DOP_20_C", "IMAGES_DOP_20_RGB", 0.2, "dl-de/by-2-0"),
    "BE": ("https://gdi.berlin.de/services/wms/truedop_2024", "truedop_2024", 0.2, "dl-de/zero-2-0"),
    "BB": ("https://isk.geobasis-bb.de/mapproxy/dop20c/service/wms", "bebb_dop20c", 0.2, "dl-de/by-2-0"),
    "RP": ("https://geo4.service24.rlp.de/wms/rp_dop20.fcgi", "rp_dop20", 0.2, "dl-de/by-2-0"),
    "SN": ("https://geodienste.sachsen.de/wms_geosn_dop-rgb/guest", "sn_dop_020", 0.2, "dl-de/by-2-0"),
    "SH": ("https://service.gdi-sh.de/WMS_SH_DOP20col_OpenGBD", "sh_dop20_rgb", 0.2, "CC BY 4.0"),
}

USER_AGENT = "DealershipRiskMapping-training/1.0 (local research use)"


def getmap(url: str, layer: str, bbox3857: tuple[float, float, float, float]) -> Image.Image:
    params = {
        "SERVICE": "WMS",
        "VERSION": "1.3.0",
        "REQUEST": "GetMap",
        "LAYERS": layer,
        "STYLES": "",
        "CRS": "EPSG:3857",
        "BBOX": ",".join(f"{v:.3f}" for v in bbox3857),
        "WIDTH": str(TILE_PX),
        "HEIGHT": str(TILE_PX),
        "FORMAT": "image/jpeg",
    }
    sep = "&" if "?" in url else "?"
    req = urllib.request.Request(url + sep + urllib.parse.urlencode(params), headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as res:
        body = res.read()
        ctype = res.headers.get("Content-Type", "")
    if "image" not in ctype:
        raise RuntimeError(f"WMS returned {ctype}: {body[:200]!r}")
    return Image.open(io.BytesIO(body)).convert("RGB")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("sites_csv")
    ap.add_argument("--service", required=True, choices=sorted(SERVICES))
    ap.add_argument("--radius", type=float, default=80, help="default radius in metres when the CSV has none")
    ap.add_argument("--out", default=str(DATA / "raw"))
    args = ap.parse_args()

    url, layer, native_gsd, licence = SERVICES[args.service]
    if native_gsd > TARGET_GSD_M:
        print(f"note: {args.service} is {native_gsd} m/px; tiles are upsampled by the server to {TARGET_GSD_M} m/px")
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    tile_m = TILE_PX * TARGET_GSD_M  # ground metres per tile edge

    with open(args.sites_csv, newline="") as f:
        sites = list(csv.DictReader(f))
    for site in sites:
        sid = f"{args.service}-{site['id']}".replace("__", "_").replace("/", "-")
        lat, lon = float(site["lat"]), float(site["lon"])
        radius = float(site.get("radius_m") or args.radius)
        n = max(1, math.ceil(2 * radius / tile_m))
        cx, cy = lonlat_to_3857(lon, lat)
        edge = tile_m * mercator_scale(lat)  # tile edge in EPSG:3857 units
        x0 = cx - n * edge / 2
        y1 = cy + n * edge / 2
        for row in range(n):
            for col in range(n):
                path = out / f"{sid}__{row}_{col}.jpg"
                if path.exists():
                    continue
                bbox = (x0 + col * edge, y1 - (row + 1) * edge, x0 + (col + 1) * edge, y1 - row * edge)
                try:
                    getmap(url, layer, bbox).save(path, quality=95)
                except Exception as err:  # noqa: BLE001 — keep going, report per tile
                    print(f"  {path.name}: {err}")
                time.sleep(0.2)  # be polite to public services
        print(f"{sid}: {n}x{n} tiles ({licence})")


if __name__ == "__main__":
    main()
