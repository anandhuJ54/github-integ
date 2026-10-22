#!/usr/bin/env bash
# Run backend (FastAPI) + frontend (Vite) together for local dev.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# backend — surface-api/ is a self-contained uv project; `app:app` is its top-level entry.
( cd "$ROOT/surface-api" && uv run uvicorn app:app --reload --port 8000 ) &
BACK=$!
trap 'kill $BACK 2>/dev/null || true' EXIT

# frontend — surface-ui/ is a self-contained bun workspace (Vite proxies /api -> :8000).
( cd "$ROOT/surface-ui" && bun install >/dev/null 2>&1 || true )
bun --cwd "$ROOT/surface-ui/sales" dev
