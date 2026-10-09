"""Download orthophoto tiles around dealership sites for labelling.

Each 640x640 tile covers exactly TILE_PX * TARGET_GSD_M ground metres. WMS
services render it directly at that size; XYZ services (Bavaria) are
stitched from map tiles and resampled.

Input CSV columns: `id,lat,lon` plus `state` (two-letter code, e.g. NW) and
optionally `radius_m` (default 80). `select_sites.py` writes such a file.

    python fetch_tiles.py data/sites.csv            # service per row from `state`
    python fetch_tiles.py my.csv --service NW       # one service for all rows

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

from PIL import Image, ImageStat

from common import DATA, EARTH_HALF_CIRCUMFERENCE, TARGET_GSD_M, TILE_PX, lonlat_to_3857, mercator_scale

SERVICES = {
    # state: (kind, url, WMS layer or XYZ zoom, native GSD m, licence)
    "NW": ("wms", "https://www.wms.nrw.de/geobasis/wms_nw_dop", "nw_dop_rgb", 0.1, "dl-de/zero-2-0"),
    "HB": ("wms", "https://geodienste.bremen.de/wms_dop_lb", "dop10_2025_HB", 0.1, "CC BY"),
    "NI": ("wms", "https://opendata.lgln.niedersachsen.de/doorman/noauth/dop_wms", "ni_dop20", 0.2, "CC BY 4.0"),
    "BW": ("wms", "https://owsproxy.lgl-bw.de/owsproxy/ows/WMS_LGL-BW_ATKIS_DOP_20_C", "IMAGES_DOP_20_RGB", 0.2, "dl-de/by-2-0"),
    "BE": ("wms", "https://gdi.berlin.de/services/wms/truedop_2024", "truedop_2024", 0.2, "dl-de/zero-2-0"),
    "BB": ("wms", "https://isk.geobasis-bb.de/mapproxy/dop20c/service/wms", "bebb_dop20c", 0.2, "dl-de/by-2-0"),
    "HE": ("wms", "https://www.gds-srv.hessen.de/cgi-bin/lika-services/ogc-free-images.ows?language=ger", "he_dop20_rgb", 0.2, "§ 24 HVGG"),
    "MV": ("wms", "https://www.geodaten-mv.de/dienste/adv_dop", "mv_dop", 0.2, "GeoBasis-DE/M-V"),
    "RP": ("wms", "https://geo4.service24.rlp.de/wms/rp_dop20.fcgi", "rp_dop20", 0.2, "dl-de/by-2-0"),
    "SL": ("wms", "https://geoportal.saarland.de/freewms/dop", "sl_dop", 0.2, "GeoBasis-DE/LVGL-SL"),
    "SN": ("wms", "https://geodienste.sachsen.de/wms_geosn_dop-rgb/guest", "sn_dop_020", 0.2, "dl-de/by-2-0"),
    "SH": ("wms", "https://service.gdi-sh.de/WMS_SH_DOP20col_OpenGBD", "sh_dop20_rgb", 0.2, "CC BY 4.0"),
    "TH": ("wms", "https://www.geoproxy.geoportal-th.de/geoproxy/services/DOP", "th_dop", 0.2, "CC BY 4.0"),
    "BY": ("xyz", "https://wmtsod1.bayernwolke.de/wmts/by_dop/smerc/{z}/{x}/{y}", 19, 0.2, "CC BY 4.0"),
}

USER_AGENT = "DealershipRiskMapping-training/1.0 (local research use)"


def http_image(url: str) -> Image.Image:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as res:
        body = res.read()
        ctype = res.headers.get("Content-Type", "")
    if "image" not in ctype:
        raise RuntimeError(f"service returned {ctype}: {body[:200]!r}")
    return Image.open(io.BytesIO(body)).convert("RGB")


def wms_tile(url: str, layer: str, bbox: tuple[float, float, float, float]) -> Image.Image:
    params = {
        "SERVICE": "WMS",
        "VERSION": "1.3.0",
        "REQUEST": "GetMap",
        "LAYERS": layer,
        "STYLES": "",
        "CRS": "EPSG:3857",
        "BBOX": ",".join(f"{v:.3f}" for v in bbox),
        "WIDTH": str(TILE_PX),
        "HEIGHT": str(TILE_PX),
        "FORMAT": "image/jpeg",
    }
    return http_image(url + ("&" if "?" in url else "?") + urllib.parse.urlencode(params))


def xyz_tile(template: str, z: int, bbox: tuple[float, float, float, float], cache: dict) -> Image.Image:
    """Stitches 256 px map tiles covering an EPSG:3857 bbox and resamples to TILE_PX."""
    size = 2 * EARTH_HALF_CIRCUMFERENCE / 2**z  # tile edge in 3857 units
    to_px = lambda x, y: ((x + EARTH_HALF_CIRCUMFERENCE) / size * 256, (EARTH_HALF_CIRCUMFERENCE - y) / size * 256)  # noqa: E731
    left, top = to_px(bbox[0], bbox[3])
    right, bottom = to_px(bbox[2], bbox[1])
    tx0, ty0, tx1, ty1 = int(left // 256), int(top // 256), int(right // 256), int(bottom // 256)
    canvas = Image.new("RGB", ((tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256))
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            key = (z, tx, ty)
            if key not in cache:
                cache[key] = http_image(template.format(z=z, x=tx, y=ty))
            canvas.paste(cache[key], ((tx - tx0) * 256, (ty - ty0) * 256))
    crop = (left - tx0 * 256, top - ty0 * 256, right - tx0 * 256, bottom - ty0 * 256)
    return canvas.resize((TILE_PX, TILE_PX), Image.BICUBIC, box=crop)


def looks_empty(img: Image.Image) -> bool:
    """Blank/no-coverage responses are a single colour."""
    return max(ImageStat.Stat(img).stddev) < 3


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("sites_csv")
    ap.add_argument("--service", choices=sorted(SERVICES), help="override the per-row `state` column")
    ap.add_argument("--radius", type=float, default=80, help="default radius in metres when the CSV has none")
    ap.add_argument("--out", default=str(DATA / "raw"))
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    tile_m = TILE_PX * TARGET_GSD_M  # ground metres per tile edge

    with open(args.sites_csv, newline="") as f:
        sites = list(csv.DictReader(f))
    failed = 0
    for i, site in enumerate(sites, 1):
        state = args.service or site.get("state", "")
        if state not in SERVICES:
            print(f"skip {site['id']}: no service for state {state!r}")
            continue
        kind, url, layer, _, licence = SERVICES[state]
        sid = f"{state}-{site['id']}".replace("__", "_").replace("/", "-")
        lat, lon = float(site["lat"]), float(site["lon"])
        radius = float(site.get("radius_m") or args.radius)
        n = max(1, math.ceil(2 * radius / tile_m))
        cx, cy = lonlat_to_3857(lon, lat)
        edge = tile_m * mercator_scale(lat)  # tile edge in EPSG:3857 units
        x0, y1 = cx - n * edge / 2, cy + n * edge / 2
        cache: dict = {}
        for row in range(n):
            for col in range(n):
                path = out / f"{sid}__{row}_{col}.jpg"
                if path.exists():
                    continue
                bbox = (x0 + col * edge, y1 - (row + 1) * edge, x0 + (col + 1) * edge, y1 - row * edge)
                try:
                    img = wms_tile(url, layer, bbox) if kind == "wms" else xyz_tile(url, layer, bbox, cache)
                    if looks_empty(img):
                        raise RuntimeError("empty image (no coverage?)")
                    img.save(path, quality=95)
                except Exception as err:  # noqa: BLE001 — keep going, report per tile
                    failed += 1
                    print(f"  {path.name}: {err}")
                time.sleep(0.2)  # be polite to public services
        print(f"[{i}/{len(sites)}] {sid}: {n}x{n} tiles ({licence})")
    print(f"done, {failed} tiles failed" if failed else "done")


if __name__ == "__main__":
    main()
