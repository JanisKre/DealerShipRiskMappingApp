#!/usr/bin/env bash
# One-step start for the training studio, also on a fresh clone.
#
#   training/start_studio.sh                 # set up what is missing, then open http://127.0.0.1:8770
#   training/start_studio.sh --port 8771     # any studio.py option is passed through
#   training/start_studio.sh --check         # only report what is missing, change nothing
#
# It creates training/.venv (Python 3.11 or 3.12), installs requirements.txt
# when it changed, runs `npm ci` in desktop-app/ when node_modules is missing,
# rebuilds the studio UI when its sources are newer than the build, and then
# starts studio.py. Set TRAINING_DATA_DIR / TRAINING_APP_MODELS_DIR to work in
# a sandbox instead of training/data and the app's model folder.
set -euo pipefail

TRAINING="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$TRAINING/../desktop-app"
VENV="$TRAINING/.venv"
CHECK_ONLY=0
if [[ "${1:-}" == "--check" ]]; then
  CHECK_ONLY=1
  shift
fi

say() { printf '\033[1m▸ %s\033[0m\n' "$*"; }
missing=()

find_python() {
  for candidate in python3.12 python3.11; do
    if command -v "$candidate" >/dev/null 2>&1; then
      echo "$candidate"
      return
    fi
  done
  if command -v python3 >/dev/null 2>&1 && python3 -c 'import sys; sys.exit(0 if (3, 11) <= sys.version_info[:2] <= (3, 12) else 1)'; then
    echo python3
  fi
}

# --- Python environment ------------------------------------------------------
req_hash="$(shasum "$TRAINING/requirements.txt" | cut -d' ' -f1)"
if [[ ! -x "$VENV/bin/python" ]]; then
  missing+=("Python venv (training/.venv)")
elif [[ "$(cat "$VENV/.requirements-hash" 2>/dev/null)" != "$req_hash" ]]; then
  missing+=("Python packages (requirements.txt changed or never installed)")
fi

# --- Node / studio UI ----------------------------------------------------------
if ! command -v npm >/dev/null 2>&1; then
  echo "npm is not installed. Install Node.js 22 (see desktop-app/package.json engines) and run this again." >&2
  exit 1
fi
[[ -d "$APP/node_modules" ]] || missing+=("desktop-app/node_modules (npm ci)")
needs_build=0
if [[ ! -f "$TRAINING/studio-dist/index.html" ]]; then
  needs_build=1
elif [[ -n "$(find "$APP/src/studio" "$APP/vite.studio.config.ts" -newer "$TRAINING/studio-dist/index.html" -type f -print -quit)" ]]; then
  needs_build=1
fi
[[ $needs_build == 1 ]] && missing+=("studio UI build (training/studio-dist)")

if [[ $CHECK_ONLY == 1 ]]; then
  if [[ ${#missing[@]} == 0 ]]; then
    echo "Everything is set up. Start with: training/start_studio.sh"
  else
    printf 'Missing:\n'
    printf '  - %s\n' "${missing[@]}"
  fi
  [[ -d "${TRAINING_DATA_DIR:-$TRAINING/data}/raw" ]] || echo "No tiles yet: see 'Your own data' in training/README.md."
  exit 0
fi

if [[ ! -x "$VENV/bin/python" ]]; then
  PY="$(find_python)"
  if [[ -z "$PY" ]]; then
    echo "Python 3.11 or 3.12 is required (PyTorch/Ultralytics). Install it, e.g. 'brew install python@3.12'." >&2
    exit 1
  fi
  say "Creating training/.venv with $PY"
  "$PY" -m venv "$VENV"
fi
if [[ "$(cat "$VENV/.requirements-hash" 2>/dev/null)" != "$req_hash" ]]; then
  say "Installing Python packages (first time takes a few minutes)"
  "$VENV/bin/pip" install --upgrade pip >/dev/null
  "$VENV/bin/pip" install -r "$TRAINING/requirements.txt"
  echo "$req_hash" >"$VENV/.requirements-hash"
fi
if [[ ! -d "$APP/node_modules" ]]; then
  say "Installing Node packages (npm ci)"
  (cd "$APP" && npm ci)
fi
if [[ $needs_build == 1 ]]; then
  say "Building the studio UI"
  (cd "$APP" && npm run build:studio)
fi

say "Starting the training studio"
cd "$TRAINING"
exec "$VENV/bin/python" studio.py "$@"
