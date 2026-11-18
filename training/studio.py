"""Training studio: the whole detector pipeline in one browser page.

    cd ../desktop-app && npm run build:studio    # once, and after UI changes
    python studio.py                             # opens http://127.0.0.1:8770

The page (React + the app's shadcn/ui components, built from
desktop-app/src/studio into studio-dist/) shows where every step stands,
lets you label tiles with a drawing toolbar, and runs "rounds": label a
batch, press "Speichern & neu trainieren", and the studio builds the dataset,
fine-tunes from the previous round, measures the model and refreshes the
suggestions for the tiles still open, while you keep labelling.

Long steps run as a detached job, so training keeps going when you close the
page or stop the studio; the page picks the job up again on the next start.

Local only: the server binds to 127.0.0.1, refuses other Host and Origin
headers (DNS rebinding, cross-site requests) and needs a per-start token for
every write. Commands are built from a fixed list; the browser sends a step
name and options that are validated here, never a path or a command line.
Nothing leaves the machine, except the one explicit "Startgewichte laden" step
(Ultralytics' DOTA weights from GitHub) and Claude sheets you hand to Claude.

Refusals are JSON {"error": <German text>, "code": <stable code>, "params": {...}};
the codes are listed in MESSAGES, so the page can show them in its own language.

Sandbox: with TRAINING_DATA_DIR set, runs/, export/ and dataset.yaml live in that
folder too (common.WORK); pinning a release and reading the real app database are
refused, and installing needs TRAINING_APP_MODELS_DIR.
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

import contextlib
import fcntl
import tempfile
import threading
import traceback

from common import (
    APP_DB,
    APP_MODELS_DIR,
    APP_MODELS_OVERRIDDEN,
    DATA,
    EXPORT,
    ROOT,
    RUNS,
    SANDBOX,
    WORK,
    base_weight_dirs,
    find_base_weights,
)
from review import Store, TileError, validate_boxes

DIST = ROOT / "studio-dist"
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
DEALERS_CSV = DATA / "dealers.csv"  # a dealer list uploaded in the studio; select_sites.py reads it
MODEL_NAME = "dealer_vehicles"
MAX_BODY = 2_000_000
# make_dataset.py refuses fewer finished sites; a round is refused before it starts.
MIN_ROUND_SITES = 5
# The start weights the studio can download for a fresh clone (Ultralytics release asset).
DEFAULT_BASE = "yolo11s-obb.pt"
# Columns select_sites.py reads from a dealer CSV (JanisKre/dealership_dataset layout).
DEALER_COLUMNS = ("ID", "OSM ID", "Latitude", "Longitude", "Federal State", "Dealership Name", "City")
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
        raise ApiError("path_invalid")
    return Path(full)


TAG = re.compile(r"^model-[a-z0-9._-]{1,60}$")
ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


# --- errors: a stable code per refusal, so the page can explain it in any language -----

MESSAGES = {
    "bad_request": "Ungültige Anfrage.",
    "body_invalid": "Die Anfrage ist kein gültiges JSON-Objekt.",
    "bad_token": "Das Studio wurde neu gestartet. Bitte die Seite neu laden.",
    "forbidden": "Zugriff verweigert.",
    "not_found": "Nicht gefunden.",
    "internal": "Interner Fehler im Studio ({detail}). Details stehen in der Konsole von studio.py.",
    "job_running": "Es läuft schon ein Schritt. Warte, bis er fertig ist, oder brich ihn ab.",
    "no_job": "Es läuft gerade kein Schritt.",
    "unknown_step": "Unbekannter Schritt „{step}“.",
    "options_invalid": "Die Optionen sind ungültig.",
    "number_invalid": "„{key}“ muss eine Zahl sein.",
    "integer_invalid": "„{key}“ muss eine ganze Zahl sein.",
    "out_of_range": "„{key}“ muss zwischen {lo} und {hi} liegen.",
    "run_unknown": "Unbekannter Lauf „{run}“.",
    "run_name_invalid": "Name: nur Kleinbuchstaben, Ziffern und Bindestriche, höchstens 41 Zeichen.",
    "run_exists": "Den Lauf „{run}“ gibt es schon. Wähle einen neuen Namen oder setze ihn fort.",
    "run_not_resumable": "„{run}“ lässt sich nicht fortsetzen: kein abgebrochener Lauf mit last.pt.",
    "base_unknown": "Unbekannte Startgewichte „{model}“.",
    "base_present": "Die Startgewichte {model} sind schon da.",
    "no_model": "Noch kein Modell: erst die Startgewichte laden oder ein Modell trainieren.",
    "sites_csv_missing": "Es gibt noch keine Standortliste ({file}). Zuerst eine Händler-CSV hochladen.",
    "dealers_csv_missing": "Zuerst eine Händler-CSV hochladen.",
    "dealers_csv_invalid": "Das ist keine Händler-CSV: es fehlen die Spalten {missing}.",
    "dealers_csv_empty": "Die Händler-CSV enthält keine Zeilen.",
    "file_too_large": "Die Datei ist zu groß (höchstens 2 MB).",
    "too_few_sites": "Eine Runde braucht mindestens {min} fertige Standorte, bisher sind es {finished}. Erst ganze Standorte fertig labeln.",
    "sandbox_harvest": "Im Sandbox-Modus aus: das würde die echte App-Datenbank lesen. Mit TRAINING_APP_MODELS_DIR geht es mit einer Kopie.",
    "no_app_db": "Keine App-Datenbank gefunden ({file}).",
    "sandbox_install": "Im Sandbox-Modus ohne TRAINING_APP_MODELS_DIR aus: das würde das echte Modell der App ersetzen.",
    "sandbox_release": "Im Sandbox-Modus aus: Ausliefern ändert desktop-app/src/shared/model-release.json im Repository.",
    "release_source_invalid": "Quelle muss „export“ oder „installed“ sein.",
    "release_incomplete": "Kein vollständiges Modell (ONNX und passendes Manifest) in {source}.",
    "release_pin_missing": "{file} fehlt. Das Studio aus dem Repository starten.",
    "release_tag_invalid": "Aus der Modellversion entsteht kein gültiger Tag ({tag}).",
    "tile_unknown": "Unbekannte Kachel.",
    "labels_locked": "Vorschläge werden gerade neu berechnet. Gespeichert wird danach automatisch.",
    "boxes_invalid": "Die Boxen sind ungültig ({detail}).",
    "box_outside_tile": "Eine Box liegt außerhalb der Kachel. Schieb sie zurück auf die Kachel.",
    "audit_merged": "Diese Audit-Kachel ist schon übernommen und lässt sich nicht mehr ändern.",
    "path_invalid": "Ungültiger Pfad.",
}


# Stage names and job titles: stable keys for the page (it translates them), German for the log.
STAGES = {
    "select_sites": "Standorte auswählen",
    "fetch": "Kacheln laden",
    "base_weights": "Startgewichte laden",
    "suggest": "Vorschläge berechnen",
    "claude_sheets": "Bögen erzeugen",
    "claude_apply": "Antworten übernehmen",
    "harvest": "App-Korrekturen lesen",
    "dataset": "Datensatz bauen",
    "train": "Training",
    "evaluate": "Auswerten",
    "errors": "Fehleranalyse",
    "export": "Exportieren",
    "export_record": "Export merken",
    "measure_ultralytics": "Messen (Ultralytics)",
    "measure_app": "Messen (App-Pipeline)",
    "finetune": "Feintuning",
    "suggest_open": "Neue Vorschläge für offene Kacheln",
}

TITLES = {
    "unknown": "{step}",
    "sites": "Standortliste anlegen ({count} Standorte)",
    "fetch": "Kacheln laden ({file})",
    "base_weights": "Startgewichte laden ({model})",
    "autolabel": "Vorschläge mit {model}",
    "autolabel_audit": "Audit-Fragen mit {model}",
    "claude_sheets": "Claude-Bögen erzeugen",
    "claude_apply": "Claude-Antworten übernehmen",
    "harvest": "Korrekturen aus der App lesen",
    "dataset": "Datensatz bauen",
    "dataset_pseudo": "Datensatz bauen mit Pseudo-Labels",
    "train": "Training {run} ({model}, {epochs} Epochen)",
    "train_resume": "Training {run} fortsetzen",
    "evaluate": "Auswerten: {run}",
    "errors": "Fehleranalyse: {run}",
    "export": "Exportieren: {run}",
    "export_install": "Exportieren: {run} und in der App installieren",
    "measure": "Messen: {run}",
    "round": "Runde {n}: {sites} Standorte, {epochs} Epochen ab {base}",
}

class ApiError(Exception):
    """A refused request: a stable `code` (the page can translate by it), the German text
    and the parameters that went into it. Sent as {"error", "code", "params"}."""

    def __init__(self, code: str, status: int = HTTPStatus.BAD_REQUEST, **params):
        self.code, self.status, self.params = code, int(status), params
        super().__init__(MESSAGES.get(code, code).format(**params))

    def body(self) -> dict:
        return {"error": str(self), "code": self.code, "params": self.params}


# --- small helpers -------------------------------------------------------------------


def now() -> str:
    return dt.datetime.now().isoformat(timespec="seconds")


def read_json(path: Path, default=None):
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, ValueError):
        return default


def write_json(path: Path, data) -> None:
    """Atomic: a unique temporary file per writer, then a rename (parallel writers never
    share a .tmp file, and readers never see half a file)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            f.write(json.dumps(data, indent=1))
        os.replace(tmp, path)
    except BaseException:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(tmp)
        raise


_job_thread_lock = threading.Lock()


@contextlib.contextmanager
def job_lock():
    """Serialises every read-modify-write of job.json and rounds.json: across the
    server's request threads (threading lock) and between the server and the job
    driver, which is its own process (flock on data/studio/job.lock)."""
    with _job_thread_lock:
        STUDIO.mkdir(parents=True, exist_ok=True)
        with open(STUDIO / "job.lock", "a") as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(f, fcntl.LOCK_UN)


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
    # A job driver this studio started and that has died stays a zombie child until it
    # is reaped, and os.kill(pid, 0) still succeeds on a zombie: reap it first.
    with contextlib.suppress(ChildProcessError, OSError):
        if os.waitpid(pid, os.WNOHANG)[0] == pid:
            return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def group_alive(pgid: int | None) -> bool:
    """Whether any process of a job's process group still runs (the driver starts its
    own group, so its stages keep the group id even after the driver died)."""
    if not pgid:
        return False
    try:
        os.killpg(pgid, 0)
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
        "weights": weights_label(weights),
    }


def weights_label(weights: str | None) -> str | None:
    """runs/<run>/weights/best.pt → <run>; start weights (yolo11s-obb.pt) keep their file name."""
    if not weights:
        return None
    path = Path(weights)
    return path.parent.parent.name if path.parent.name == "weights" else path.name


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
    if installed:
        # Which run the installed model came from: a recorded export, or a run's own best.onnx.
        installed["weights"] = next((e["run"] for e in reversed(exports) if e.get("sha256") == installed["sha256"]), None) or next(
            (p.parent.parent.name for p in sorted(RUNS.glob("*/weights/best.onnx")) if sha256(p) == installed["sha256"]), None
        )
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
            # Why pinning is refused right now (None: allowed).
            "blocked": "sandbox_release" if SANDBOX else None,
        },
        # Why installing into the app is refused right now (None: allowed).
        "installBlocked": "sandbox_install" if SANDBOX and not APP_MODELS_OVERRIDDEN else None,
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
        "rounds": rounds_status(job),
        "weights": weight_choices(),
        "baseModels": base_models(),
        "claude": {
            "sheets": len(list((DATA / "claude" / "sheets").glob("*.png"))),
            "answers": len(list((DATA / "claude" / "answers").glob("*.txt"))),
        },
        "appDb": APP_DB.exists(),
        # Why "Korrekturen aus der App übernehmen" is refused right now (None: allowed).
        "harvestBlocked": harvest_blocked(),
        "sandbox": {"data": str(DATA), "appModels": str(APP_MODELS_DIR) if APP_MODELS_OVERRIDDEN else None} if SANDBOX else None,
        "minRoundSites": MIN_ROUND_SITES,
        "finishedSites": len(finished_sites()),
        "dealersCsv": DEALERS_CSV.exists(),
        "defaultBase": DEFAULT_BASE,
    }


def harvest_blocked() -> str | None:
    if SANDBOX and not APP_MODELS_OVERRIDDEN:
        return "sandbox_harvest"
    if not APP_DB.exists():
        return "no_app_db"
    return None


# --- option checks --------------------------------------------------------------------


def weight_choices() -> list[str]:
    return sorted(p.parent.parent.name for p in RUNS.glob("*/weights/best.pt")) if RUNS.exists() else []


def base_models() -> list[str]:
    return sorted({p.name for d in base_weight_dirs() for p in d.glob("yolo*-obb.pt") if p.is_file()})


def opt_run(opts: dict, key: str = "weights") -> str:
    value = opts.get(key)
    if value not in weight_choices():
        raise ApiError("run_unknown", run=str(value))
    return value


def opt_float(opts: dict, key: str, lo: float, hi: float, default: float | None = None) -> float | None:
    value = opts.get(key, default)
    if value is None or value == "":
        return None
    try:
        value = float(value)
    except (TypeError, ValueError) as err:
        raise ApiError("number_invalid", key=key) from err
    if not lo <= value <= hi:
        raise ApiError("out_of_range", key=key, lo=lo, hi=hi)
    return value


def opt_int(opts: dict, key: str, lo: int, hi: int, default: int) -> int:
    value = opts.get(key, default)
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise ApiError("integer_invalid", key=key)
    try:
        value = int(value)
    except ValueError as err:
        raise ApiError("integer_invalid", key=key) from err
    if not lo <= value <= hi:
        raise ApiError("out_of_range", key=key, lo=lo, hi=hi)
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


def run_states() -> dict[str, str]:
    return {r["name"]: r["state"] for r in runs_status(None)}


def export_version(run: str) -> str:
    """Manifest version (and release tag) of an export: the date plus the run, so two
    runs installed on the same day never share a version or a release tag."""
    return f"{dt.date.today().isoformat()}-{run}"


# Downloads Ultralytics' DOTA start weights to an absolute path (so they land in the
# work folder, not in the current directory or Ultralytics' settings folder).
FETCH_WEIGHTS = (
    "import sys\n"
    "from ultralytics.utils.downloads import attempt_download_asset\n"
    "print(attempt_download_asset(sys.argv[1]))\n"
)


def build_job(step: str, opts: dict) -> dict:
    """Step name + options → the commands to run. The only place commands are built."""
    if not isinstance(opts, dict):
        raise ApiError("options_invalid")
    stages: list[dict] = []
    run = None
    title = job_title("unknown", step=step)
    if step == "sites":
        if not DEALERS_CSV.exists():
            raise ApiError("dealers_csv_missing")
        count = opt_int(opts, "count", 5, 2000, 80)
        stages = [stage("select_sites", py("select_sites.py", str(DEALERS_CSV), "--count", str(count)))]
        title = job_title("sites", count=count)
    elif step == "fetch":
        csv_name = "negatives.csv" if opt_bool(opts, "negatives") else "sites.csv"
        if not (DATA / csv_name).exists():
            raise ApiError("sites_csv_missing", file=csv_name)
        stages = [stage("fetch", py("fetch_tiles.py", str(DATA / csv_name)))]
        title = job_title("fetch", file=csv_name)
    elif step == "base-weights":
        model = opts.get("model", DEFAULT_BASE)
        if model != DEFAULT_BASE:
            raise ApiError("base_unknown", model=str(model))
        if find_base_weights(model):
            raise ApiError("base_present", model=model)
        # The only step that goes online (Ultralytics' GitHub release); YOLO_OFFLINE off for it.
        stages = [stage("base_weights", [sys.executable, "-u", "-c", FETCH_WEIGHTS, str(WORK / model)], env={"YOLO_OFFLINE": "0"}, cwd=WORK)]
        title = job_title("base_weights", model=model)
    elif step == "autolabel":
        audit = opt_bool(opts, "audit")
        if opts.get("base"):
            # First suggestions before any training: the DOTA start weights, vehicles only.
            model = opts.get("base")
            path = find_base_weights(model) if model in base_models() else None
            if path is None:
                raise ApiError("base_unknown", model=str(model))
            args = ["--weights", str(path), "--dota"]
            run = None
            label = model
        else:
            run = opt_run(opts)
            args = ["--weights", weights_path(run)]
            label = run
        if audit:
            args.append("--audit")
        stages = [stage("suggest", awake(py("autolabel.py", *args)), lock=True)]
        title = job_title("autolabel_audit" if audit else "autolabel", model=label)
    elif step == "claude-sheets":
        stages = [stage("claude_sheets", py("claude_review.py", "sheets", "--buckets", "candidate"))]
        title = job_title("claude_sheets")
    elif step == "claude-apply":
        stages = [stage("claude_apply", py("claude_review.py", "apply", "--auto"), lock=True)]
        title = job_title("claude_apply")
    elif step == "harvest":
        if (blocked := harvest_blocked()) is not None:
            raise ApiError(blocked, file=str(APP_DB))
        stages = [stage("harvest", py("harvest_app.py", "sites"))]
        title = job_title("harvest")
    elif step == "dataset":
        args = []
        if opt_bool(opts, "pseudo"):
            args.append("--pseudo")
        degrade = opt_float(opts, "degrade", 0, 1, 0.5)
        args += ["--degrade", f"{degrade:g}"]
        stages = [stage("dataset", py("make_dataset.py", *args))]
        title = job_title("dataset_pseudo" if opt_bool(opts, "pseudo") else "dataset")
    elif step == "train":
        run = opts.get("name")
        if not isinstance(run, str) or not RUN_NAME.fullmatch(run):
            raise ApiError("run_name_invalid")
        if opt_bool(opts, "resume"):
            # Only an interrupted run resumes; Ultralytics would restart a finished one oddly.
            if not contained(RUNS, run, "weights", "last.pt").exists() or run_states().get(run) != "interrupted":
                raise ApiError("run_not_resumable", run=run)
            stages = [stage("train", awake(py("train.py", "--name", run, "--resume")))]
            title = job_title("train_resume", run=run)
        else:
            if contained(RUNS, run).exists():
                raise ApiError("run_exists", run=run)
            model = opts.get("model")
            path = find_base_weights(model) if model in base_models() else None
            if path is None:
                raise ApiError("base_unknown", model=str(model))
            epochs = opt_int(opts, "epochs", 1, 300, 60)
            args = ["--name", run, "--model", str(path), "--epochs", str(epochs)]
            fraction = opt_float(opts, "fraction", 0.01, 1, 1)
            if fraction is not None and fraction < 1:
                args += ["--fraction", f"{fraction:g}"]
            stages = [stage("train", awake(py("train.py", *args)))]
            title = job_title("train", run=run, model=model, epochs=epochs)
    elif step == "evaluate":
        run = opt_run(opts)
        out = EVALS / f"ultralytics-{run}-{dt.datetime.now():%Y-%m-%d-%H%M%S}.json"
        stages = [stage("evaluate", awake(py("evaluate.py", "--weights", weights_path(run), "--sweep", "--json", str(out))))]
        title = job_title("evaluate", run=run)
    elif step == "errors":
        run = opt_run(opts)
        conf = opt_float(opts, "conf", 0.05, 0.95, 0.45)
        stages = [stage("errors", awake(py("analyze_errors.py", "--weights", weights_path(run), "--conf", f"{conf:g}", "--sheets")))]
        title = job_title("errors", run=run)
    elif step == "export":
        run = opt_run(opts)
        args = ["--weights", weights_path(run), "--version", export_version(run)]
        conf = opt_float(opts, "defaultConf", 0.05, 0.95)
        if conf is not None:
            args += ["--default-conf", f"{conf:g}"]
        install = opt_bool(opts, "install")
        if install:
            if SANDBOX and not APP_MODELS_OVERRIDDEN:
                raise ApiError("sandbox_install")
            args.append("--install")
        stages = [stage("export", py("export.py", *args)), stage("export_record", py("studio.py", "--record-export", run))]
        title = job_title("export_install" if install else "export", run=run)
    elif step == "round":
        return build_round(opts)
    elif step == "measure":
        run = opt_run(opts)
        stages = measure_stages(run, dt.datetime.now().strftime("%Y-%m-%d-%H%M%S"))
        title = job_title("measure", run=run)
    else:
        raise ApiError("unknown_step", step=step)
    return {"step": step, **title, "run": run, "stages": stages, "options": opts}


def stage(key: str, argv: list[str], *, env: dict | None = None, cwd: Path | None = None, lock: bool = False) -> dict:
    """One command of a job. `key` is stable (STAGES; the page translates by it), `name` the
    German text for the log. `lock` blocks label saves meanwhile (the stage rewrites tile files)."""
    return {"key": key, "name": STAGES[key], "argv": argv, "env": env or {}, "cwd": str(cwd or ROOT), "lock": lock}


def job_title(key: str, **params) -> dict:
    """A job's title: the German text (log, command line) plus a stable key and its
    parameters, so the page can show it in its own language."""
    return {"title": TITLES[key].format(**params), "titleKey": key, "titleParams": params}


# --- dealer list upload (a fresh clone's first step) ------------------------------------


def save_dealers_csv(text: object) -> dict:
    """Stores an uploaded dealer CSV as data/dealers.csv after checking it has the
    columns select_sites.py reads. Only the content is sent, never a path."""
    if not isinstance(text, str):
        raise ApiError("body_invalid")
    rows = list(csv.DictReader(text.lstrip("﻿").splitlines()))
    columns = set(rows[0].keys()) if rows else set(next(csv.reader(text.lstrip("﻿").splitlines()), []))
    missing = [c for c in DEALER_COLUMNS if c not in columns]
    if missing:
        raise ApiError("dealers_csv_invalid", missing=", ".join(missing))
    if not rows:
        raise ApiError("dealers_csv_empty")
    DATA.mkdir(parents=True, exist_ok=True)
    DEALERS_CSV.write_text(text, encoding="utf-8")
    return {"rows": len(rows)}


# --- rounds: label a batch, then retrain from the last round ---------------------------

ROUND = re.compile(r"^round-(\d{2,3})$")


def rounds() -> list[dict]:
    return read_json(ROUNDS_FILE, []) or []


def rounds_status(job: dict | None = None) -> list[dict]:
    """Rounds with their outcome. `state`: running, done, failed, stopped, lost, or
    unknown for older entries without a recorded outcome and without a model."""
    out = []
    evals = evals_status()
    for r in rounds():
        run = r["run"]
        app = next((e for e in reversed(evals) if e.get("run") == run and e.get("pipeline") == "app-inferWindow"), None)
        best = min(app["thresholds"], key=lambda t: t["mae"]) if app else None
        # Entries written before outcomes were recorded: done when the run has weights,
        # otherwise the outcome is unknown (no model came out of it).
        state = r.get("state") or ("done" if (RUNS / run / "weights" / "best.pt").exists() else "unknown")
        if job and job.get("id") == r.get("jobId"):
            state = job["status"] if job["status"] != "running" else "running"
        out.append({**r, "state": state, "appBest": best})
    return out


def measure_stages(run: str, stamp: str) -> list[dict]:
    """Ultralytics sweep, ONNX export (not installed) and the app-pipeline benchmark."""
    stages = [
        stage("measure_ultralytics", awake(py("evaluate.py", "--weights", weights_path(run), "--sweep", "--json", str(EVALS / f"ultralytics-{run}-{stamp}.json")))),
        stage("export", py("export.py", "--weights", weights_path(run), "--version", export_version(run))),
        stage("export_record", py("studio.py", "--record-export", run)),
    ]
    npm = shutil.which("npm")
    if npm and (DESKTOP_APP / "node_modules").exists():
        stages.append(
            stage(
                "measure_app",
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
    return stages


def build_round(opts: dict) -> dict:
    """Dataset → fine-tune from the base run → measure (Ultralytics + app pipeline) →
    fresh suggestions for the open tiles (skipped once every site is finished). Human labels only unless `pseudo` is set:
    a model that saw its own pseudo-labels would be over-confident on exactly the
    tiles it suggests boxes for next.

    Refused before anything is recorded when make_dataset.py would refuse anyway."""
    base = opt_run(opts, "base")
    epochs = opt_int(opts, "epochs", 3, 120, 15)
    pseudo = opt_bool(opts, "pseudo")
    done = finished_sites()  # the same rule as make_dataset.py and autolabel.py (all tiles ticked)
    finished = len(done)
    if finished < MIN_ROUND_SITES:
        raise ApiError("too_few_sites", min=MIN_ROUND_SITES, finished=finished)
    numbers = [int(m.group(1)) for p in RUNS.glob("round-*") if (m := ROUND.match(p.name))] + [int(m.group(1)) for r in rounds() if (m := ROUND.match(r["run"]))]
    run = f"round-{max(numbers, default=0) + 1:02d}"
    sites = sites_status()
    stamp = dt.datetime.now().strftime("%Y-%m-%d-%H%M%S")
    stages = [
        stage("dataset", py("make_dataset.py", *(["--pseudo"] if pseudo else []))),
        stage("finetune", awake(py("train.py", "--name", run, "--model", weights_path(base), "--epochs", str(epochs)))),
        *measure_stages(run, stamp),
    ]
    if {site_of(p.stem) for p in RAW.glob("*.jpg")} - done:  # everything labelled: autolabel.py would refuse
        stages.append(stage("suggest_open", awake(py("autolabel.py", "--weights", weights_path(run))), lock=True))
    entry = {
        "run": run,
        "base": base,
        "epochs": epochs,
        "pseudo": pseudo,
        "started": now(),
        "finishedSites": finished,
        "checkedTiles": sites["checkedTiles"],
        "state": "running",
    }
    return {
        "step": "round",
        **job_title("round", n=run.removeprefix("round-"), sites=finished, epochs=epochs, base=base),
        "run": run,
        "stages": stages,
        "options": opts,
        "round": entry,  # recorded in rounds.json by start_job, once the job is accepted
    }


def current_stage(job: dict) -> dict:
    stages = job.get("stages") or []
    return stages[min(job.get("stage", 0), len(stages) - 1)] if stages else {}


def stage_name(job: dict) -> str | None:
    return current_stage(job).get("name")


def stage_key(job: dict) -> str | None:
    return current_stage(job).get("key")


def job_running(job: object) -> bool:
    """A job counts as running while its driver lives, or while it is just being started."""
    if not isinstance(job, dict) or job.get("status") != "running":
        return False
    if job.get("pid") is None:
        started = dt.datetime.fromisoformat(job["started"]).timestamp() if job.get("started") else 0
        return time.time() - started < 10
    return pid_alive(job.get("pid"))


def record_round_outcome(job: dict) -> None:
    """Writes a round job's outcome into its rounds.json entry (call under job_lock)."""
    if job.get("step") != "round":
        return
    entries = rounds()
    for r in entries:
        if r.get("jobId") == job.get("id") and r.get("state", "running") == "running":
            r["state"] = job["status"]
            r["ended"] = job.get("ended") or now()
            if job["status"] in ("failed", "stopped", "lost"):
                r["failedStage"] = stage_name(job)
                r["failedStageKey"] = stage_key(job)
            write_json(ROUNDS_FILE, entries)
            return


# --- jobs (one at a time, detached so they outlive the studio) ------------------------


def job_status() -> dict | None:
    with job_lock():
        job = read_json(JOB_FILE)
        if not isinstance(job, dict):
            return None
        log_file = Path(job.get("logFile") or "")
        if job.get("logFile") and not log_file.resolve().is_relative_to(JOBS.resolve()):
            return None  # a job.json copied from another data folder or worktree
        if job.get("status") == "running" and not job_running(job):
            # The driver died (killed, crash, reboot): its stages may still run as orphans.
            job["status"] = "lost"
            job["ended"] = job.get("ended") or now()
            job["locked"] = False
            write_json(JOB_FILE, job)
            record_round_outcome(job)
    job["orphans"] = job.get("status") == "lost" and group_alive(job.get("pid"))
    job["log"] = log_tail(log_file) if job.get("logFile") else []
    if job.get("status") in ("failed", "lost"):
        job["error"] = job_error(job)
    return job


def job_error(job: dict) -> dict:
    """A one-line reason for a failed job: the stage and the last message its command
    printed before it exited (a Python error's last line, or a script's SystemExit text)."""
    name = stage_name(job)
    if job.get("status") == "lost":
        return {"code": "job_lost", "stage": name, "stageKey": stage_key(job), "message": "Der Schritt lief nicht weiter: das Studio oder der Rechner wurde beendet, oder der Prozess wurde abgebrochen."}
    lines = job.get("log") or []
    end = next((i for i in range(len(lines) - 1, -1, -1) if lines[i].startswith("[exit ")), len(lines))
    reason = next((ln.strip() for ln in reversed(lines[:end]) if ln.strip() and not ln.startswith(("▶", "$ "))), "")
    return {"code": "stage_failed", "stage": name, "stageKey": stage_key(job), "message": reason[:300]}


def log_tail(path: Path, max_lines: int = 160) -> list[str]:
    """Last lines of a job log; progress bars (\\r) collapse to their latest state."""
    try:
        with path.open("rb") as f:
            f.seek(0, os.SEEK_END)
            size = f.tell()
            f.seek(max(0, size - 96_000))
            text = f.read().decode("utf-8", "replace")
    except (FileNotFoundError, IsADirectoryError):
        return []
    lines = []
    for line in text.split("\n"):
        segments = [seg for seg in ANSI.sub("", line).split("\r") if seg.strip()]
        if segments:
            lines.append(segments[-1][:2000])
    return lines[-max_lines:]


def start_job(step: str, opts: dict) -> dict:
    job = build_job(step, opts)  # validates; nothing is written before this passes
    with job_lock():
        if job_running(read_json(JOB_FILE)):
            raise ApiError("job_running", HTTPStatus.CONFLICT)
        JOBS.mkdir(parents=True, exist_ok=True)
        job_id = f"{dt.datetime.now():%Y%m%d-%H%M%S-%f}-{step}"
        job.update({"id": job_id, "status": "running", "pid": None, "started": now(), "logFile": str(JOBS / f"{job_id}.log"), "stage": 0})
        entry = job.pop("round", None)
        if entry:
            all_rounds = rounds()
            all_rounds.append({**entry, "jobId": job_id})
            write_json(ROUNDS_FILE, all_rounds)
        write_json(JOB_FILE, job)
        proc = subprocess.Popen(
            [sys.executable, str(ROOT / "studio.py"), "--run-job"],
            cwd=ROOT,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,  # own process group: survives the studio, stoppable as a whole
        )
        current = read_json(JOB_FILE) or {}
        if current.get("id") == job_id and current.get("pid") is None:
            current["pid"] = proc.pid
            write_json(JOB_FILE, current)
    job["pid"] = proc.pid
    return job


def set_job_fields(job_id: str, **fields) -> None:
    """Read-modify-write of the job file; both the studio and the job driver call it."""
    with job_lock():
        current = read_json(JOB_FILE) or {}
        if current.get("id") == job_id:
            current.update(fields)
            write_json(JOB_FILE, current)
            if fields.get("status") in ("done", "failed", "stopped", "lost"):
                record_round_outcome(current)


def stop_job() -> None:
    """Stops the running job's whole process group. When the driver is already gone
    (killed, crashed) nobody would record the outcome, so the studio does."""
    job = job_status()
    if not isinstance(job, dict):
        raise ApiError("no_job")
    pgid = job.get("pid")
    if not (job.get("status") == "running" or job.get("orphans")) or not group_alive(pgid):
        raise ApiError("no_job")
    os.killpg(pgid, signal.SIGTERM)
    # A live driver records "stopped" itself (SIGTERM handler); give it a moment.
    deadline = time.time() + 3
    while time.time() < deadline and pid_alive(pgid):
        time.sleep(0.1)
    current = read_json(JOB_FILE) or {}
    if current.get("id") == job.get("id") and current.get("status") in ("running", "lost"):
        set_job_fields(job["id"], status="stopped", ended=now(), locked=False)


def run_job() -> None:
    """Job driver (own process): runs the stages in order and records the outcome."""
    job = read_json(JOB_FILE)
    log = Path(job["logFile"])
    child: subprocess.Popen | None = None
    stopping = False

    def finish(state: str, code: int | None) -> None:
        set_job_fields(job["id"], status=state, returncode=code, ended=now(), locked=False)

    def on_term(*_):
        # Only flag it: the handler may interrupt a job-file write that holds the lock.
        nonlocal stopping
        stopping = True
        if child and child.poll() is None:
            child.terminate()

    signal.signal(signal.SIGTERM, on_term)
    set_job_fields(job["id"], pid=os.getpid())
    with log.open("a") as out:
        for i, st in enumerate(job["stages"]):
            if stopping:
                break
            set_job_fields(job["id"], stage=i, locked=bool(st.get("lock")))
            shown = " ".join("python" if a == sys.executable else a.replace(f"{ROOT}/", "") for a in st["argv"])
            out.write(f"\n▶ {st['name']}\n$ {shown}\n")
            out.flush()
            # YOLO_OFFLINE: no update checks against PyPI during training (nothing leaves the machine).
            env = {**os.environ, "PYTHONUNBUFFERED": "1", "YOLO_AUTOINSTALL": "false", "YOLO_OFFLINE": "1", **st.get("env", {})}
            child = subprocess.Popen(st["argv"], cwd=st.get("cwd") or ROOT, stdout=out, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, env=env)
            code = child.wait()
            if stopping:
                break
            if code != 0:
                out.write(f"\n[exit {code}]\n")
                finish("failed", code)
                return
    if stopping:
        out_note = "\n[abgebrochen]\n"
        with log.open("a") as out:
            out.write(out_note)
        finish("stopped", None)
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
    if SANDBOX:
        # The pin is a tracked repository file; a sandbox model must never end up in it.
        raise ApiError("sandbox_release")
    folder = {"export": EXPORT, "installed": APP_MODELS_DIR}.get(source)
    if folder is None:
        raise ApiError("release_source_invalid")
    if job_running(read_json(JOB_FILE)):
        raise ApiError("job_running", HTTPStatus.CONFLICT)
    files = model_files(folder)
    if not files or not files["manifestMatches"]:
        raise ApiError("release_incomplete", source=source)
    pin = read_json(RELEASE_PIN)
    if not isinstance(pin, dict):
        raise ApiError("release_pin_missing", file=str(RELEASE_PIN))
    tag = f"model-{MODEL_NAME.replace('_', '-')}-{files['version']}"
    if not TAG.fullmatch(tag):
        raise ApiError("release_tag_invalid", tag=tag)
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

        def fail(self, err: ApiError) -> None:
            self.json(err.body(), err.status)

        def guard(self) -> bool:
            # Local tool: refuse other hosts (DNS rebinding) and cross-site requests.
            if self.headers.get("Host") not in allowed_hosts:
                self.fail(ApiError("forbidden", HTTPStatus.FORBIDDEN))
                return False
            origin = self.headers.get("Origin")
            if origin and origin.split("//", 1)[-1] not in allowed_hosts:
                self.fail(ApiError("forbidden", HTTPStatus.FORBIDDEN))
                return False
            return True

        def mode(self) -> str:
            query = self.path.split("?", 1)[1] if "?" in self.path else ""
            return "audit" if "mode=audit" in query.split("&") else "label"

        def safely(self, handle) -> None:
            """Every refusal as {"error", "code"}; an unexpected error as one 500, logged."""
            try:
                handle()
            except ApiError as err:
                self.fail(err)
            except TileError as err:
                self.fail(ApiError(err.code, detail=str(err)))
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception as err:  # noqa: BLE001 — the server keeps running, the page gets an answer
                traceback.print_exc()
                with contextlib.suppress(Exception):
                    self.fail(ApiError("internal", HTTPStatus.INTERNAL_SERVER_ERROR, detail=type(err).__name__))

        def do_GET(self) -> None:  # noqa: N802
            if self.guard():
                self.safely(self.get)

        def get(self) -> None:
            path = self.path.split("?", 1)[0]
            if path == "/":
                index = DIST / "index.html"
                if not index.exists():
                    self.send(
                        200,
                        b"<!doctype html><meta charset=utf-8><title>Training Studio</title><body style='font:15px system-ui;padding:40px'>"
                        b"<h1>Training Studio</h1><p>Die Oberfl\xc3\xa4che ist noch nicht gebaut:</p>"
                        b"<pre>cd desktop-app &amp;&amp; npm ci &amp;&amp; npm run build:studio</pre><p>Danach diese Seite neu laden.</p>",
                        "text/html; charset=utf-8",
                    )
                    return
                self.send(200, index.read_text().replace("__STUDIO_TOKEN__", token).encode(), "text/html; charset=utf-8")
            elif path == "/favicon.ico":
                self.send(HTTPStatus.NO_CONTENT, b"", "image/x-icon")
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
                raise ApiError("not_found", HTTPStatus.NOT_FOUND)

        def do_POST(self) -> None:  # noqa: N802
            if self.guard():
                self.safely(self.post)

        def post(self) -> None:
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError as err:
                raise ApiError("bad_request") from err
            if self.headers.get("Content-Type") != "application/json":
                raise ApiError("bad_request")
            if not secrets.compare_digest(self.headers.get("X-Studio-Token", ""), token):
                # The usual cause: the studio was restarted and the open page has the old token.
                raise ApiError("bad_token", HTTPStatus.FORBIDDEN)
            if length > MAX_BODY:
                raise ApiError("file_too_large", HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
            if length <= 0:
                raise ApiError("bad_request")
            try:
                body = json.loads(self.rfile.read(length))
            except ValueError as err:
                raise ApiError("body_invalid") from err
            if not isinstance(body, dict):
                raise ApiError("body_invalid")
            path = self.path.split("?", 1)[0]
            if path == "/api/run":
                self.json({"job": start_job(str(body.get("step")), body.get("options") or {})})
            elif path == "/api/stop":
                stop_job()
                self.json({"ok": True})
            elif path == "/api/sites/upload":
                self.json(save_dealers_csv(body.get("csv")))
            elif path.startswith("/api/label/tile/"):
                store = STORES[self.mode()]
                stem = store.lookup(path.removeprefix("/api/label/tile/"))
                if stem is None:
                    raise ApiError("tile_unknown", HTTPStatus.NOT_FOUND)
                if labels_locked():
                    raise ApiError("labels_locked", HTTPStatus.CONFLICT)
                saved = store.save(stem, validate_boxes(body.get("boxes")), bool(body.get("done")))
                self.json({"ok": True, **saved})
            elif path == "/api/release/pin":
                self.json(pin_release(str(body.get("source"))))
            else:
                raise ApiError("not_found", HTTPStatus.NOT_FOUND)

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
