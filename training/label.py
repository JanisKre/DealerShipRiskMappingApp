"""Open X-AnyLabeling with the suggestions already loaded — you only correct.

    python label.py            # unfinished sites whose suggestions are good
    python label.py --all      # every unfinished site
    python label.py --status   # progress only, no window

On each start the machine suggestions (data/labels/*.txt) are converted with
X-AnyLabeling's own converter into its JSON next to each tile
(data/raw/*.json). A JSON you have edited is never replaced; one that is still
exactly as generated is refreshed when the suggestions change, e.g. after
re-labelling with your own model in round 2.

In the tool: fix the boxes of a tile, mark it checked (⌘⌥K on macOS — the
circle in the file list turns green), next tile with D. A site counts as done when all its tiles are
ticked. make_dataset.py reads the corrections directly, no export needed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import statistics
import subprocess
from collections import defaultdict

from common import (
    DATA,
    RAW,
    ROOT,
    SUGGESTIONS,
    XANYLABELING,
    label_path,
    reviewed_sites,
    site_of,
    tile_checked,
    tiles_by_site,
    write_classes_file,
    xanylabeling_convert,
)

WORK_DIR = DATA / ".xanylabeling"
STAGING = DATA / ".staging"
GENERATED = DATA / ".generated.json"  # stem → sha256 of the JSON label.py wrote
# A state whose sites get fewer suggestions than this (median) is left for
# round 2: the DOTA model barely works on that imagery, so correcting would
# mean drawing almost everything by hand.
WEAK_MEDIAN = 80


def sha(path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def sync_suggestions() -> tuple[int, int]:
    """Writes tool JSON for new tiles and refreshes untouched ones; returns (new, refreshed)."""
    write_classes_file(SUGGESTIONS)
    shutil.rmtree(STAGING, ignore_errors=True)
    xanylabeling_convert("yolo2xlabel", SUGGESTIONS, STAGING)
    generated = json.loads(GENERATED.read_text()) if GENERATED.exists() else {}
    new = refreshed = 0
    for staged in STAGING.glob("*.json"):
        target = RAW / staged.name
        if target.exists():
            untouched = generated.get(staged.stem) == sha(target)
            if not untouched or staged.read_bytes() == target.read_bytes():
                continue  # your edits, or nothing new
            refreshed += 1
        else:
            new += 1
        shutil.copy2(staged, target)
        generated[staged.stem] = sha(target)
    GENERATED.write_text(json.dumps(generated))
    shutil.rmtree(STAGING, ignore_errors=True)
    return new, refreshed


def suggestion_count(site_tiles) -> int:
    return sum(
        sum(1 for line in label_path(t).read_text().splitlines() if line.strip())
        for t in site_tiles
        if label_path(t).exists()
    )


def weak_states(sites: dict) -> set[str]:
    per_state = defaultdict(list)
    for site, tiles in sites.items():
        per_state[site.split("-", 1)[0]].append(suggestion_count(tiles))
    return {state for state, counts in per_state.items() if statistics.median(counts) < WEAK_MEDIAN}


def write_session_config(todo: list[str]):
    """Our settings plus a file-list filter that shows only the tiles of
    unfinished sites. The tool matches the filter against the full path,
    so it is anchored on the last "/"."""
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    session = WORK_DIR / "session.yaml"
    pattern = "|".join(todo)
    session.write_text((ROOT / "labeling.yaml").read_text() + f"file_search: '</({pattern})__[0-9]+_[0-9]+\\.jpg$>'\n")
    return session


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--all", action="store_true", help="include sites with weak suggestions")
    ap.add_argument("--status", action="store_true", help="show progress, don't open the tool")
    args = ap.parse_args()

    sites = tiles_by_site()
    if not sites:
        raise SystemExit("no tiles in data/raw — run fetch_tiles.py first")
    if not any(label_path(t).exists() for tiles in sites.values() for t in tiles):
        raise SystemExit("no suggestions in data/labels — run prelabel.py first")

    if not args.status:
        new, refreshed = sync_suggestions()
        if new or refreshed:
            print(f"suggestions loaded: {new} new tiles, {refreshed} refreshed")

    done = reviewed_sites()
    weak = set() if args.all else weak_states(sites)
    todo = sorted(s for s in sites if s not in done and s.split("-", 1)[0] not in weak)
    later = sorted(s for s in sites if s not in done and s.split("-", 1)[0] in weak)
    ticked = sum(tile_checked(t) for tiles in sites.values() for t in tiles)
    n_tiles = sum(len(t) for t in sites.values())

    print(f"done: {len(done)}/{len(sites)} sites ({ticked}/{n_tiles} tiles ticked)")
    if later:
        print(f"round 2, not shown ({', '.join(sorted(weak))}: weak suggestions): {len(later)} sites")
    if not todo:
        if later:
            print("round 1 complete → train, re-label with your model, then run label.py again (README: 'Two rounds')")
        else:
            print("all sites done → python make_dataset.py && caffeinate -i python train.py")
        return
    print(f"to correct now: {len(todo)} sites, starting with {todo[0]}")
    if args.status:
        return
    if not XANYLABELING.exists():
        raise SystemExit(f"X-AnyLabeling missing — see README setup ({XANYLABELING})")

    session = write_session_config(todo)
    print("opening X-AnyLabeling — press D once to show the first tile, ⌘⌥K marks a tile done; close the window when you're done")
    subprocess.run(
        [str(XANYLABELING), "--work-dir", str(WORK_DIR), "--config", str(session),
         "--filename", str(RAW), "--no-auto-update-check", "--logger-level", "warning"],
        check=False,
    )
    done_after = reviewed_sites()
    print(f"\nsession finished: {len(done_after - done)} sites completed, {len(done_after)}/{len(sites)} done in total")


if __name__ == "__main__":
    main()
