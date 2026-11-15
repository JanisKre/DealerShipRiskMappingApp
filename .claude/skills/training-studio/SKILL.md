---
name: training-studio
description: Start the vehicle-detector training studio (labelling, training rounds, model install) and get a fresh clone ready for fine-tuning. Use when someone says "start the training studio", "starte das Trainingsstudio", "lance le studio d'entraînement", or wants to label tiles or fine-tune the detector.
---

# Training studio

The studio is a local web page served by `training/studio.py` on
`http://127.0.0.1:8770`. Its UI is built from `desktop-app/src/studio` into
`training/studio-dist/`. It runs on macOS (Apple silicon, MPS); training on
other systems needs `--device cpu` and is slow.

## Start it

1. Run `training/start_studio.sh --check` and tell the user what is missing
   (venv, Python packages, `node_modules`, the UI build, data).
2. Run `training/start_studio.sh --no-browser` **in the background**. It creates
   `training/.venv` (Python 3.11/3.12), installs `requirements.txt`, runs
   `npm ci` and `npm run build:studio` when needed, and then starts the
   server. The first run downloads PyTorch and takes several minutes.
3. Wait for the line `training studio at http://127.0.0.1:8770/`, then open
   that URL for the user (built-in browser or `open http://127.0.0.1:8770`).
   If the port is taken, pass `--port 8771`.
4. The language switch (Deutsch / English / Français) is in the studio's
   navbar; the choice is remembered in the browser.

Stopping the server (Ctrl+C or killing the process) does not stop a
running training job; jobs run detached and log to `data/studio/`.

## No data yet (fresh clone)

Imagery and labels are never committed (they reveal dealership locations), so
a clone starts with an empty `training/data/`. Get to the first labels:

1. Dealer list: download a sample from the public repo
   `JanisKre/dealership_dataset`, e.g. `data/car_dealerships_germany_100.csv`
   (OSM, ODbL). Ask before downloading.
2. The studio's **Übersicht** then shows the setup steps one at a time
   ("Einrichten"): upload the CSV (**Standortliste anlegen**, runs
   `select_sites.py`), **Kacheln laden** (`fetch_tiles.py`, open state
   orthophotos), **Startgewichte laden** (`yolo11s-obb.pt`, about 20 MB from
   Ultralytics' GitHub; ask first, it is the only step that goes online) and
   **Erste Vorschläge berechnen** (`autolabel.py --dota`, fills the Labeln
   queue). Command-line equivalents are in training/README.md, "Your own data".
3. Label in the **Labeln** tab, finish whole sites, then build the dataset
   and start the first full training in the **Training** tab (at least 5
   finished sites). Later rounds use "Speichern & neu trainieren".

## Rules

- Never commit anything under `training/data`, `runs`, `export`, weights or
  `studio-dist` (all git-ignored).
- `Installieren` replaces the app's model in
  `~/Library/Application Support/Dealership Risk Mapping/models` (with a
  backup). Confirm with the user before installing.
- To try the studio without touching real labels, start it with
  `TRAINING_DATA_DIR=<copy of data>` and `TRAINING_APP_MODELS_DIR=<scratch dir>`.
  runs/, export/ and dataset.yaml then live in the data copy too; shipping a
  release and reading the real app database are refused in that mode.
- A training round takes about 25 minutes on a MacBook Air M4; tell the user
  before starting one.
- UI texts live in `desktop-app/src/studio/locales/{de,en,fr}.json`; add a key
  to all three when changing the UI, then rebuild with `npm run build:studio`.
  A new refusal code, stage or job title in `studio.py` (`MESSAGES`, `STAGES`,
  `TITLES`) needs its key under `server.`, `jobs.stage.` or `jobs.title.`;
  `src/studio/locales/locales.test.ts` fails otherwise.
