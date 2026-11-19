"""Pick a diverse set of dealership sites for labelling from an OSM dealer CSV.

    python select_sites.py ~/Downloads/car_dealerships_germany_500.csv --count 80

* keeps only states with an open orthophoto service (see fetch_tiles.SERVICES)
* drops entries that are not car dealers with a lot (inspection, rental,
  buy-up, classics, campers, …)
* drops sites within --min-distance of an already chosen one: their tiles
  would overlap and leak between the train and validation split
* spreads the picks over all states (round-robin), reproducible via --seed

Writes data/sites.csv (`id,lat,lon,state,name,city`), which stays git-ignored.

With --extend the sites already in data/sites.csv stay as they are (their tiles
and labels keep their names) and --count new sites are appended, each at least
--min-distance from every existing one. The new ids are also written to
data/sites-added-<date>.txt: sites no model has seen yet, for a clean test.
--test-share puts that share of the new sites (per state, at least one per
state) into data/test_sites.txt: make_dataset.py keeps them out of train and
val for good, so they stay unseen.

    python select_sites.py car_dealerships_germany_500.csv --extend --count 120 --test-share 0.5
"""

from __future__ import annotations

import argparse
import csv
import math
import random
import re
from collections import defaultdict
from datetime import date

from common import DATA, TEST_SITES
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


COLUMNS = ["id", "lat", "lon", "state", "name", "city"]


def pick_test(sites: list[str], share: float, seed: int) -> list[str]:
    """`share` of the sites of every state (rounded, at least one), drawn with `seed`."""
    by_state: dict[str, list[str]] = defaultdict(list)
    for s in sorted(sites):
        by_state[s.split("-", 1)[0]].append(s)
    rng = random.Random(seed)
    picked = []
    for state in sorted(by_state):
        group = by_state[state]
        rng.shuffle(group)
        picked += group[: max(1, round(share * len(group)))]
    return sorted(picked)


def read_existing(path) -> list[dict]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


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
    ap.add_argument("--extend", action="store_true", help="keep data/sites.csv and append --count new sites")
    ap.add_argument("--test-share", type=float, default=0.0, help="with --extend: share of the new sites held out as test sites")
    args = ap.parse_args()

    out = DATA / "sites.csv"
    existing = read_existing(out) if args.extend else []
    taken = {r["id"] for r in existing}

    with open(args.dealers_csv, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))

    by_state: dict[str, list[dict]] = defaultdict(list)
    dropped = defaultdict(int)
    for r in rows:
        code = STATE_CODES.get(r["Federal State"])
        if f"osm{r['OSM ID']}" in taken:
            dropped["already in the site list"] += 1
        elif code not in SERVICES:
            dropped[f"no open orthophoto service ({r['Federal State']})"] += 1
        elif EXCLUDE.search(r["Dealership Name"]) or EXCLUDE.search(r.get("Brand", "")):
            dropped["not a dealership lot"] += 1
        else:
            by_state[code].append(r)

    rng = random.Random(args.seed)
    for candidates in by_state.values():
        rng.shuffle(candidates)

    chosen: list[tuple[str, dict]] = []
    near = [(float(r["lat"]), float(r["lon"])) for r in existing]
    too_close = 0
    # Round-robin over states so every region is represented.
    while len(chosen) < args.count and any(by_state.values()):
        for code in sorted(by_state):
            if not by_state[code] or len(chosen) >= args.count:
                continue
            r = by_state[code].pop()
            pos = (float(r["Latitude"]), float(r["Longitude"]))
            if any(distance_m(pos, p) < args.min_distance for p in near):
                too_close += 1
                continue
            chosen.append((code, r))
            near.append(pos)
    dropped[f"within {args.min_distance:.0f} m of a chosen site"] = too_close

    out.parent.mkdir(parents=True, exist_ok=True)
    added = [
        {"id": f"osm{r['OSM ID']}", "lat": r["Latitude"], "lon": r["Longitude"], "state": code, "name": r["Dealership Name"], "city": r["City"]}
        for code, r in sorted(chosen, key=lambda c: (c[0], int(c[1]["ID"])))
    ]
    with out.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS, extrasaction="ignore")
        w.writeheader()
        w.writerows(existing + added)
    if args.extend:
        added_file = DATA / f"sites-added-{date.today().isoformat()}.txt"
        added_file.write_text("".join(f"{a['state']}-{a['id']}\n" for a in added))
        print(f"kept {len(existing)} sites, {len(added)} new ones also listed in {added_file}")
        if args.test_share > 0:
            test = pick_test([f"{a['state']}-{a['id']}" for a in added], args.test_share, args.seed)
            old = TEST_SITES.read_text().split() if TEST_SITES.exists() else []
            TEST_SITES.write_text("".join(f"{t}\n" for t in sorted(set(old) | set(test))))
            print(f"{len(test)} of them held out as test sites → {TEST_SITES}")

    per_state = defaultdict(int)
    for code, _ in chosen:
        per_state[code] += 1
    print(f"{len(chosen)} sites → {out}")
    print("per state:", ", ".join(f"{k} {v}" for k, v in sorted(per_state.items())))
    for reason, n in dropped.items():
        print(f"dropped {n:3}: {reason}")


if __name__ == "__main__":
    main()
