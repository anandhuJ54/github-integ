# surface-api

The FastAPI backend: one app, one folder per Surface (`<name>/src`, imported as `surfaces.<name>`),
shared runtime in `_base/`, app shell in `app/`. Rules: root [`AGENTS.md`](../AGENTS.md).
How to work in it: [`docs/DEVELOPER_GUIDE.md`](docs/DEVELOPER_GUIDE.md).

```bash
cd surface-api
uv sync                                       # once, and after pulling
uv run uvicorn app:app --reload --port 8000   # every Surface
uv run pytest                                 # or: uv run pytest <surface>
uv run ruff check .
uv run python -m app.contracts <surface>      # refresh contracts/<surface>/openapi.json
uv run alembic upgrade heads --sql            # review pending migrations (applying is a human step)
```
