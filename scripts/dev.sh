#!/usr/bin/env bash
# Run backend (FastAPI) + frontend (Vite) together for local dev.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# backend
( cd "$ROOT" && uv run uvicorn surface_api.app:app --reload --port 8000 ) &
BACK=$!
trap 'kill $BACK 2>/dev/null || true' EXIT

# frontend (Vite proxies /api -> :8000)
( cd "$ROOT" && bun install >/dev/null 2>&1 || true )
bun --cwd "$ROOT/surface-ui/sales" dev
