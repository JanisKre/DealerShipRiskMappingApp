"""Training studio: the whole detector pipeline in one browser page.

    cd ../desktop-app && npm run build:studio    # once, and after UI changes
    python studio.py                             # opens http://127.0.0.1:8770

The page (React + the app's shadcn/ui components, built from
desktop-app/src/studio into studio-dist/) shows where every step stands,
lets you label tiles with a drawing toolbar, and runs "rounds": label a
batch, press "Runde abschließen", and the studio builds the dataset,
fine-tunes from the previous round, measures the model and refreshes the
suggestions for the tiles still open, while you keep labelling.

Long steps run as a detached job, so training keeps going when you close the
page or stop the studio; the page picks the job up again on the next start.

Local only: the server binds to 127.0.0.1, refuses other Host and Origin
headers (DNS rebinding, cross-site requests) and needs a per-start token for
every write. Commands are built from a fixed list; the browser sends a step
name and options that are validated here, never a path or a command line.
Nothing leaves the machine.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import json
import os
import re
import secrets
import shutil
import signal
import subprocess
import sys
import time
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from common import APP_MODELS_DIR, DATA, ROOT
from review import Store, validate_boxes

DIST = ROOT / "studio-dist"
RUNS = ROOT / "runs"
EXPORT = ROOT / "export"
STUDIO = DATA / "studio"
JOBS = STUDIO / "jobs"
EVALS = STUDIO / "evals"
JOB_FILE = STUDIO / "job.json"
EXPORTS_FILE = STUDIO / "exports.json"
ROUNDS_FILE = STUDIO / "rounds.json"
DESKTOP_APP = ROOT.parent / "desktop-app"
RELEASE_PIN = ROOT.parent / "desktop-app" / "src" / "shared" / "model-release.json"
AUTOLABEL = DATA / "autolabel"
AUTOLABEL_AUDIT = DATA / "autolabel-audit"
RAW = DATA / "raw"
MODEL_NAME = "dealer_vehicles"
MAX_BODY = 2_000_000
ASSET = re.compile(r"^/assets/[A-Za-z0-9._-]+\.(js|css|svg|woff2?)$")
CONTENT_TYPES = {"js": "text/javascript", "css": "text/css", "svg": "image/svg+xml", "woff": "font/woff", "woff2": "font/woff2"}
RUN_NAME = re.compile(r"^[a-z0-9][a-z0-9-]{0,40}$")


def contained(base: Path, *parts: str) -> Path:
    """Joins request-derived parts onto base and refuses a result outside it.

    Second line of defence behind the name patterns (RUN_NAME, ASSET): even a
    part that got past them cannot address a file outside its directory.
    """
    root = os.path.normpath(base)
    full = os.path.normpath(os.path.join(root, *parts))
    if not full.startswith(root + os.sep):
        raise ValueError("path outside its directory")
    return Path(full)
TAG = re.compile(r"^model-[a-z0-9._-]{1,60}$")
ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


# --- small helpers -------------------------------------------------------------------


def now() -> str:
    return dt.datetime.now().isoformat(timespec="seconds")


def read_json(path: Path, default=None):
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, ValueError):
        return default


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=1))
    tmp.replace(path)


_sha_cache: dict[tuple[str, int, int], str] = {}


def sha256(path: Path) -> str | None:
    """SHA-256 of a file, cached by path, size and mtime (models are 40 MB)."""
    try:
        st = path.stat()
    except FileNotFoundError:
        return None
    key = (str(path), st.st_size, st.st_mtime_ns)
    if key not in _sha_cache:
        h = hashlib.sha256()
        with path.open("rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        _sha_cache[key] = h.hexdigest()
    return _sha_cache[key]


def pid_alive(pid: int | None) -> bool:
    if not pid:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def simple_yaml(path: Path) -> dict[str, str]:
    """Top-level `key: value` pairs of an Ultralytics args.yaml (no PyYAML needed)."""
    out: dict[str, str] = {}
    try:
        for line in path.read_text().splitlines():
            if ":" in line and not line.startswith((" ", "#")):
                k, v = line.split(":", 1)
                out[k.strip()] = v.strip().strip("'\"")
    except FileNotFoundError:
        pass
    return out


# --- status ---------------------------------------------------------------------------


def site_of(stem: str) -> str:
    return stem.split("__", 1)[0]


def is_negative(site: str) -> bool:
    return "neg" in site


def open_questions(tile: dict) -> int:
    """Same rule as autolabel.open_questions (kept here so the studio starts without torch)."""
    return sum(
        1
        for b in tile.get("boxes", [])
        if b.get("bucket") in ("check", "candidate") and b.get("decision") is None and b.get("origin") != "manual"
    )


def sites_status() -> dict:
    sites = []
    try:
        with (DATA / "sites.csv").open() as f:
            sites = [row for row in csv.DictReader(f)]
    except FileNotFoundError:
        pass
    tiles: dict[str, list[bool]] = {}
    for image in RAW.glob("*.jpg"):
        data = read_json(image.with_suffix(".json"), {}) or {}
        tiles.setdefault(site_of(image.stem), []).append(data.get("checked") is True)
    per_state: dict[str, dict[str, int]] = {}
    finished = 0
    for row in sites:
        state = row.get("state", "?")
        site = f"{state}-{row.get('id', '')}"  # fetch_tiles.py names tiles <state>-<id>__<row>_<col>
        flags = tiles.get(site, [])
        done = bool(flags) and all(flags)
        finished += done
        s = per_state.setdefault(state, {"sites": 0, "finished": 0})
        s["sites"] += 1
        s["finished"] += done
    checked = sum(sum(v) for v in tiles.values())
    return {
        "sites": len(sites),
        "finished": finished,
        "tiles": sum(len(v) for v in tiles.values()),
        "checkedTiles": checked,
        "perState": dict(sorted(per_state.items())),
        "negatives": sum(1 for s in tiles if is_negative(s)),
    }


def review_status(folder: Path) -> dict:
    tiles = sorted(folder.glob("*.json"))
    per_site: dict[str, dict[str, int]] = {}
    total_q = done = 0
    for path in tiles:
        tile = read_json(path, {}) or {}
        q = open_questions(tile) if not tile.get("done") else 0
        site = site_of(path.stem)
        s = per_site.setdefault(site, {"tiles": 0, "done": 0, "questions": 0})
        s["tiles"] += 1
        s["done"] += bool(tile.get("done"))
        s["questions"] += q
        total_q += q
        done += bool(tile.get("done"))
    weights = None
    if tiles:
        weights = (read_json(tiles[0], {}) or {}).get("weights")
    return {
        "tiles": len(tiles),
        "doneTiles": done,
        "questions": total_q,
        "sites": len(per_site),
        "openSites": sum(1 for s in per_site.values() if s["done"] < s["tiles"]),
        "weights": Path(weights).parent.parent.name if weights else None,
    }


def finished_sites() -> set[str]:
    tiles: dict[str, list[bool]] = {}
    for image in RAW.glob("*.jpg"):
        tiles.setdefault(site_of(image.stem), []).append((read_json(image.with_suffix(".json"), {}) or {}).get("checked") is True)
    return {site for site, flags in tiles.items() if flags and all(flags)}


def dataset_status() -> dict:
    ds = DATA / "dataset" / "images"
    train = [p.stem for p in (ds / "train").glob("*.jpg")]
    val = [p.stem for p in (ds / "val").glob("*.jpg")]
    train_sites = {site_of(s) for s in train}
    built = None
    if (ds / "train").exists():
        built = dt.datetime.fromtimestamp((ds / "train").stat().st_mtime).isoformat(timespec="minutes")
    return {
        "trainTiles": len(train),
        "valTiles": len(val),
        "trainSites": len(train_sites),
        "valSites": len({site_of(s) for s in val}),
        "degraded": sum(1 for s in train if s.endswith("__lr")),
        "public": sum(1 for s in train if s.startswith("DLR-")),
        # Train sites you have not finished can only come from make_dataset.py --pseudo.
        "pseudoSites": len({s for s in train_sites if not s.startswith("DLR-")} - finished_sites()),
        "built": built,
    }


def runs_status(job: dict | None) -> list[dict]:
    out = []
    if not RUNS.exists():
        return out
    for run in sorted(RUNS.iterdir()):
        args = simple_yaml(run / "args.yaml")
        if not args or args.get("mode", "train") != "train" or not (run / "weights").exists():
            continue
        rows = []
        try:
            with (run / "results.csv").open() as f:
                for row in csv.DictReader(f):
                    row = {k.strip(): v.strip() for k, v in row.items() if k}
                    rows.append(
                        {
                            "epoch": int(float(row["epoch"])),
                            "map50": float(row.get("metrics/mAP50(B)", 0) or 0),
                            "map5095": float(row.get("metrics/mAP50-95(B)", 0) or 0),
                            "precision": float(row.get("metrics/precision(B)", 0) or 0),
                            "recall": float(row.get("metrics/recall(B)", 0) or 0),
                        }
                    )
        except (FileNotFoundError, KeyError, ValueError):
            pass
        epochs = int(args.get("epochs", "0") or 0)
        patience = int(args.get("patience", "100") or 100)
        best = max(rows, key=lambda r: r["map50"]) if rows else None
        last = rows[-1]["epoch"] if rows else 0
        running = bool(job and job.get("status") == "running" and job.get("run") == run.name)
        if running:
            state = "running"
        elif rows and (last >= epochs or (best and last - best["epoch"] >= patience)):
            state = "finished"
        elif rows:
            state = "interrupted"
        elif (run / "weights" / "best.pt").exists():
            state = "finished"  # older run without results.csv
        else:
            state = "empty"
        out.append(
            {
                "name": run.name,
                "model": Path(args.get("model", "?")).name,
                "epochs": epochs,
                "lastEpoch": last,
                "best": best,
                "state": state,
                "hasBest": (run / "weights" / "best.pt").exists(),
                "hasLast": (run / "weights" / "last.pt").exists(),
                "curve": [[r["epoch"], round(r["map50"], 4)] for r in rows],
                "modified": dt.datetime.fromtimestamp((run / "weights").stat().st_mtime).isoformat(timespec="minutes"),
            }
        )
    return out


def evals_status() -> list[dict]:
    out = []
    for path in sorted(EVALS.glob("*.json")):
        data = read_json(path)
        if isinstance(data, dict) and isinstance(data.get("thresholds"), list):
            data["file"] = path.name
            data.setdefault("pipeline", "ultralytics")
            if not data.get("run") and (m := re.search(r"runs/([^/]+)/weights", str(data.get("weights", "")))):
                data["run"] = m.group(1)
            out.append(data)
    return out


def model_files(folder: Path) -> dict | None:
    onnx = folder / f"{MODEL_NAME}.onnx"
    if not onnx.exists():
        return None
    manifest = read_json(folder / f"{MODEL_NAME}.json", {}) or {}
    return {
        "sha256": sha256(onnx),
        "manifestSha256": sha256(folder / f"{MODEL_NAME}.json"),
        "version": manifest.get("version"),
        "defaultConfidence": manifest.get("defaultConfidence"),
        "trainingData": manifest.get("trainingData", []),
        "manifestMatches": manifest.get("sha256") == sha256(onnx),
        "modified": dt.datetime.fromtimestamp(onnx.stat().st_mtime).isoformat(timespec="minutes"),
    }


def models_status() -> dict:
    pin = read_json(RELEASE_PIN)
    pin_files = {f["name"]: f["sha256"] for f in pin.get("files", [])} if isinstance(pin, dict) else {}
    installed = model_files(APP_MODELS_DIR)
    export = model_files(EXPORT)
    exports = read_json(EXPORTS_FILE, []) or []
    if export:
        export["weights"] = next((e["run"] for e in reversed(exports) if e.get("sha256") == export["sha256"]), None)
    backups = sorted(p.name for p in APP_MODELS_DIR.glob("backup-*") if p.is_dir()) if APP_MODELS_DIR.exists() else []
    return {
        "installed": installed,
        "export": export,
        "backups": backups,
        "release": {
            "tag": pin.get("tag") if isinstance(pin, dict) else None,
            "onnxSha256": pin_files.get(f"{MODEL_NAME}.onnx"),
            "manifestSha256": pin_files.get(f"{MODEL_NAME}.json"),
            "file": str(RELEASE_PIN.relative_to(ROOT.parent)),
            "repository": pin.get("repository") if isinstance(pin, dict) else None,
        },
    }


def status() -> dict:
    job = job_status()
    return {
        "generated": now(),
        "sites": sites_status(),
        "review": review_status(AUTOLABEL),
        "audit": review_status(AUTOLABEL_AUDIT),
        "dataset": dataset_status(),
        "runs": runs_status(job),
        "evals": evals_status(),
        "models": models_status(),
        "job": job,
        "rounds": rounds_status(),
        "weights": weight_choices(),
        "baseModels": base_models(),
        "claude": {
            "sheets": len(list((DATA / "claude" / "sheets").glob("*.png"))),
            "answers": len(list((DATA / "claude" / "answers").glob("*.txt"))),
        },
        "appDb": (APP_MODELS_DIR.parent / "dealership-risk.db").exists(),
    }


# --- option checks --------------------------------------------------------------------


def weight_choices() -> list[str]:
    return sorted(p.parent.parent.name for p in RUNS.glob("*/weights/best.pt")) if RUNS.exists() else []


def base_models() -> list[str]:
    return sorted(p.name for p in ROOT.glob("yolo*-obb.pt"))


def opt_run(opts: dict, key: str = "weights") -> str:
    value = opts.get(key)
    if value not in weight_choices():
        raise ValueError(f"unknown run {value!r}")
    return value


def opt_float(opts: dict, key: str, lo: float, hi: float, default: float | None = None) -> float | None:
    value = opts.get(key, default)
    if value is None or value == "":
        return None
    try:
        value = float(value)
    except (TypeError, ValueError) as err:
        raise ValueError(f"{key} must be a number") from err
    if not lo <= value <= hi:
        raise ValueError(f"{key} must be between {lo} and {hi}")
    return value


def opt_int(opts: dict, key: str, lo: int, hi: int, default: int) -> int:
    value = opts.get(key, default)
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise ValueError(f"{key} must be a whole number")
    try:
        value = int(value)
    except ValueError as err:
        raise ValueError(f"{key} must be a whole number") from err
    if not lo <= value <= hi:
        raise ValueError(f"{key} must be between {lo} and {hi}")
    return value


def opt_bool(opts: dict, key: str) -> bool:
    return opts.get(key) is True


def weights_path(run: str) -> str:
    return str(RUNS / run / "weights" / "best.pt")


def py(script: str, *args: str) -> list[str]:
    return [sys.executable, "-u", str(ROOT / script), *args]


def awake(argv: list[str]) -> list[str]:
    """Keep the Mac awake for long GPU steps (README: the Air throttles and sleeps)."""
    caffeinate = shutil.which("caffeinate")
    return [caffeinate, "-i", *argv] if caffeinate else argv


def build_job(step: str, opts: dict) -> dict:
    """Step name + options → the commands to run. The only place commands are built."""
    if not isinstance(opts, dict):
        raise ValueError("options must be an object")
    stages: list[dict] = []
    run = None
    title = step
    if step == "fetch":
        csv_name = "negatives.csv" if opt_bool(opts, "negatives") else "sites.csv"
        if not (DATA / csv_name).exists():
            raise ValueError(f"data/{csv_name} does not exist")
        stages = [stage("Kacheln laden", py("fetch_tiles.py", str(DATA / csv_name)))]
        title = f"Kacheln laden ({csv_name})"
    elif step == "autolabel":
        run = opt_run(opts)
        args = ["--weights", weights_path(run)]
        if opt_bool(opts, "audit"):
            args.append("--audit")
        stages = [stage("Vorschläge berechnen", awake(py("autolabel.py", *args)), lock=True)]
        title = f"Vorlabeln mit {run}" + (" (Audit)" if opt_bool(opts, "audit") else "")
    elif step == "claude-sheets":
        stages = [stage("Bögen erzeugen", py("claude_review.py", "sheets", "--buckets", "candidate"))]
        title = "Claude-Bögen erzeugen"
    elif step == "claude-apply":
        stages = [stage("Antworten übernehmen", py("claude_review.py", "apply", "--auto"), lock=True)]
        title = "Claude-Antworten übernehmen"
    elif step == "harvest":
        stages = [stage("App-Korrekturen lesen", py("harvest_app.py", "sites"))]
        title = "Korrekturen aus der App lesen"
    elif step == "dataset":
        args = []
        if opt_bool(opts, "pseudo"):
            args.append("--pseudo")
        degrade = opt_float(opts, "degrade", 0, 1, 0.5)
        args += ["--degrade", f"{degrade:g}"]
        stages = [stage("Datensatz bauen", py("make_dataset.py", *args))]
        title = "Datensatz bauen" + (" mit Pseudo-Labels" if opt_bool(opts, "pseudo") else "")
    elif step == "train":
        run = opts.get("name")
        if not isinstance(run, str) or not RUN_NAME.fullmatch(run):
            raise ValueError("run name: lowercase letters, digits and dashes")
        if opt_bool(opts, "resume"):
            if not contained(RUNS, run, "weights", "last.pt").exists():
                raise ValueError(f"{run} has no last.pt to resume")
            stages = [stage("Training", awake(py("train.py", "--name", run, "--resume")))]
            title = f"Training {run} fortsetzen"
        else:
            if contained(RUNS, run).exists():
                raise ValueError(f"runs/{run} exists — pick a new name or resume it")
            model = opts.get("model")
            if model not in base_models():
                raise ValueError(f"unknown start weights {model!r}")
            epochs = opt_int(opts, "epochs", 1, 300, 60)
            args = ["--name", run, "--model", str(ROOT / model), "--epochs", str(epochs)]
            fraction = opt_float(opts, "fraction", 0.01, 1, 1)
            if fraction is not None and fraction < 1:
                args += ["--fraction", f"{fraction:g}"]
            stages = [stage("Training", awake(py("train.py", *args)))]
            title = f"Training {run} ({model}, {epochs} Epochen)"
    elif step == "evaluate":
        run = opt_run(opts)
        out = EVALS / f"ultralytics-{run}-{dt.datetime.now():%Y-%m-%d-%H%M%S}.json"
        stages = [stage("Auswerten", awake(py("evaluate.py", "--weights", weights_path(run), "--sweep", "--json", str(out))))]
        title = f"Auswerten: {run}"
    elif step == "errors":
        run = opt_run(opts)
        conf = opt_float(opts, "conf", 0.05, 0.95, 0.45)
        stages = [stage("Fehleranalyse", awake(py("analyze_errors.py", "--weights", weights_path(run), "--conf", f"{conf:g}", "--sheets")))]
        title = f"Fehleranalyse: {run}"
    elif step == "export":
        run = opt_run(opts)
        args = ["--weights", weights_path(run)]
        conf = opt_float(opts, "defaultConf", 0.05, 0.95)
        if conf is not None:
            args += ["--default-conf", f"{conf:g}"]
        install = opt_bool(opts, "install")
        if install:
            args.append("--install")
        stages = [stage("Exportieren", py("export.py", *args)), stage("Export merken", py("studio.py", "--record-export", run))]
        title = f"Exportieren: {run}" + (" und in der App installieren" if install else "")
    elif step == "round":
        return build_round(opts)
    else:
        raise ValueError(f"unknown step {step!r}")
    return {"step": step, "title": title, "run": run, "stages": stages, "options": opts}


def stage(name: str, argv: list[str], *, env: dict | None = None, cwd: Path | None = None, lock: bool = False) -> dict:
    """One command of a job. `lock` blocks label saves meanwhile (the stage rewrites tile files)."""
    return {"name": name, "argv": argv, "env": env or {}, "cwd": str(cwd or ROOT), "lock": lock}


# --- rounds: label a batch, then retrain from the last round ---------------------------

ROUND = re.compile(r"^round-(\d{2,3})$")


def rounds() -> list[dict]:
    return read_json(ROUNDS_FILE, []) or []


def rounds_status() -> list[dict]:
    out = []
    evals = evals_status()
    for r in rounds():
        run = r["run"]
        app = next((e for e in reversed(evals) if e.get("run") == run and e.get("pipeline") == "app-inferWindow"), None)
        best = min(app["thresholds"], key=lambda t: t["mae"]) if app else None
        out.append({**r, "appBest": best})
    return out


def build_round(opts: dict) -> dict:
    """Dataset → fine-tune from the base run → measure (Ultralytics + app pipeline) →
    fresh suggestions for the open tiles. Human labels only unless `pseudo` is set:
    a model that saw its own pseudo-labels would be over-confident on exactly the
    tiles it suggests boxes for next."""
    numbers = [int(m.group(1)) for p in RUNS.glob("round-*") if (m := ROUND.match(p.name))] + [int(m.group(1)) for r in rounds() if (m := ROUND.match(r["run"]))]
    run = f"round-{max(numbers, default=0) + 1:02d}"
    base = opt_run(opts, "base")
    epochs = opt_int(opts, "epochs", 3, 120, 15)
    pseudo = opt_bool(opts, "pseudo")
    sites = sites_status()
    stamp = dt.datetime.now().strftime("%Y-%m-%d-%H%M%S")
    stages = [
        stage("Datensatz bauen", py("make_dataset.py", *(["--pseudo"] if pseudo else []))),
        stage("Feintuning", awake(py("train.py", "--name", run, "--model", weights_path(base), "--epochs", str(epochs)))),
        stage("Messen (Ultralytics)", awake(py("evaluate.py", "--weights", weights_path(run), "--sweep", "--json", str(EVALS / f"ultralytics-{run}-{stamp}.json")))),
        stage("Exportieren", py("export.py", "--weights", weights_path(run))),
        stage("Export merken", py("studio.py", "--record-export", run)),
    ]
    npm = shutil.which("npm")
    if npm and (DESKTOP_APP / "node_modules").exists():
        stages.append(
            stage(
                "Messen (App-Pipeline)",
                [npm, "run", "benchmark:detection"],
                env={
                    "DETECTION_SWEEP_MODEL": str(EXPORT / f"{MODEL_NAME}.onnx"),
                    "DETECTION_SWEEP_TILES": str(DATA / "dataset"),
                    "DETECTION_SWEEP_JSON": str(EVALS / f"app-{run}-{stamp}.json"),
                    "DETECTION_SWEEP_RUN": run,
                },
                cwd=DESKTOP_APP,
            )
        )
    stages.append(stage("Neue Vorschläge für offene Kacheln", awake(py("autolabel.py", "--weights", weights_path(run))), lock=True))
    entry = {
        "run": run,
        "base": base,
        "epochs": epochs,
        "pseudo": pseudo,
        "started": now(),
        "finishedSites": sites["finished"],
        "checkedTiles": sites["checkedTiles"],
    }
    all_rounds = rounds()
    all_rounds.append(entry)
    write_json(ROUNDS_FILE, all_rounds)
    return {"step": "round", "title": f"Runde {run.removeprefix('round-')}: {sites['finished']} Standorte, {epochs} Epochen ab {base}", "run": run, "stages": stages, "options": opts}


# --- jobs (one at a time, detached so they outlive the studio) ------------------------


def job_status() -> dict | None:
    job = read_json(JOB_FILE)
    if not isinstance(job, dict):
        return None
    starting = job.get("pid") is None and time.time() - dt.datetime.fromisoformat(job["started"]).timestamp() < 10
    if job.get("status") == "running" and not starting and not pid_alive(job.get("pid")):
        job["status"] = "lost"
        job["ended"] = job.get("ended") or now()
        write_json(JOB_FILE, job)
    job["log"] = log_tail(Path(job["logFile"])) if job.get("logFile") else []
    return job


def log_tail(path: Path, max_lines: int = 160) -> list[str]:
    """Last lines of a job log; progress bars (\\r) collapse to their latest state."""
    try:
        with path.open("rb") as f:
            f.seek(0, os.SEEK_END)
            size = f.tell()
            f.seek(max(0, size - 96_000))
            text = f.read().decode("utf-8", "replace")
    except FileNotFoundError:
        return []
    lines = []
    for line in text.split("\n"):
        segments = [seg for seg in ANSI.sub("", line).split("\r") if seg.strip()]
        if segments:
            lines.append(segments[-1][:400])
    return lines[-max_lines:]


def start_job(step: str, opts: dict) -> dict:
    current = job_status()
    if current and current.get("status") == "running":
        raise ValueError("another step is still running — stop it or wait")
    job = build_job(step, opts)
    JOBS.mkdir(parents=True, exist_ok=True)
    job_id = f"{dt.datetime.now():%Y%m%d-%H%M%S}-{step}"
    job.update({"id": job_id, "status": "running", "pid": None, "started": now(), "logFile": str(JOBS / f"{job_id}.log"), "stage": 0})
    write_json(JOB_FILE, job)
    proc = subprocess.Popen(
        [sys.executable, str(ROOT / "studio.py"), "--run-job"],
        cwd=ROOT,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,  # own process group: survives the studio, stoppable as a whole
    )
    set_job_fields(job["id"], pid=proc.pid)
    job["pid"] = proc.pid
    return job


def set_job_fields(job_id: str, **fields) -> None:
    """Read-modify-write of the job file; both the studio and the job driver call it."""
    current = read_json(JOB_FILE) or {}
    if current.get("id") == job_id:
        current.update(fields)
        write_json(JOB_FILE, current)


def stop_job() -> None:
    job = read_json(JOB_FILE)
    if not isinstance(job, dict) or job.get("status") != "running" or not pid_alive(job.get("pid")):
        raise ValueError("no running step")
    os.killpg(job["pid"], signal.SIGTERM)


def run_job() -> None:
    """Job driver (own process): runs the stages in order and records the outcome."""
    job = read_json(JOB_FILE)
    log = Path(job["logFile"])
    child: subprocess.Popen | None = None

    def finish(state: str, code: int | None) -> None:
        set_job_fields(job["id"], status=state, returncode=code, ended=now(), locked=False)

    def on_term(*_):
        if child and child.poll() is None:
            child.terminate()
        finish("stopped", None)
        sys.exit(0)

    signal.signal(signal.SIGTERM, on_term)
    set_job_fields(job["id"], pid=os.getpid())
    with log.open("a") as out:
        for i, st in enumerate(job["stages"]):
            set_job_fields(job["id"], stage=i, locked=bool(st.get("lock")))
            shown = " ".join("python" if a == sys.executable else a.replace(f"{ROOT}/", "") for a in st["argv"])
            out.write(f"\n▶ {st['name']}\n$ {shown}\n")
            out.flush()
            env = {**os.environ, "PYTHONUNBUFFERED": "1", "YOLO_AUTOINSTALL": "false", **st.get("env", {})}
            child = subprocess.Popen(st["argv"], cwd=st.get("cwd") or ROOT, stdout=out, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, env=env)
            code = child.wait()
            if code != 0:
                out.write(f"\n[exit {code}]\n")
                finish("failed", code)
                return
    finish("done", 0)


def labels_locked() -> bool:
    job = read_json(JOB_FILE)
    return bool(isinstance(job, dict) and job.get("status") == "running" and job.get("locked") and pid_alive(job.get("pid")))


def record_export(run: str) -> None:
    """Remembers which run an export came from (export.py's manifest does not say)."""
    onnx = EXPORT / f"{MODEL_NAME}.onnx"
    entries = read_json(EXPORTS_FILE, []) or []
    entries.append({"run": run, "sha256": sha256(onnx), "date": now()})
    write_json(EXPORTS_FILE, entries[-50:])
    print(f"export of {run}: {sha256(onnx)}")


# --- labelling (the studio's own editor; review.py's Store does the file work) ---------

STORES = {"label": Store(audit=False), "audit": Store(audit=True)}


def label_queue(mode: str) -> dict:
    store = STORES[mode]
    summary = store.summary()
    tiles = summary["tiles"]
    sites: dict[str, dict] = {}
    for t in tiles:
        site = sites.setdefault(t["site"], {"site": t["site"], "state": t["site"].split("-", 1)[0], "tiles": [], "done": 0, "questions": 0})
        site["tiles"].append({"stem": t["stem"], "done": t["done"], "questions": t["questions"]})
        site["done"] += t["done"]
        site["questions"] += t["questions"] if not t["done"] else 0
    return {"mode": mode, "sites": list(sites.values()), "skipped": summary["skipped"], "classes": summary["classes"], "locked": labels_locked()}


# --- release pin ----------------------------------------------------------------------


def pin_release(source: str) -> dict:
    """Points the app's release pin (desktop-app/src/shared/model-release.json) at the
    exported or installed model. Uploading the release stays a deliberate manual step."""
    folder = {"export": EXPORT, "installed": APP_MODELS_DIR}.get(source)
    if folder is None:
        raise ValueError("source must be export or installed")
    files = model_files(folder)
    if not files or not files["manifestMatches"]:
        raise ValueError(f"no complete model (onnx + matching manifest) in {source}")
    pin = read_json(RELEASE_PIN)
    if not isinstance(pin, dict):
        raise ValueError(f"{RELEASE_PIN} not found — run the studio from the repository")
    tag = f"model-{MODEL_NAME.replace('_', '-')}-{files['version']}"
    if not TAG.fullmatch(tag):
        raise ValueError(f"manifest version gives an invalid tag {tag!r}")
    pin["tag"] = tag
    pin["files"] = [
        {"name": f"{MODEL_NAME}.json", "sha256": files["manifestSha256"]},
        {"name": f"{MODEL_NAME}.onnx", "sha256": files["sha256"]},
    ]
    RELEASE_PIN.write_text(json.dumps(pin, indent=2) + "\n")
    return release_commands(folder, tag, pin.get("repository", ""))


def release_commands(folder: Path, tag: str, repository: str) -> dict:
    stage = EXPORT / f"release-{tag}"
    return {
        "tag": tag,
        "commands": [
            f'mkdir -p "{stage}" && cp "{folder / (MODEL_NAME + ".onnx")}" "{folder / (MODEL_NAME + ".json")}" "{stage}/"',
            f'gh release create {tag} "{stage}/{MODEL_NAME}.onnx" "{stage}/{MODEL_NAME}.json" '
            f'--repo {repository} --latest=false --title "Vehicle model {tag.removeprefix("model-")}" '
            '--notes "Fine-tuned vehicle detector for the app (ONNX + manifest). Pinned by SHA-256 in desktop-app/src/shared/model-release.json."',
            "git add desktop-app/src/shared/model-release.json && git commit -m \"feat(model): ship " + tag + "\"",
        ],
    }


# --- HTTP -----------------------------------------------------------------------------


def make_handler(port: int, token: str):
    allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):  # quiet
            pass

        def send(self, status: int, body: bytes, ctype: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header(
                "Content-Security-Policy",
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
                "img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
            )
            self.end_headers()
            self.wfile.write(body)

        def json(self, data, status: int = 200) -> None:
            self.send(status, json.dumps(data).encode(), "application/json")

        def guard(self) -> bool:
            # Local tool: refuse other hosts (DNS rebinding) and cross-site requests.
            if self.headers.get("Host") not in allowed_hosts:
                self.send(HTTPStatus.FORBIDDEN, b"forbidden", "text/plain")
                return False
            origin = self.headers.get("Origin")
            if origin and origin.split("//", 1)[-1] not in allowed_hosts:
                self.send(HTTPStatus.FORBIDDEN, b"forbidden", "text/plain")
                return False
            return True

        def mode(self) -> str:
            query = self.path.split("?", 1)[1] if "?" in self.path else ""
            return "audit" if "mode=audit" in query.split("&") else "label"

        def do_GET(self) -> None:  # noqa: N802
            if not self.guard():
                return
            path = self.path.split("?", 1)[0]
            if path == "/":
                index = DIST / "index.html"
                if not index.exists():
                    self.send(
                        200,
                        b"<!doctype html><meta charset=utf-8><title>Training Studio</title><body style='font:15px system-ui;padding:40px'>"
                        b"<h1>Training Studio</h1><p>Die Oberfl\xc3\xa4che ist noch nicht gebaut:</p>"
                        b"<pre>cd desktop-app &amp;&amp; npm run build:studio</pre><p>Danach diese Seite neu laden.</p>",
                        "text/html; charset=utf-8",
                    )
                    return
                self.send(200, index.read_text().replace("__STUDIO_TOKEN__", token).encode(), "text/html; charset=utf-8")
            elif ASSET.match(path) and (asset := contained(DIST, path.lstrip("/"))).is_file():
                self.send(200, asset.read_bytes(), CONTENT_TYPES[path.rsplit(".", 1)[1]])
            elif path == "/api/status":
                self.json(status())
            elif path == "/api/job":
                self.json({"job": job_status()})
            elif path == "/api/label/queue":
                self.json(label_queue(self.mode()))
            elif path.startswith("/api/label/tile/") and (stem := STORES[self.mode()].lookup(path.removeprefix("/api/label/tile/"))):
                self.json(STORES[self.mode()].tile(stem))
            elif path.startswith("/api/label/img/") and (stem := STORES["label"].lookup(path.removeprefix("/api/label/img/")) or STORES["audit"].lookup(path.removeprefix("/api/label/img/"))):
                self.send(200, (RAW / f"{stem}.jpg").read_bytes(), "image/jpeg")
            else:
                self.send(HTTPStatus.NOT_FOUND, b"not found", "text/plain")

        def do_POST(self) -> None:  # noqa: N802
            if not self.guard():
                return
            length = int(self.headers.get("Content-Length") or 0)
            if (
                self.headers.get("Content-Type") != "application/json"
                or not secrets.compare_digest(self.headers.get("X-Studio-Token", ""), token)
                or not 0 < length <= MAX_BODY
            ):
                self.send(HTTPStatus.FORBIDDEN, b"forbidden", "text/plain")
                return
            try:
                body = json.loads(self.rfile.read(length))
                if not isinstance(body, dict):
                    raise ValueError("body must be an object")
                path = self.path.split("?", 1)[0]
                if path == "/api/run":
                    self.json({"job": start_job(str(body.get("step")), body.get("options") or {})})
                elif path == "/api/stop":
                    stop_job()
                    self.json({"ok": True})
                elif path.startswith("/api/label/tile/"):
                    store = STORES[self.mode()]
                    stem = store.lookup(path.removeprefix("/api/label/tile/"))
                    if stem is None:
                        raise ValueError("unknown tile")
                    if labels_locked():
                        self.json({"error": "Vorschläge werden gerade neu berechnet – in ein, zwei Minuten noch mal speichern."}, HTTPStatus.CONFLICT)
                        return
                    store.save(stem, validate_boxes(body.get("boxes")), bool(body.get("done")))
                    self.json({"ok": True})
                elif path == "/api/release/pin":
                    self.json(pin_release(str(body.get("source"))))
                else:
                    self.send(HTTPStatus.NOT_FOUND, b"not found", "text/plain")
            except (ValueError, json.JSONDecodeError) as err:
                self.json({"error": str(err)}, HTTPStatus.BAD_REQUEST)

    return Handler


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8770)
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--run-job", action="store_true", help=argparse.SUPPRESS)
    ap.add_argument("--record-export", metavar="RUN", help=argparse.SUPPRESS)
    args = ap.parse_args()

    if args.run_job:
        run_job()
        return
    if args.record_export:
        record_export(args.record_export)
        return

    STUDIO.mkdir(parents=True, exist_ok=True)
    token = secrets.token_urlsafe(24)
    url = f"http://127.0.0.1:{args.port}/"
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(args.port, token))
    print(f"training studio at {url} — Ctrl+C to stop (running steps keep going)")
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
