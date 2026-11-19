"""Checks of the count and match metrics in evaluate.py and of select_sites.py --extend.

    cd training && .venv/bin/python -m unittest discover -s tests
"""

from __future__ import annotations

import csv
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_studio  # noqa: E402,F401  (sets the one sandbox env before any training module loads)
import evaluate  # noqa: E402
import select_sites  # noqa: E402
from common import DATA  # noqa: E402


class CountMetrics(unittest.TestCase):
    expected = {"a": 100, "b": 50, "c": 0}

    def test_mae_bias_and_within(self):
        mae, bias, within = evaluate.count_metrics(self.expected, {"a": 95, "b": 60, "c": 0}, ["a", "b", "c"])
        self.assertAlmostEqual(mae, 5.0)
        self.assertAlmostEqual(bias, 5 / 150)
        self.assertAlmostEqual(within, 2 / 3)  # b is 20 % off; an empty site counts only when nothing is found

    def test_bootstrap_brackets_the_value_and_is_reproducible(self):
        pred = {"a": 90, "b": 52, "c": 1}
        ci = evaluate.bootstrap(self.expected, pred, ["a", "b", "c"], rounds=500)
        mae = evaluate.count_metrics(self.expected, pred, ["a", "b", "c"])[0]
        self.assertLessEqual(ci["mae"][0], mae)
        self.assertGreaterEqual(ci["mae"][1], mae)
        self.assertEqual(ci, evaluate.bootstrap(self.expected, pred, ["a", "b", "c"], rounds=500))


class Matching(unittest.TestCase):
    def test_each_label_is_matched_once_best_score_first(self):
        # Two predictions on label 0, one on label 1 below the IoU floor.
        iou = [[0.9, 0.0], [0.8, 0.1], [0.0, 0.4]]
        self.assertEqual(evaluate.greedy_matches(iou, [0.9, 0.95, 0.9], threshold=0.25), 1)

    def test_threshold_drops_low_scores(self):
        iou = [[0.9, 0.0], [0.0, 0.9]]
        self.assertEqual(evaluate.greedy_matches(iou, [0.9, 0.2], threshold=0.25), 1)
        self.assertEqual(evaluate.greedy_matches(iou, [0.9, 0.2], threshold=0.15), 2)

    def test_precision_recall(self):
        q = evaluate.detection_quality({"a": 10}, {"a": 8}, {"a": 6}, ["a"])
        self.assertEqual((q["precision"], q["recall"]), (0.75, 0.6))


class VehicleClasses(unittest.TestCase):
    names = {0: "plane", 9: "large vehicle", 10: "small vehicle"}

    def test_own_models_count_everything(self):
        self.assertIsNone(evaluate.vehicle_ids(self.names, None, dota=False))

    def test_names_pick_ids_case_insensitively(self):
        self.assertEqual(evaluate.vehicle_ids(self.names, "Small Vehicle, large vehicle", dota=False), {9, 10})

    def test_unknown_name_stops(self):
        with self.assertRaises(SystemExit):
            evaluate.vehicle_ids(self.names, "car", dota=False)


DEALERS = [
    # id, name, state, lat, lon
    ("1", "Autohaus Nord", "Bayern", 48.103, 11.50),  # 330 m from the existing site
    ("2", "Autohaus Nah", "Bayern", 48.1001, 11.5001),  # 15 m from it
    ("3", "Autohaus Süd", "Bayern", 47.90, 11.30),
    ("4", "Autohaus Hessen", "Hessen", 50.10, 8.60),
]


class ExtendSites(unittest.TestCase):
    def setUp(self):
        DATA.mkdir(parents=True, exist_ok=True)
        self.sites = DATA / "sites.csv"
        self.sites.write_text("id,lat,lon,state,name,city\nosm900,48.10,11.50,BY,Bestand,München\n")
        self.dealers = DATA / "dealers-test.csv"
        with self.dealers.open("w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["ID", "Dealership Name", "Federal State", "Latitude", "Longitude", "OSM ID", "City", "Brand"])
            for i, name, state, lat, lon in DEALERS:
                w.writerow([i, name, state, lat, lon, f"10{i}", "Ort", ""])

    def tearDown(self):
        for p in [self.sites, self.dealers, *DATA.glob("sites-added-*.txt")]:
            p.unlink(missing_ok=True)

    def test_extend_keeps_existing_rows_and_skips_close_sites(self):
        with mock.patch.object(sys, "argv", ["select_sites.py", str(self.dealers), "--extend", "--count", "5"]):
            select_sites.main()
        with self.sites.open() as f:
            ids = [r["id"] for r in csv.DictReader(f)]
        self.assertEqual(ids[0], "osm900")  # unchanged and first
        self.assertCountEqual(ids[1:], ["osm103", "osm104"])  # 1 and 2 lie within 400 m of osm900
        added = next(DATA.glob("sites-added-*.txt")).read_text().split()
        self.assertCountEqual(added, ["BY-osm103", "HE-osm104"])


class PickTest(unittest.TestCase):
    sites = [f"{st}-osm{i}" for st, n in (("BY", 6), ("HE", 3), ("MV", 1)) for i in range(n)]

    def test_share_per_state_with_at_least_one(self):
        picked = select_sites.pick_test(self.sites, 0.5, 7)
        per_state = {st: sum(p.startswith(st) for p in picked) for st in ("BY", "HE", "MV")}
        self.assertEqual(per_state, {"BY": 3, "HE": 2, "MV": 1})

    def test_reproducible(self):
        self.assertEqual(select_sites.pick_test(self.sites, 0.5, 7), select_sites.pick_test(list(reversed(self.sites)), 0.5, 7))


if __name__ == "__main__":
    unittest.main()
