"""Autolabel tile files (`data/autolabel*/<tile>.json`): paths and the rules that turn
their boxes into labels. Kept free of torch/ultralytics so review.py and studio.py
start instantly; autolabel.py writes these files."""

from __future__ import annotations

import json
from pathlib import Path

from common import DATA

AUTOLABEL = DATA / "autolabel"
AUTOLABEL_EVAL = DATA / "autolabel-eval"
AUTOLABEL_AUDIT = DATA / "autolabel-audit"
FORMAT_VERSION = 1


def box_key(corners: list[list[float]]) -> tuple[int, int]:
    """Coarse center, to carry decisions over when a tile is labelled again."""
    xs, ys = zip(*corners)
    return round(sum(xs) / 4 / 4), round(sum(ys) / 4 / 4)


def read_tile(path: Path) -> dict:
    return json.loads(path.read_text())


def accepted_boxes(tile: dict) -> list[dict]:
    """Boxes that end up as labels: answered yes, or sure and not rejected."""
    out = []
    for b in tile["boxes"]:
        decision = b.get("decision")
        if decision == "no":
            continue
        if decision in ("car", "large_vehicle") or (decision is None and b["bucket"] == "sure"):
            cls = b["cls"] if decision is None else {"car": 0, "large_vehicle": 1}[decision]
            out.append({**b, "cls": cls})
    return out


def open_questions(tile: dict) -> list[dict]:
    return [b for b in tile["boxes"] if b["bucket"] in ("check", "candidate") and b.get("decision") is None and b.get("origin") != "manual"]


def val_sites() -> set[str]:
    path = DATA / "dataset" / "val_sites.txt"
    return set(path.read_text().split()) if path.exists() else set()
