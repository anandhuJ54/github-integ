#!/usr/bin/env bash
# First-time setup for this repo: installs the backend and frontend, creates the .env files.
#
#   ./setup.sh           install everything
#   ./setup.sh --check   install, then run the backend tests, lint and the UI typecheck
#
# Safe to run again: it never overwrites an existing .env and installs nothing system-wide.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK=false
[ "${1:-}" = "--check" ] && CHECK=true

step() { printf '\n==> %s\n' "$1"; }
fail() { printf '\nERROR: %s\n' "$1" >&2; exit 1; }

step "Checking tools"
command -v python3 >/dev/null || fail "python3 not found. Install Python 3.11 or newer."
python3 -c 'import sys; sys.exit(sys.version_info < (3, 11))' \
  || fail "Python 3.11 or newer is needed (found $(python3 --version 2>&1))."
command -v uv >/dev/null \
  || fail "uv not found. Install it: curl -LsSf https://astral.sh/uv/install.sh | sh"
command -v bun >/dev/null \
  || fail "bun not found. Install it: curl -fsSL https://bun.sh/install | bash"
echo "python $(python3 -c 'import platform; print(platform.python_version())'), $(uv --version), bun $(bun --version)"

step "Backend: surface-api (uv sync)"
(cd "$ROOT/surface-api" && uv sync)

step "Frontend: surface-ui (bun install)"
(cd "$ROOT/surface-ui" && bun install)

step "Env files"
for pair in "surface-api/env.example:surface-api/.env" "surface-ui/app/env.example:surface-ui/app/.env"; do
  src="$ROOT/${pair%%:*}"
  dst="$ROOT/${pair##*:}"
  if [ -f "$dst" ]; then
    echo "kept     ${pair##*:} (already there)"
  else
    cp "$src" "$dst"
    echo "created  ${pair##*:} from ${pair%%:*}: fill in the real values"
  fi
done

if $CHECK; then
  step "Checks: backend lint and tests"
  (cd "$ROOT/surface-api" && uv run ruff check . && uv run pytest -q)

  step "Checks: UI typecheck (every app)"
  (
    cd "$ROOT/surface-ui"
    for d in */; do
      [ -f "$d/tsconfig.json" ] && [ "$d" != _base/ ] || continue
      echo "tsc $d"
      bunx tsc --noEmit -p "$d"
    done
  )
fi

cat <<'EOF'

Done. Next:
  1. Fill in surface-api/.env and surface-ui/app/.env (real values from the team's secret store).
  2. Start the API:  cd surface-api && uv run --env-file .env uvicorn app:app --reload --port 8000
  3. Start the UI:   cd surface-ui/app && bun dev          (http://localhost:5173)
Guide: surface-api/docs/DEVELOPER_GUIDE.md
EOF
