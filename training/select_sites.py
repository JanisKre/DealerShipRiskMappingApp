"""Pick a diverse set of dealership sites for labelling from an OSM dealer CSV.

    python select_sites.py ~/Downloads/car_dealerships_germany_500.csv --count 80

* keeps only states with an open orthophoto service (see fetch_tiles.SERVICES)
* drops entries that are not car dealers with a lot (inspection, rental,
  buy-up, classics, campers, …)
* drops sites within --min-distance of an already chosen one: their tiles
  would overlap and leak between the train and validation split
* spreads the picks over all states (round-robin), reproducible via --seed

Writes data/sites.csv (`id,lat,lon,state,name,city`), which stays git-ignored.
"""

from __future__ import annotations

import argparse
import csv
import math
import random
import re
from collections import defaultdict

from common import DATA
from fetch_tiles import SERVICES

STATE_CODES = {
    "Baden-Württemberg": "BW",
    "Bayern": "BY",
    "Berlin": "BE",
    "Brandenburg": "BB",
    "Bremen": "HB",
    "Hessen": "HE",
    "Mecklenburg-Vorpommern": "MV",
    "Niedersachsen": "NI",
    "Nordrhein-Westfalen": "NW",
    "Rheinland-Pfalz": "RP",
    "Saarland": "SL",
    "Sachsen": "SN",
    "Schleswig-Holstein": "SH",
    "Thüringen": "TH",
}

# Not a dealership lot: inspection, rental, buy-up, classics, campers, bikes, farm machinery, city showrooms
EXCLUDE = re.compile(
    r"KÜS|Prüfstelle|Enterprise|ankauf|verkaufen|Oldtimer|Classic|Wohnmobil|Reisemobil|kastenbus|"
    r"Bikes|Landtechnik|Pioneer Store|Kundencenter|autoservice|Makler",
    re.IGNORECASE,
)


def distance_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat = math.radians((a[0] + b[0]) / 2)
    dy = (a[0] - b[0]) * 111_320
    dx = (a[1] - b[1]) * 111_320 * math.cos(lat)
    return math.hypot(dx, dy)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("dealers_csv")
    ap.add_argument("--count", type=int, default=80)
    ap.add_argument("--min-distance", type=float, default=400, help="metres between chosen sites")
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    with open(args.dealers_csv, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))

    by_state: dict[str, list[dict]] = defaultdict(list)
    dropped = defaultdict(int)
    for r in rows:
        code = STATE_CODES.get(r["Federal State"])
        if code not in SERVICES:
            dropped[f"no open orthophoto service ({r['Federal State']})"] += 1
        elif EXCLUDE.search(r["Dealership Name"]) or EXCLUDE.search(r.get("Brand", "")):
            dropped["not a dealership lot"] += 1
        else:
            by_state[code].append(r)

    rng = random.Random(args.seed)
    for candidates in by_state.values():
        rng.shuffle(candidates)

    chosen: list[tuple[str, dict]] = []
    too_close = 0
    # Round-robin over states so every region is represented.
    while len(chosen) < args.count and any(by_state.values()):
        for code in sorted(by_state):
            if not by_state[code] or len(chosen) >= args.count:
                continue
            r = by_state[code].pop()
            pos = (float(r["Latitude"]), float(r["Longitude"]))
            if any(distance_m(pos, (float(c["Latitude"]), float(c["Longitude"]))) < args.min_distance for _, c in chosen):
                too_close += 1
                continue
            chosen.append((code, r))
    dropped[f"within {args.min_distance:.0f} m of a chosen site"] = too_close

    out = DATA / "sites.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["id", "lat", "lon", "state", "name", "city"])
        for code, r in sorted(chosen, key=lambda c: (c[0], int(c[1]["ID"]))):
            w.writerow([f"osm{r['OSM ID']}", r["Latitude"], r["Longitude"], code, r["Dealership Name"], r["City"]])

    per_state = defaultdict(int)
    for code, _ in chosen:
        per_state[code] += 1
    print(f"{len(chosen)} sites → {out}")
    print("per state:", ", ".join(f"{k} {v}" for k, v in sorted(per_state.items())))
    for reason, n in dropped.items():
        print(f"dropped {n:3}: {reason}")


if __name__ == "__main__":
    main()
