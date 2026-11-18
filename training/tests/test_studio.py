"""Checks of the studio's save, round and job rules (no torch, no network, no real data).

    cd training && .venv/bin/python -m unittest discover -s tests

Every test runs against a throw-away TRAINING_DATA_DIR, set before the training
modules are imported, so nothing under training/data, runs/ or export/ is touched.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

SANDBOX = tempfile.mkdtemp(prefix="studio-test-")
os.environ["TRAINING_DATA_DIR"] = str(Path(SANDBOX) / "data")
os.environ["TRAINING_APP_MODELS_DIR"] = str(Path(SANDBOX) / "models")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import common  # noqa: E402
import review  # noqa: E402
import studio  # noqa: E402

DATA = common.DATA


def box(origin: str = "model", decision=None, bucket: str = "check", label_index: int | None = None) -> dict:
    b = {"cls": 0, "corners": [[10, 10], [40, 10], [40, 25], [10, 25]], "origin": origin, "bucket": bucket, "decision": decision}
    if label_index is not None:
        b["labelIndex"] = label_index
    return b


def write_tile(folder: Path, stem: str, boxes: list[dict], done: bool = False) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{stem}.json").write_text(json.dumps({"image": f"{stem}.jpg", "done": done, "boxes": boxes}))


def raw_label(stem: str, n: int) -> None:
    """X-AnyLabeling JSON with n rotated boxes, ticked as done."""
    common.RAW.mkdir(parents=True, exist_ok=True)
    shapes = [review.shape(0, [[10 + i, 10], [40 + i, 10], [40 + i, 25], [10 + i, 25]]) for i in range(n)]
    (common.RAW / f"{stem}.json").write_text(json.dumps({"checked": True, "shapes": shapes}))
    (common.RAW / f"{stem}.jpg").write_bytes(b"")


class SandboxPaths(unittest.TestCase):
    def test_everything_written_stays_in_the_sandbox(self):
        self.assertTrue(common.SANDBOX)
        for path in (common.RUNS, common.EXPORT, common.DATASET_YAML, studio.STUDIO):
            self.assertTrue(str(path).startswith(str(DATA)), path)
        self.assertEqual(common.APP_DB, Path(SANDBOX).resolve() / "dealership-risk.db")

    def test_release_pin_is_refused_in_a_sandbox(self):
        with self.assertRaises(studio.ApiError) as err:
            studio.pin_release("installed")
        self.assertEqual(err.exception.code, "sandbox_release")


class Saving(unittest.TestCase):
    def setUp(self):
        self.store = review.Store(audit=False)
        self.audit = review.Store(audit=True)

    def test_late_draft_does_not_reopen_a_finished_tile(self):
        # Tester B, B1/B2: a draft (done=False) after "Kachel fertig", or any edit
        # on a finished tile, used to set done=false on disk.
        stem = "BY-osm1__0_0"
        write_tile(review.AUTOLABEL, stem, [box(), box(decision="car")])
        out = self.store.save(stem, review.validate_boxes([box(), box(decision="car")]), True)
        self.assertEqual(out, {"done": True, "questions": 0})
        late = self.store.save(stem, review.validate_boxes([box(), box(decision="car"), box("manual", "car", "manual")]), False)
        self.assertTrue(late["done"])
        tile = json.loads((review.AUTOLABEL / f"{stem}.json").read_text())
        self.assertTrue(tile["done"])
        self.assertEqual([b["decision"] for b in tile["boxes"]], ["no", "car", "car"])
        # the edit reached the labels too: 2 accepted boxes
        raw = json.loads((common.RAW / f"{stem}.json").read_text())
        self.assertEqual(len(raw["shapes"]), 2)

    def test_draft_of_an_open_tile_stays_open(self):
        stem = "BY-osm1__0_1"
        write_tile(review.AUTOLABEL, stem, [box(), box()])
        out = self.store.save(stem, review.validate_boxes([box(decision="car"), box()]), False)
        self.assertEqual(out, {"done": False, "questions": 1})

    def test_audit_finish_keeps_labels_you_did_not_answer(self):
        # Tester B, B5: unanswered "Ist dieses Label richtig?" deleted the label.
        stem = "BE-osm2__1_2"
        raw_label(stem, 3)
        boxes = [box("label", None, label_index=0), box("label", "no", label_index=1), box("label", None, label_index=2), box()]
        write_tile(review.AUTOLABEL_AUDIT, stem, boxes)
        self.audit.save(stem, review.validate_boxes(boxes), True)
        raw = json.loads((common.RAW / f"{stem}.json").read_text())
        self.assertEqual(len(raw["shapes"]), 2)  # only the label answered "no" is gone

    def test_merged_audit_tile_refuses_with_a_code(self):
        stem = "BE-osm2__1_3"
        write_tile(review.AUTOLABEL_AUDIT, stem, [box()], done=True)
        with self.assertRaises(review.TileError) as err:
            self.audit.save(stem, [box()], False)
        self.assertEqual(err.exception.code, "audit_merged")

    def test_box_off_the_tile_has_its_own_code(self):
        far = box()
        far["corners"] = [[2000, -900], [2030, -900], [2030, -880], [2000, -880]]
        with self.assertRaises(review.TileError) as err:
            review.validate_boxes([far])
        self.assertEqual(err.exception.code, "box_outside_tile")


class Rounds(unittest.TestCase):
    def test_round_with_too_few_sites_is_refused_before_anything_is_written(self):
        (common.RUNS / "base" / "weights").mkdir(parents=True, exist_ok=True)
        (common.RUNS / "base" / "weights" / "best.pt").write_bytes(b"")
        with self.assertRaises(studio.ApiError) as err:
            studio.start_job("round", {"base": "base", "epochs": 3})
        self.assertEqual(err.exception.code, "too_few_sites")
        self.assertFalse(studio.ROUNDS_FILE.exists())
        self.assertFalse(studio.JOB_FILE.exists())

    def test_suggestion_stage_only_while_tiles_are_open(self):
        # round-01 was marked failed: every site was finished and autolabel.py found nothing to label.
        (common.RUNS / "base" / "weights").mkdir(parents=True, exist_ok=True)
        (common.RUNS / "base" / "weights" / "best.pt").write_bytes(b"")
        stems = [f"BE-osm{i}__0_0" for i in range(studio.MIN_ROUND_SITES)]
        try:
            for stem in stems:
                raw_label(stem, 1)
            keys = [s["key"] for s in studio.build_round({"base": "base", "epochs": 3})["stages"]]
            self.assertNotIn("suggest_open", keys)
            (common.RAW / "BE-open__0_0.jpg").write_bytes(b"")
            (common.RAW / "BE-open__0_0.json").write_text(json.dumps({"checked": False, "shapes": []}))
            keys = [s["key"] for s in studio.build_round({"base": "base", "epochs": 3})["stages"]]
            self.assertEqual(keys[-1], "suggest_open")
        finally:
            for stem in [*stems, "BE-open__0_0"]:
                (common.RAW / f"{stem}.jpg").unlink(missing_ok=True)
                (common.RAW / f"{stem}.json").unlink(missing_ok=True)

    def test_outcome_is_recorded_in_the_round(self):
        studio.write_json(studio.ROUNDS_FILE, [{"run": "round-01", "jobId": "j1", "state": "running"}])
        studio.record_round_outcome({"id": "j1", "step": "round", "status": "failed", "stage": 1, "stages": [{"key": "dataset", "name": "Datensatz bauen"}, {"key": "finetune", "name": "Feintuning"}]})
        entry = json.loads(studio.ROUNDS_FILE.read_text())[0]
        self.assertEqual((entry["state"], entry["failedStage"], entry["failedStageKey"]), ("failed", "Feintuning", "finetune"))
        studio.ROUNDS_FILE.unlink()


class Jobs(unittest.TestCase):
    def tearDown(self):
        studio.JOB_FILE.unlink(missing_ok=True)

    def test_zombie_driver_counts_as_dead(self):
        # Tester C, B3: a dead, unreaped driver kept the job "running" forever.
        proc = subprocess.Popen([sys.executable, "-c", "pass"])
        time.sleep(0.5)  # exited, not reaped: a zombie
        self.assertFalse(studio.pid_alive(proc.pid))
        proc.wait()

    def test_second_start_gets_409_while_one_runs(self):
        studio.write_json(studio.JOB_FILE, {"id": "x", "status": "running", "pid": os.getpid(), "started": studio.now(), "logFile": str(studio.JOBS / "x.log")})
        with self.assertRaises(studio.ApiError) as err:
            studio.start_job("claude-sheets", {})
        self.assertEqual((err.exception.code, err.exception.status), ("job_running", 409))

    def test_parallel_job_file_writes_never_collide(self):
        # Tester C, B4: writers shared one job.json.tmp and crashed on replace().
        errors: list[BaseException] = []

        def write(i: int) -> None:
            try:
                for k in range(30):
                    studio.write_json(studio.JOB_FILE, {"i": i, "k": k})
            except BaseException as e:  # noqa: BLE001
                errors.append(e)

        threads = [threading.Thread(target=write, args=(i,)) for i in range(6)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(errors, [])
        self.assertIn("i", json.loads(studio.JOB_FILE.read_text()))

    def test_failed_job_reports_its_last_message(self):
        job = {"status": "failed", "stage": 0, "stages": [{"key": "dataset", "name": "Datensatz bauen"}], "log": ["▶ Datensatz bauen", "$ python make_dataset.py", "only 0 sites fully ticked", "[exit 1]"]}
        self.assertEqual(studio.job_error(job), {"code": "stage_failed", "stage": "Datensatz bauen", "stageKey": "dataset", "message": "only 0 sites fully ticked"})

    def test_stages_and_titles_carry_stable_keys(self):
        job = studio.build_job("claude-sheets", {})
        self.assertEqual((job["titleKey"], job["titleParams"], job["title"]), ("claude_sheets", {}, "Claude-Bögen erzeugen"))
        self.assertEqual([(s["key"], s["name"]) for s in job["stages"]], [("claude_sheets", "Bögen erzeugen")])
        for key, name in studio.STAGES.items():
            self.assertTrue(name and key.isidentifier())
        for key, text in studio.TITLES.items():
            self.assertTrue(text and key.isidentifier())


def tearDownModule():
    shutil.rmtree(SANDBOX, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
