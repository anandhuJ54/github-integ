# surface-api

The FastAPI backend: one app, one folder per Surface (`<name>/src`, imported as `surfaces.<name>`),
shared runtime in `_base/`, app shell in `app/`. Rules: root [`AGENTS.md`](../AGENTS.md).
How to work in it: [`docs/DEVELOPER_GUIDE.md`](docs/DEVELOPER_GUIDE.md).

First time in the repo: run `./setup.sh` from the root (installs both apps, creates the `.env` files;
`./setup.sh --check` also runs the tests).

```bash
cd surface-api
uv sync                                       # once, and after pulling
uv run --env-file .env uvicorn app:app --reload --port 8000   # every Surface
uv run pytest                                 # or: uv run pytest <surface>
uv run ruff check .
uv run python -m app.contracts <surface>      # refresh contracts/<surface>/openapi.json
uv run alembic upgrade heads --sql            # review pending migrations (applying is a human step)
```
