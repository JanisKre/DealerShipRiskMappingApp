"""Pick hard-negative sites: large rooftop solar arrays, which detectors read as parked cars.

The app removes detections on mapped roofs afterwards (desktop-app roof-mask.ts),
but a model that has seen such roofs during training makes fewer of these mistakes
in the first place, including on roofs OSM has not mapped.

    python select_negatives.py --count 40
    python fetch_tiles.py data/negatives.csv
    python prelabel.py --model runs/dealer-obb/weights/best.pt --classes own
    python label.py        # delete the boxes on the roof, keep real cars, tick

* queries OpenStreetMap (Overpass) per state with an open orthophoto service for
  rooftop PV drawn as an area (`generator:source=solar` + `location=roof`)
* keeps arrays of at least --min-size metres, i.e. commercial halls, not houses
* drops sites within --min-distance of a dealership in data/sites.csv or of an
  already chosen negative: their tiles would overlap and leak between splits
* spreads the picks over all states (round-robin), reproducible via --seed

Writes data/negatives.csv (`id,lat,lon,state,radius_m`; one 64 m tile per site),
which stays git-ignored. Site ids start with `neg`, see common.is_negative_site.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import random
import time
import urllib.parse
import urllib.request

from common import DATA, NEGATIVE_PREFIX, TARGET_GSD_M, TILE_PX
from fetch_tiles import SERVICES, USER_AGENT
from select_sites import distance_m

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
QUERY = """[out:json][timeout:180];
area["ISO3166-2"="DE-{state}"]->.state;
(
  way["generator:source"="solar"]["location"="roof"](area.state);
  way["generator:source"="solar"]["generator:place"="roof"](area.state);
);
out ids bb {limit};
"""


def overpass(query: str) -> list[dict]:
    body = urllib.parse.urlencode({"data": query}).encode()
    req = urllib.request.Request(OVERPASS_URL, data=body, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=240) as res:
        return json.load(res).get("elements", [])


def extent_m(bounds: dict) -> tuple[float, float]:
    """Width and height of a bounding box in metres."""
    lat = math.radians((bounds["minlat"] + bounds["maxlat"]) / 2)
    w = (bounds["maxlon"] - bounds["minlon"]) * 111_320 * math.cos(lat)
    h = (bounds["maxlat"] - bounds["minlat"]) * 111_320
    return w, h


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--count", type=int, default=40)
    ap.add_argument("--min-size", type=float, default=25, help="shorter side of the array in metres")
    ap.add_argument("--min-distance", type=float, default=400, help="metres to dealership and other negative sites")
    ap.add_argument("--per-state", type=int, default=1500, help="Overpass result limit per state")
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    dealers: list[tuple[float, float]] = []
    sites_csv = DATA / "sites.csv"
    if sites_csv.exists():
        with sites_csv.open(newline="", encoding="utf-8") as f:
            dealers = [(float(r["lat"]), float(r["lon"])) for r in csv.DictReader(f)]
    else:
        print("note: no data/sites.csv — cannot keep negatives away from dealership sites")

    rng = random.Random(args.seed)
    by_state: dict[str, list[tuple[str, float, float]]] = {}
    for state in sorted(SERVICES):
        try:
            elements = overpass(QUERY.format(state=state, limit=args.per_state))
        except Exception as err:  # noqa: BLE001 — keep going, report per state
            print(f"{state}: Overpass failed ({err})")
            continue
        candidates = []
        for el in elements:
            b = el.get("bounds")
            if not b or min(extent_m(b)) < args.min_size:
                continue
            lat, lon = (b["minlat"] + b["maxlat"]) / 2, (b["minlon"] + b["maxlon"]) / 2
            candidates.append((f"{NEGATIVE_PREFIX}{el['type'][0]}{el['id']}", lat, lon))
        rng.shuffle(candidates)
        by_state[state] = candidates
        print(f"{state}: {len(candidates)} of {len(elements)} rooftop arrays ≥ {args.min_size:.0f} m")
        time.sleep(2)  # be polite to the public Overpass instance

    chosen: list[tuple[str, str, float, float]] = []
    too_close = 0
    # Round-robin over states so every region is represented.
    while len(chosen) < args.count and any(by_state.values()):
        for state in sorted(by_state):
            if not by_state[state] or len(chosen) >= args.count:
                continue
            sid, lat, lon = by_state[state].pop()
            taken = dealers + [(c[2], c[3]) for c in chosen]
            if any(distance_m((lat, lon), p) < args.min_distance for p in taken):
                too_close += 1
                continue
            chosen.append((sid, state, lat, lon))

    out = DATA / "negatives.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    radius = TILE_PX * TARGET_GSD_M / 2  # exactly one tile per site
    with out.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["id", "lat", "lon", "state", "radius_m"])
        for sid, state, lat, lon in sorted(chosen, key=lambda c: (c[1], c[0])):
            w.writerow([sid, f"{lat:.7f}", f"{lon:.7f}", state, f"{radius:g}"])
    print(f"{len(chosen)} negative sites → {out} ({too_close} dropped as too close)")


if __name__ == "__main__":
    main()
