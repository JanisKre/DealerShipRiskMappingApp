"""Compare our vehicle models with public ones on the same validation sites.

    caffeinate -i python compare_models.py                      # every model in MODELS
    python compare_models.py --only round-02,dota-yolo11m        # a few
    python compare_models.py --sites data/sites-added-2026-11-19.txt   # report only on these

Each model runs per input size through evaluate.py on val and on the test
split (count metrics at several thresholds, precision/recall at probIoU 0.5,
per-site counts); the results land in data/studio/evals/compare-<date>/.
Each model's input size and threshold are picked by MAE on val and scored on
test, so no model, ours included, is tuned on the sites it is scored on.
Without a test split (or with --no-test) it reports on val, which is an
optimistic upper bound for every model.

Public weights are official Ultralytics releases (downloaded on first use
into training/, about 20–140 MB each). Third-party checkpoints are pickles
that run code when loaded; add them to MODELS only after checking the source.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

from common import DATA, ROOT, RUNS
from evaluate import bootstrap, count_metrics, detection_quality

DOTA = "small vehicle,large vehicle"
# Low thresholds too: public models under-count on these lots and do best near the bottom.
THRESHOLDS = "0.02,0.05,0.1,0.15,0.2,0.25,0.3,0.35,0.45,0.55,0.65"


@dataclass
class Model:
    name: str
    weights: str
    group: str  # "ours" or "public"
    source: str
    licence: str
    classes: str | None = None
    prompt: str | None = None
    sizes: list[int] = field(default_factory=lambda: [640])
    extra: list[str] = field(default_factory=list)  # more evaluate.py arguments


MODELS = [
    Model("round-02", str(RUNS / "round-02/weights/best.pt"), "ours", "fine-tuned, shipped in v0.6.0 (DLR 3K lineage)", "AGPL-3.0 + DLR 3K research terms"),
    Model("round-01", str(RUNS / "round-01/weights/best.pt"), "ours", "fine-tuned (DLR 3K lineage)", "AGPL-3.0 + DLR 3K research terms"),
    Model("scratch-01", str(RUNS / "scratch-01/weights/best.pt"), "ours", "own labels only, from yolo11s-obb", "AGPL-3.0"),
    Model("dealer-obb", str(RUNS / "dealer-obb/weights/best.pt"), "ours", "first model, DLR 3K + own labels", "AGPL-3.0 + DLR 3K research terms"),
    *[
        Model(f"dota-{v}", f"{v}-obb.pt", "public", "Ultralytics, DOTA v1 (aerial, 15 classes)", "AGPL-3.0", classes=DOTA, sizes=[448, 640, 1024])
        for v in ("yolo11s", "yolo11m", "yolo11x", "yolo26s", "yolo26m", "yolo26x")
    ],
    Model(
        "visdrone-yolo26s",
        str(Path.home() / "Library/Application Support/Electron/models/yolov26s_aerial_vehicles.onnx"),
        "public",
        "the app's default download before dealer models: YOLO26s on VisDrone (drone video)",
        "AGPL-3.0 + VisDrone research terms",
        classes="car,van,truck,bus",
        extra=["--batch", "1", "--device", "cpu"],
    ),
    Model("yoloe-11l", "yoloe-11l-seg.pt", "public", "Ultralytics YOLOE, open vocabulary (zero-shot text prompt)", "AGPL-3.0", prompt="car,van,truck", sizes=[640, 1024]),
]


def run(model: Model, imgsz: int, split: str, out: Path) -> Path:
    target = out / f"{model.name}@{imgsz}-{split}.json"
    if target.exists():
        return target
    cmd = [sys.executable, str(ROOT / "evaluate.py"), "--weights", model.weights, "--imgsz", str(imgsz), "--split", split, "--sweep", "--thresholds", THRESHOLDS, "--no-map", "--json", str(target)]
    if model.classes:
        cmd += ["--classes", model.classes]
    if model.prompt:
        cmd += ["--prompt", model.prompt]
    cmd += model.extra
    print(f"→ {model.name} @ {imgsz} on {split}", flush=True)
    subprocess.run(cmd, check=True, cwd=ROOT, stdout=subprocess.DEVNULL)
    return target


def scored(rep: dict, conf: float, sites: list[str] | None = None) -> dict:
    """Metrics of one evaluate.py report at one threshold, optionally on a subset of its sites."""
    per = rep["perSite"]
    sites = sorted(per) if sites is None else [s for s in sites if s in per]
    t = str(conf)
    expected = {s: v["expected"] for s, v in per.items()}
    pred = {s: v["predicted"][t] for s, v in per.items()}
    mae, bias, within = count_metrics(expected, pred, sites)
    return {
        "sites": len(sites),
        "vehicles": sum(expected[s] for s in sites),
        "mae": round(mae, 2),
        "bias": round(bias, 4),
        "within10": round(within, 4),
        "ci95": bootstrap(expected, pred, sites),
        **detection_quality(expected, pred, {s: v["matched"][t] for s, v in per.items()}, sites),
    }


def summarise(tune: dict[str, dict[int, dict]], report: dict[str, dict[int, dict]], sites: list[str] | None) -> list[dict]:
    """Per model: input size and threshold with the lowest MAE on the tuning reports,
    scored on the matching report (the same report when there is no test split)."""
    rows = []
    for name, by_size in tune.items():
        best = min(
            ((imgsz, row["conf"], row["mae"]) for imgsz, rep in by_size.items() for row in rep["thresholds"]),
            key=lambda c: c[2],
        )
        imgsz, conf, tune_mae = best
        rows.append({"model": name, "imgsz": imgsz, "conf": conf, "tuneMae": tune_mae, **scored(report[name][imgsz], conf, sites)})
    return sorted(rows, key=lambda r: r["mae"])


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", help="comma-separated model names")
    ap.add_argument("--out", help="result folder (default data/studio/evals/compare-<date>)")
    ap.add_argument("--sites", help="report only on these sites (one id per line), e.g. data/sites-added-<date>.txt")
    ap.add_argument("--no-test", action="store_true", help="ignore the test split: tune and report on val (optimistic)")
    args = ap.parse_args()

    out = Path(args.out) if args.out else DATA / "studio" / "evals" / f"compare-{dt.date.today().isoformat()}"
    out.mkdir(parents=True, exist_ok=True)
    has_test = not args.no_test and any((DATA / "dataset" / "images" / "test").glob("*.jpg"))
    picked = set(args.only.split(",")) if args.only else None
    models = [m for m in MODELS if picked is None or m.name in picked]
    tune: dict[str, dict[int, dict]] = {}
    report: dict[str, dict[int, dict]] = {}
    for m in models:
        if (m.group == "ours" or m.weights.startswith("/")) and not Path(m.weights).exists():
            print(f"skip {m.name}: {m.weights} missing")
            continue
        tune[m.name] = {size: json.loads(run(m, size, "val", out).read_text()) for size in m.sizes}
        report[m.name] = {size: json.loads(run(m, size, "test", out).read_text()) for size in m.sizes} if has_test else tune[m.name]

    sites = Path(args.sites).read_text().split() if args.sites else None
    table = summarise(tune, report, sites)
    meta = {m.name: m for m in models}
    for r in table:
        r.update(group=meta[r["model"]].group, source=meta[r["model"]].source, licence=meta[r["model"]].licence)
    split = "test" if has_test else "val (tuned on the same sites: optimistic)"
    (out / "summary.json").write_text(json.dumps({"date": dt.date.today().isoformat(), "reportedOn": split, "siteFilter": args.sites, "rows": table}, indent=1) + "\n")
    print(f"\nthreshold and input size picked on val, scored on {split}")
    print(f"{'model':14} {'group':7} {'size':>5} {'conf':>5} {'MAE':>6} {'95 %':>12} {'bias':>7} {'≤10 %':>6} {'prec':>6} {'recall':>6}")
    for r in table:
        lo, hi = r["ci95"]["mae"]
        print(
            f"{r['model']:14} {r['group']:7} {r['imgsz']:5} {r['conf']:5.2f} {r['mae']:6.1f} {f'{lo:.1f}–{hi:.1f}':>12} "
            f"{r['bias']:+7.1%} {r['within10']:6.0%} {r['precision']:6.1%} {r['recall']:6.1%}"
        )
    print(f"\n{table[0]['sites']} sites, {table[0]['vehicles']} vehicles → {out / 'summary.json'}")


if __name__ == "__main__":
    main()
