"""Checks of the train/val split in make_dataset.py (no torch, no real data).

    cd training && .venv/bin/python -m unittest discover -s tests

Imports test_studio first, which points TRAINING_DATA_DIR at a throw-away
sandbox, so nothing under training/data is read or written.
"""

from __future__ import annotations

import sys
import unittest
from collections import Counter
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_studio  # noqa: E402,F401  (sets the one sandbox env before any training module loads)
import make_dataset  # noqa: E402

# 4 sites in each of five states; NW is the sharp 0.10 m imagery.
SITES = [f"{st}-osm{i}" for st in ("BB", "BY", "HE", "NW", "SN") for i in range(4)]
GSD = {"NW": 0.1}


def gsd(site: str) -> float:
    return GSD.get(site.split("-", 1)[0], 0.2)


class GrowValidation(unittest.TestCase):
    def split(self, prev_val: set[str], grow: bool, share: float = 0.4) -> set[str]:
        prev_train = set(SITES) - prev_val
        with mock.patch.object(make_dataset, "previous_split", return_value=(prev_val, prev_train)), mock.patch.object(make_dataset, "native_gsd", gsd):
            return make_dataset.split_sites(SITES, share, 7, resplit=False, grow=grow)

    def test_without_grow_the_split_stays_as_it_was(self):
        # Every site already has a side: nothing new goes to validation.
        self.assertEqual(self.split({"BB-osm0", "HE-osm0"}, grow=False), {"BB-osm0", "HE-osm0"})

    def test_grow_keeps_old_val_sites_and_reaches_the_target(self):
        val = self.split({"BB-osm0", "HE-osm0"}, grow=True)
        self.assertLessEqual({"BB-osm0", "HE-osm0"}, val)
        self.assertEqual(len(val), make_dataset.MIN_VAL_SITES if make_dataset.MIN_VAL_SITES <= len(SITES) // 2 else len(SITES) // 2)

    def test_grow_covers_every_state_and_resolution_first(self):
        with mock.patch.object(make_dataset, "MIN_VAL_SITES", 5):
            val = self.split({"BB-osm0", "BB-osm1"}, grow=True, share=0.3)  # 6 sites: 2 kept + one per missing state
        states = Counter(s.split("-", 1)[0] for s in val)
        self.assertEqual(set(states), {"BB", "BY", "HE", "NW", "SN"})
        self.assertTrue(any(gsd(s) == 0.1 for s in val))

    def test_grow_is_deterministic(self):
        self.assertEqual(self.split({"BB-osm0"}, grow=True), self.split({"BB-osm0"}, grow=True))


if __name__ == "__main__":
    unittest.main()
