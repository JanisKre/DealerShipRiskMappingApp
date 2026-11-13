"""Turn vehicle corrections you made in the app into training questions.

When you add or remove vehicle points on the map in the app, that is a label:
an added point is a vehicle the model missed, a removed point a false one.
This script reads them from the app's database (read-only) and feeds them into
the labelling pipeline, where you confirm them like any other pre-label.

    python harvest_app.py sites          # → data/app_sites.csv + data/app_feedback.json
    python fetch_tiles.py data/app_sites.csv
    python autolabel.py --sites $(python harvest_app.py ids)
    python harvest_app.py apply          # points → decisions / boxes in data/autolabel/
    python review.py                     # confirm as usual

Only analyses on a state orthophoto (DOP) are used: fetch_tiles.py loads the
same state service, and those licences allow it. Esri imagery is skipped. The
state service may have been re-flown since the analysis; review.py shows the
tile, so points that no longer fit are easy to spot and drop.

Site ids are `<state>-app<hash>`: no dealership names or customer ids leave
the database, and nothing here is committed (data/ is git-ignored).
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import sqlite3
from pathlib import Path

from autolabel import AUTOLABEL, read_tile
from common import DATA, TILE_PX, lonlat_to_3857
from fetch_tiles import SERVICES, site_grid

DEFAULT_DB = Path.home() / "Library" / "Application Support" / "Dealership Risk Mapping" / "dealership-risk.db"
SITES_CSV = DATA / "app_sites.csv"
FEEDBACK = DATA / "app_feedback.json"
MIN_RADIUS_M = 80
MARGIN_M = 20
CAR_PX = (46, 19)


def read_dealerships(db: Path) -> list[dict]:
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        rows = con.execute("SELECT data FROM sessions").fetchall()
    finally:
        con.close()
    out = []
    for (data,) in rows:
        payload = json.loads(data)
        out.extend(payload.get("dealerships", []) if isinstance(payload, dict) else payload)
    return out


def ground_distance_m(lat: float, lon: float, lat2: float, lon2: float) -> float:
    dy = (lat2 - lat) * 111_320
    dx = (lon2 - lon) * 111_320 * math.cos(math.radians(lat))
    return math.hypot(dx, dy)


def collect(dealerships: list[dict]) -> tuple[list[dict], dict, dict]:
    sites, feedback, skipped = [], {}, {"no edits": 0, "not a state DOP": 0}
    for d in dealerships:
        det = d.get("detection") or {}
        added = det.get("manualVehiclePoints") or []
        removed = det.get("manualVehicleRemovedPoints") or []
        if not added and not removed:
            skipped["no edits"] += 1
            continue
        chosen = (det.get("imagery") or {}).get("chosen") or {}
        state = chosen.get("state")
        if chosen.get("kind") != "state-dop" or state not in SERVICES:
            skipped["not a state DOP"] += 1
            continue
        key = f"{d.get('id', '')}|{d['lat']:.6f}|{d['lon']:.6f}"
        site_id = f"app{hashlib.sha256(key.encode()).hexdigest()[:10]}"
        points = added + removed
        radius = max([MIN_RADIUS_M] + [ground_distance_m(d["lat"], d["lon"], p["lat"], p["lon"]) + MARGIN_M for p in points])
        sites.append({"id": site_id, "lat": d["lat"], "lon": d["lon"], "state": state, "radius_m": round(radius)})
        feedback[f"{state}-{site_id}"] = {
            "lat": d["lat"],
            "lon": d["lon"],
            "radius_m": round(radius),
            "added": [[p["lon"], p["lat"]] for p in added],
            "removed": [[p["lon"], p["lat"]] for p in removed],
        }
    return sites, feedback, skipped


def cmd_sites(args) -> None:
    db = Path(args.db)
    if not db.exists():
        raise SystemExit(f"app database not found: {db}")
    sites, feedback, skipped = collect(read_dealerships(db))
    DATA.mkdir(exist_ok=True)
    with open(SITES_CSV, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["id", "lat", "lon", "state", "radius_m"])
        w.writeheader()
        w.writerows(sites)
    FEEDBACK.write_text(json.dumps(feedback, indent=1))
    n_add = sum(len(v["added"]) for v in feedback.values())
    n_rem = sum(len(v["removed"]) for v in feedback.values())
    print(f"{len(sites)} sites with corrections ({n_add} added, {n_rem} removed points) → {SITES_CSV}")
    print(f"skipped: {skipped['no edits']} without edits, {skipped['not a state DOP']} not analysed on a state DOP")


def to_tile(site: dict, lon: float, lat: float) -> tuple[int, int, float, float] | None:
    """(row, col, px, py) of a point in the site's tile grid, as fetch_tiles.py cut it."""
    n, x0, y1, edge = site_grid(site["lat"], site["lon"], site["radius_m"])
    x, y = lonlat_to_3857(lon, lat)
    col, row = math.floor((x - x0) / edge), math.floor((y1 - y) / edge)
    if not (0 <= col < n and 0 <= row < n):
        return None
    return row, col, (x - x0 - col * edge) / edge * TILE_PX, (y1 - row * edge - y) / edge * TILE_PX


def inside(px: float, py: float, corners: list[list[float]]) -> bool:
    hit = False
    for i in range(4):
        (xi, yi), (xj, yj) = corners[i], corners[i - 1]
        if (yi > py) != (yj > py) and px < (xj - xi) * (py - yi) / (yj - yi) + xi:
            hit = not hit
    return hit


def box_angle(corners: list[list[float]]) -> float:
    (x0, y0), (x1, y1), (x2, y2) = corners[:3]
    if math.hypot(x1 - x0, y1 - y0) >= math.hypot(x2 - x1, y2 - y1):
        return math.atan2(y1 - y0, x1 - x0)
    return math.atan2(y2 - y1, x2 - x1)


def manual_box(px: float, py: float, tile: dict) -> dict:
    """A car-sized box at the point, turned like the nearest box on the tile."""
    others = sorted(tile["boxes"], key=lambda b: math.dist((px, py), [sum(c) / 4 for c in zip(*b["corners"])]))
    ang = box_angle(others[0]["corners"]) if others else 0.0
    w, h = CAR_PX
    cos, sin = math.cos(ang), math.sin(ang)
    corners = [[px + dx * cos - dy * sin, py + dx * sin + dy * cos] for dx, dy in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2))]
    return {"origin": "manual", "bucket": "manual", "cls": 0, "decision": "car", "decidedBy": "app", "corners": corners, "score": 1.0, "votes": 0}


def cmd_apply(_args) -> None:
    if not FEEDBACK.exists():
        raise SystemExit("run `harvest_app.py sites` first")
    feedback = json.loads(FEEDBACK.read_text())
    stats = {"confirmed": 0, "added": 0, "rejected": 0, "unmatched removals": 0, "outside": 0, "no tile": 0}
    for site_id, site in feedback.items():
        per_tile: dict[str, list[tuple[str, float, float]]] = {}
        for kind in ("added", "removed"):
            for lon, lat in site[kind]:
                where = to_tile(site, lon, lat)
                if where is None:
                    stats["outside"] += 1
                    continue
                row, col, px, py = where
                per_tile.setdefault(f"{site_id}__{row}_{col}", []).append((kind, px, py))
        for stem, points in per_tile.items():
            path = AUTOLABEL / f"{stem}.json"
            if not path.exists():
                stats["no tile"] += len(points)
                continue
            tile = read_tile(path)
            for kind, px, py in points:
                hit = next((b for b in tile["boxes"] if inside(px, py, b["corners"])), None)
                if kind == "removed":
                    if hit is None:
                        stats["unmatched removals"] += 1
                    else:
                        hit.update(decision="no", decidedBy="app")
                        stats["rejected"] += 1
                elif hit is not None:
                    hit.update(decision="large_vehicle" if hit["cls"] == 1 else "car", decidedBy="app")
                    stats["confirmed"] += 1
                else:
                    tile["boxes"].append(manual_box(px, py, tile))
                    stats["added"] += 1
            for i, b in enumerate(tile["boxes"]):
                b["id"] = i
            path.write_text(json.dumps(tile, indent=1))
    print(", ".join(f"{v} {k}" for k, v in stats.items()))


def cmd_ids(_args) -> None:
    if FEEDBACK.exists():
        print(" ".join(json.loads(FEEDBACK.read_text())))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("sites", help="read corrections from the app database")
    p.add_argument("--db", default=str(DEFAULT_DB))
    sub.add_parser("apply", help="write the corrections into data/autolabel/")
    sub.add_parser("ids", help="print the harvested site ids (for autolabel.py --sites)")
    args = ap.parse_args()
    {"sites": cmd_sites, "apply": cmd_apply, "ids": cmd_ids}[args.cmd](args)


if __name__ == "__main__":
    main()
