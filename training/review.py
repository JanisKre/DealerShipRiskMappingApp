"""Confirm the pre-labels with the keyboard instead of drawing boxes.

    python autolabel.py && python review.py        # unfinished sites
    python review.py --audit                       # vehicles possibly missing in finished sites
    python review.py --port 8766

Opens http://127.0.0.1:8765 in your browser (local only, nothing leaves the
machine). Per tile:

1. Questions: one box at a time, zoomed. J = car, L = large vehicle,
   N = not a vehicle, Backspace = back. Claude's answer is shown when
   claude_review.py has one.
2. Tile check: all accepted boxes on the whole tile. Click on a vehicle
   without a box to add one (oriented like its neighbours; R turns it 90 deg,
   [ and ] by 5 deg, arrows move it, L makes it a large vehicle), click on a
   wrong box to drop it. Enter = tile done, next tile.

A finished tile is written as X-AnyLabeling JSON next to the image
(data/raw/<tile>.json, marked checked), exactly what label.py produces, so
make_dataset.py and X-AnyLabeling read it unchanged. Tiles you have already
started correcting in X-AnyLabeling are left alone. In --audit mode the tool
asks only about model boxes that have no label of yours, and adds the ones
you confirm to the existing tile JSON.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from autolabel import AUTOLABEL, AUTOLABEL_AUDIT, accepted_boxes, open_questions, read_tile
from common import CLASS_NAMES, RAW, ROOT, TILE_PX, corrected_labels, site_of, tile_checked
from label import GENERATED

STEM = re.compile(r"^[A-Za-z0-9-]+__\d+_\d+$")
DECISIONS = {None, "car", "large_vehicle", "no"}
PAGE = ROOT / "review.html"
MAX_BODY = 2_000_000


# --- tile files ------------------------------------------------------------------


def started_in_xanylabeling(stem: str) -> bool:
    """True when the tool JSON exists and differs from what label.py generated: your edits."""
    path = RAW / f"{stem}.json"
    if not path.exists():
        return False
    generated = json.loads(GENERATED.read_text()) if GENERATED.exists() else {}
    return generated.get(stem) != hashlib.sha256(path.read_bytes()).hexdigest()


def direction(corners: list[list[float]]) -> float:
    (x0, y0), (x1, y1) = corners[0], corners[1]
    return math.atan2(y1 - y0, x1 - x0) % (2 * math.pi)


def shape(cls: int, corners: list[list[float]]) -> dict:
    return {
        "label": CLASS_NAMES[cls],
        "score": None,
        "points": [[float(x), float(y)] for x, y in corners],
        "group_id": None,
        "description": "",
        "difficult": False,
        "shape_type": "rotation",
        "flags": {},
        "attributes": {},
        "kie_linking": [],
        "direction": direction(corners),
    }


def write_xanylabeling(stem: str, tile: dict, audit: bool) -> None:
    """Writes the accepted boxes as X-AnyLabeling JSON, ticked as done.

    Audit: your existing shapes stay; confirmed missing vehicles are appended,
    labels you rejected are dropped, a class you changed is updated."""
    path = RAW / f"{stem}.json"
    new_shapes = [shape(b["cls"], b["corners"]) for b in accepted_boxes(tile) if b.get("origin") != "label"]
    if audit:
        data = json.loads(path.read_text())
        shapes = [s for s in data.get("shapes", []) if s.get("shape_type") == "rotation" and len(s.get("points", [])) == 4]
        others = [s for s in data.get("shapes", []) if s not in shapes]
        drop, relabel = set(), {}
        for b in tile["boxes"]:
            if b.get("origin") == "label" and b.get("decision"):
                if b["decision"] == "no":
                    drop.add(b["labelIndex"])
                else:
                    relabel[b["labelIndex"]] = b["decision"]
        kept = []
        for i, s in enumerate(shapes):  # same order as corrected_labels, so labelIndex lines up
            if i in drop:
                continue
            if i in relabel:
                s = {**s, "label": relabel[i]}
            kept.append(s)
        data["shapes"] = others + kept + new_shapes
    else:
        data = {
            "version": "4.1.0",
            "flags": {},
            "checked": True,
            "shapes": new_shapes,
            "imagePath": f"{stem}.jpg",
            "imageData": None,
            "imageHeight": TILE_PX,
            "imageWidth": TILE_PX,
            "description": "",
        }
    data["checked"] = True
    path.write_text(json.dumps(data, indent=2))


def validate_boxes(boxes: object) -> list[dict]:
    """The page sends the whole box list back; accept only well-formed boxes."""
    if not isinstance(boxes, list) or len(boxes) > 2000:
        raise ValueError("boxes must be a list")
    out = []
    for b in boxes:
        if not isinstance(b, dict):
            raise ValueError("box must be an object")
        corners = b.get("corners")
        if (
            not isinstance(corners, list)
            or len(corners) != 4
            or not all(isinstance(p, list) and len(p) == 2 and all(isinstance(v, (int, float)) and -TILE_PX <= v <= 2 * TILE_PX for v in p) for p in corners)
        ):
            raise ValueError("corners must be 4 points inside the tile")
        if b.get("cls") not in CLASS_NAMES or b.get("decision") not in DECISIONS:
            raise ValueError("bad class or decision")
        if b.get("origin") not in ("model", "manual", "label"):
            raise ValueError("bad origin")
        if b["origin"] == "label" and not (isinstance(b.get("labelIndex"), int) and b["labelIndex"] >= 0):
            raise ValueError("label box without labelIndex")
        out.append(b)
    return out


class Store:
    def __init__(self, audit: bool):
        self.audit = audit
        self.dir = AUTOLABEL_AUDIT if audit else AUTOLABEL

    def stems(self) -> list[str]:
        return sorted(p.stem for p in self.dir.glob("*.json") if STEM.match(p.stem))

    def summary(self) -> dict:
        tiles, skipped = [], []
        for stem in self.stems():
            if not self.audit and started_in_xanylabeling(stem) and not tile_checked(RAW / f"{stem}.jpg"):
                skipped.append(stem)
                continue
            tile = read_tile(self.dir / f"{stem}.json")
            tiles.append({"stem": stem, "site": site_of(Path(stem)), "questions": len(open_questions(tile)), "done": bool(tile.get("done"))})
        return {"mode": "audit" if self.audit else "label", "tiles": tiles, "skipped": skipped, "classes": CLASS_NAMES}

    def tile(self, stem: str) -> dict:
        tile = read_tile(self.dir / f"{stem}.json")
        if self.audit:
            asked = {b["labelIndex"] for b in tile["boxes"] if b.get("origin") == "label"}
            tile["existing"] = [
                {"cls": c, "corners": [list(p) for p in pts]}
                for i, (c, pts) in enumerate(corrected_labels(RAW / f"{stem}.jpg"))
                if i not in asked
            ]
        return tile

    def save(self, stem: str, boxes: list[dict], done: bool) -> None:
        path = self.dir / f"{stem}.json"
        tile = read_tile(path)
        if tile.get("done") and self.audit:
            raise ValueError("audit tile already merged")
        for i, b in enumerate(boxes):
            b["id"] = i
            b.setdefault("bucket", "manual" if b["origin"] == "manual" else "check")
            if b["origin"] == "manual":
                b.setdefault("score", 1.0)
                b.setdefault("votes", 0)
        tile["boxes"] = boxes
        tile["done"] = done
        path.write_text(json.dumps(tile, indent=1))
        if done:
            write_xanylabeling(stem, tile, self.audit)


# --- HTTP ------------------------------------------------------------------------


def make_handler(store: Store, port: int):
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

        def stem_from(self, prefix: str) -> str | None:
            stem = self.path[len(prefix) :].split("?", 1)[0]
            return stem if STEM.match(stem) and (store.dir / f"{stem}.json").exists() else None

        def do_GET(self) -> None:  # noqa: N802
            if not self.guard():
                return
            if self.path == "/":
                self.send(200, PAGE.read_bytes(), "text/html; charset=utf-8")
            elif self.path == "/api/state":
                self.json(store.summary())
            elif self.path.startswith("/api/tile/") and (stem := self.stem_from("/api/tile/")):
                self.json(store.tile(stem))
            elif self.path.startswith("/img/") and (stem := self.stem_from("/img/")):
                self.send(200, (RAW / f"{stem}.jpg").read_bytes(), "image/jpeg")
            else:
                self.send(HTTPStatus.NOT_FOUND, b"not found", "text/plain")

        def do_POST(self) -> None:  # noqa: N802
            if not self.guard():
                return
            stem = self.stem_from("/api/tile/") if self.path.startswith("/api/tile/") else None
            length = int(self.headers.get("Content-Length") or 0)
            if stem is None or self.headers.get("Content-Type") != "application/json" or not 0 < length <= MAX_BODY:
                self.send(HTTPStatus.BAD_REQUEST, b"bad request", "text/plain")
                return
            try:
                body = json.loads(self.rfile.read(length))
                store.save(stem, validate_boxes(body.get("boxes")), bool(body.get("done")))
            except (ValueError, json.JSONDecodeError) as err:
                self.json({"error": str(err)}, HTTPStatus.BAD_REQUEST)
                return
            self.json({"ok": True})

    return Handler


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--audit", action="store_true", help="review data/autolabel-audit (autolabel.py --audit)")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()

    store = Store(args.audit)
    if not store.stems():
        raise SystemExit(f"no tiles in {store.dir} — run autolabel.py{' --audit' if args.audit else ''} first")
    summary = store.summary()
    if summary["skipped"]:
        print(f"{len(summary['skipped'])} tiles left out: already being corrected in X-AnyLabeling")
    open_q = sum(t["questions"] for t in summary["tiles"] if not t["done"])
    print(f"{len(summary['tiles'])} tiles, {open_q} open questions")
    url = f"http://127.0.0.1:{args.port}/"
    server = HTTPServer(("127.0.0.1", args.port), make_handler(store, args.port))
    print(f"review at {url} — Ctrl+C to stop")
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
