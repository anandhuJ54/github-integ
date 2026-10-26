"""App shell (shared core). Run from inside surface-api/:

    uv run uvicorn app:app --reload

`app/main.py` builds the app; `app/routes.py` lists the Surface routers it mounts.
"""
from app.main import app

__all__ = ["app"]
