"""Let Claude (in Claude Code) answer the yes/no questions before you do.

Claude cannot draw boxes reliably, but it can judge a numbered crop: vehicle,
large vehicle, or not a vehicle (solar panel, container, shadow, roof edge).
This script turns open questions into contact sheets, reads Claude's answers
back, and measures how often Claude agrees with your labels.

    python claude_review.py sheets                 # open questions of unfinished sites
    python claude_review.py sheets --eval          # questions on validation sites (to measure Claude)
    python claude_review.py sheets --eval --select unmatched-sure   # sure boxes without a label of yours
    # in Claude Code: "Prüf die Sheets in training/data/claude" — Claude writes the answer files
    python claude_review.py apply                  # answers → data/autolabel/*.json ("claude" field)
    python claude_review.py score --eval           # Claude vs your labels

Sheets: data/claude/sheets/<batch>_NNN.png, 20 crops each (11.2 m around the
box, the box drawn in magenta), index in <batch>.json. Answers:
data/claude/answers/<batch>_NNN.txt, one line per crop: `<n> car|large|no|unsure`.

The images leave this machine when Claude reads them (open state orthophotos
of OSM dealership sites). Answers are hints in review.py; with `apply --auto`
they also decide the questions where Claude was reliable on your validation
sites (see training/README.md, "Claude as second reviewer").
"""

from __future__ import annotations

import argparse
import json
import random
import re
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from autolabel import AUTOLABEL, AUTOLABEL_EVAL, BUCKETS, match, read_tile
from common import DATA, RAW, corrected_labels

CLAUDE = DATA / "claude"
SHEETS = CLAUDE / "sheets"
ANSWERS = CLAUDE / "answers"
PER_SHEET = 20
COLS = 5
CROP_PX = 112  # 11.2 m at 0.10 m/px: a car plus its neighbours
CELL_PX = 224
ANSWER_WORDS = {"car": "car", "large": "large_vehicle", "no": "no", "unsure": "unsure"}
LINE = re.compile(r"^\s*(\d+)\s*[:.)-]?\s*(car|large|no|unsure)\b", re.IGNORECASE)


def crop_cell(tile: Image.Image, corners: list[list[float]], number: int) -> Image.Image:
    c = np.array(corners)
    cx, cy = c.mean(axis=0)
    half = CROP_PX / 2
    box = (round(cx - half), round(cy - half), round(cx + half), round(cy + half))
    crop = Image.new("RGB", (CROP_PX, CROP_PX), (90, 90, 90))
    crop.paste(tile.crop(box), (0, 0))  # PIL pads out-of-tile areas with black; grey frame shows the tile edge
    scale = CELL_PX / CROP_PX
    cell = crop.resize((CELL_PX, CELL_PX), Image.LANCZOS)
    draw = ImageDraw.Draw(cell)
    pts = [((x - box[0]) * scale, (y - box[1]) * scale) for x, y in corners]
    draw.polygon(pts, outline=(255, 0, 255), width=2)
    font = ImageFont.load_default(size=22)
    draw.rectangle((0, 0, 40, 28), fill=(0, 0, 0))
    draw.text((5, 2), str(number), fill=(255, 255, 0), font=font)
    return cell


def selected_boxes(src: Path, select: str, buckets: tuple[str, ...] = ("check", "candidate")):
    for path in sorted(src.glob("*.json")):
        tile = read_tile(path)
        boxes = [b for b in tile["boxes"] if b.get("origin") == "model"]
        if select == "questions":
            chosen = [b for b in boxes if b["bucket"] in buckets and b.get("decision") is None and not b.get("claude")]
        else:  # unmatched-sure, validation only
            gt = corrected_labels(RAW / tile["image"])
            hits = match([b["corners"] for b in boxes], [c for _, c in gt])
            chosen = [b for b, j in zip(boxes, hits) if j < 0 and BUCKETS.of(b["score"], b["votes"]) == "sure"]
        for b in chosen:
            yield path.stem, b


def cmd_sheets(args) -> None:
    src = AUTOLABEL_EVAL if args.eval else AUTOLABEL
    batch = args.batch or (f"eval-{args.select}" if args.eval else "questions")
    items = list(selected_boxes(src, args.select, tuple(args.buckets)))
    if args.sample and len(items) > args.sample:
        items = sorted(random.Random(args.seed).sample(items, args.sample), key=lambda t: (t[0], t[1]["id"]))
    if not items:
        raise SystemExit("nothing to review")
    SHEETS.mkdir(parents=True, exist_ok=True)
    for old in SHEETS.glob(f"{batch}_*.png"):
        old.unlink()
    index = {"source": str(src), "sheets": {}}
    tiles: dict[str, Image.Image] = {}
    for s in range(0, len(items), PER_SHEET):
        chunk = items[s : s + PER_SHEET]
        rows = -(-len(chunk) // COLS)
        sheet = Image.new("RGB", (COLS * CELL_PX + (COLS - 1) * 4, rows * CELL_PX + (rows - 1) * 4), (255, 255, 255))
        name = f"{batch}_{s // PER_SHEET + 1:03}"
        entries = []
        for n, (stem, b) in enumerate(chunk, 1):
            if stem not in tiles:
                tiles = {stem: Image.open(RAW / f"{stem}.jpg").convert("RGB")}
            cell = crop_cell(tiles[stem], b["corners"], n)
            sheet.paste(cell, (((n - 1) % COLS) * (CELL_PX + 4), ((n - 1) // COLS) * (CELL_PX + 4)))
            entries.append({"n": n, "tile": stem, "box": b["id"]})
        sheet.save(SHEETS / f"{name}.png")
        index["sheets"][name] = entries
    (SHEETS / f"{batch}.json").write_text(json.dumps(index, indent=1))
    print(f"{len(items)} crops on {len(index['sheets'])} sheets → {SHEETS}/{batch}_*.png")
    print(f"answers go to {ANSWERS}/<sheet>.txt, one line per crop: '<n> car|large|no|unsure'")


def read_answers(batch: str) -> tuple[Path, dict[tuple[str, int], str]]:
    index = json.loads((SHEETS / f"{batch}.json").read_text())
    out = {}
    for name, entries in index["sheets"].items():
        path = ANSWERS / f"{name}.txt"
        if not path.exists():
            continue
        by_n = {}
        for line in path.read_text().splitlines():
            m = LINE.match(line)
            if m:
                by_n[int(m.group(1))] = ANSWER_WORDS[m.group(2).lower()]
        for e in entries:
            if e["n"] in by_n:
                out[(e["tile"], e["box"])] = by_n[e["n"]]
    return Path(index["source"]), out


def cmd_apply(args) -> None:
    batch = args.batch or ("eval-questions" if args.eval else "questions")
    src, answers = read_answers(batch)
    if not answers:
        raise SystemExit(f"no answers for batch '{batch}' in {ANSWERS}")
    changed = decided = 0
    for stem in sorted({t for t, _ in answers}):
        path = src / f"{stem}.json"
        tile = read_tile(path)
        for b in tile["boxes"]:
            answer = answers.get((stem, b["id"]))
            if answer is None:
                continue
            b["claude"] = answer
            changed += 1
            if args.auto and b.get("decision") is None and auto_decision(b) is not None:
                b["decision"] = auto_decision(b)
                b["decidedBy"] = "claude"
                decided += 1
        path.write_text(json.dumps(tile, indent=1))
    print(f"{changed} answers stored" + (f", {decided} questions decided by Claude" if args.auto else ""))


def auto_decision(box: dict) -> str | None:
    """Which Claude answers may decide a question without you.

    Measured on 200 random questions of the 11 validation sites (2026-11-13,
    training/README.md): Claude's "no" on a weak candidate matched your labels
    59 of 61 times. Its "no" on a check box (16 of 21) and its "vehicle"
    answers (17 of 46; partly vehicles missing from the labels) are not
    reliable enough to skip you, so they stay hints in review.py.
    """
    if box.get("claude") == "no" and box["bucket"] == "candidate":
        return "no"
    return None


def cmd_score(args) -> None:
    batch = args.batch or "eval-questions"
    src, answers = read_answers(batch)
    if not answers:
        raise SystemExit(f"no answers for batch '{batch}'")
    table: dict[tuple[str, str, bool], int] = {}
    for stem in sorted({t for t, _ in answers}):
        tile = read_tile(src / f"{stem}.json")
        gt = corrected_labels(RAW / tile["image"])
        boxes = [b for b in tile["boxes"] if b.get("origin") == "model"]
        hits = dict(zip((b["id"] for b in boxes), match([b["corners"] for b in boxes], [c for _, c in gt])))
        for b in boxes:
            answer = answers.get((stem, b["id"]))
            if answer is None:
                continue
            key = (b["bucket"], answer, hits[b["id"]] >= 0)
            table[key] = table.get(key, 0) + 1
    print(f"{'bucket':10} {'Claude':14} {'your label: vehicle':>20} {'no vehicle':>11}")
    for bucket in ("sure", "check", "candidate"):
        for answer in ("car", "large_vehicle", "no", "unsure"):
            yes, no = table.get((bucket, answer, True), 0), table.get((bucket, answer, False), 0)
            if yes or no:
                print(f"{bucket:10} {answer:14} {yes:20} {no:11}")
    vehicle = sum(v for (_, a, hit), v in table.items() if a in ("car", "large_vehicle") and hit)
    vehicle_all = sum(v for (_, a, _), v in table.items() if a in ("car", "large_vehicle"))
    no_right = sum(v for (_, a, hit), v in table.items() if a == "no" and not hit)
    no_all = sum(v for (_, a, _), v in table.items() if a == "no")
    print(f"\nClaude says vehicle: right {vehicle}/{vehicle_all}   says no: right {no_right}/{no_all}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("sheets", "apply", "score"):
        p = sub.add_parser(name)
        p.add_argument("--eval", action="store_true", help="validation sites (data/autolabel-eval)")
        p.add_argument("--batch", help="batch name (default from the other options)")
        if name == "sheets":
            p.add_argument("--select", choices=["questions", "unmatched-sure"], default="questions")
            p.add_argument("--sample", type=int, help="random sample of this many crops")
            p.add_argument("--buckets", nargs="+", choices=["check", "candidate"], default=["check", "candidate"])
            p.add_argument("--seed", type=int, default=7)
        if name == "apply":
            p.add_argument("--auto", action="store_true", help="let reliable answers decide (auto_decision)")
    args = ap.parse_args()
    {"sheets": cmd_sheets, "apply": cmd_apply, "score": cmd_score}[args.cmd](args)


if __name__ == "__main__":
    main()
