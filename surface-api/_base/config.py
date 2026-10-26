"""Centralised runtime configuration for the shared backend.

One place where every base-level scaling knob is read from the environment, validated,
and given a safe default. Keeping these here (not scattered `os.environ[...]` reads) means a
deployable service's capacity is tuned by environment, and a bad value fails loudly at boot
rather than mid-request.

Secrets are deliberately NOT read here — `DATABASE_URL` / `SUPABASE_JWT_SECRET` stay lazy in
`db.py` / `auth.py` so the app still imports and runs without them until a DB/authed route is
hit. This module holds only non-secret tuning values, so `get_settings()` is safe to call at
startup.

Pool sizing is **per worker process**. Total connections to Postgres are
`replicas × workers × db_pool_max`, which must stay under the database's connection cap
(Supabase direct-connection limits are low — prefer the transaction pooler on :6543). The
HTTP threadpool is pinned to `db_pool_max` so the number of concurrent sync requests touching
the DB on one worker can never exceed the connections that worker can lease.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer, got {raw!r}") from exc


def _float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return float(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be a number, got {raw!r}") from exc


def _csv(name: str, default: list[str]) -> list[str]:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return list(default)
    return [item.strip() for item in raw.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    """Validated, environment-driven runtime settings (non-secret)."""

    # --- DB connection pool (per worker process) -------------------------
    db_pool_min: int = 1
    db_pool_max: int = 10
    db_pool_timeout: float = 10.0  # seconds a lease waits for a free connection
    db_pool_max_idle: float = 300.0  # seconds before an idle connection is reaped

    # --- HTTP server -----------------------------------------------------
    # Sync routes run in Starlette's threadpool; pin it to db_pool_max so concurrent
    # DB-touching requests on a worker can't exceed its leasable connections.
    http_threadpool: int = 0  # 0 → derive from db_pool_max at startup

    # --- Public site -----------------------------------------------------
    # The public site's address (e.g. https://experience.com). robots.txt and the sitemap list
    # URLs on this origin; unset, they use the address the request came in on.
    site_origin: str = ""

    # --- CORS ------------------------------------------------------------
    cors_origins: list[str] = field(default_factory=lambda: ["*"])
    # The wildcard + credentials combination is rejected by browsers, so credentials are
    # only enabled when an explicit origin allowlist is configured (see effective_cors()).

    def effective_threadpool(self) -> int:
        return self.http_threadpool if self.http_threadpool > 0 else self.db_pool_max

    def effective_cors(self) -> tuple[list[str], bool]:
        """Return (origins, allow_credentials), forcing the valid wildcard combination.

        `allow_origins=["*"]` with `allow_credentials=True` is invalid per the CORS spec, so
        credentials are enabled only when a concrete origin allowlist is set.
        """
        if self.cors_origins == ["*"]:
            return ["*"], False
        return self.cors_origins, True

    def validate(self) -> Settings:
        if self.db_pool_min < 0:
            raise ValueError("DB_POOL_MIN must be >= 0")
        if self.db_pool_max < 1:
            raise ValueError("DB_POOL_MAX must be >= 1")
        if self.db_pool_min > self.db_pool_max:
            raise ValueError("DB_POOL_MIN must be <= DB_POOL_MAX")
        if self.db_pool_timeout <= 0:
            raise ValueError("DB_POOL_TIMEOUT must be > 0")
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Read, validate and cache settings from the environment.

    Cached so repeated access is free and the resolved configuration is stable for the life
    of the process. Tests that manipulate env should call `get_settings.cache_clear()`.
    """
    return Settings(
        db_pool_min=_int("DB_POOL_MIN", 1),
        db_pool_max=_int("DB_POOL_MAX", 10),
        db_pool_timeout=_float("DB_POOL_TIMEOUT", 10.0),
        db_pool_max_idle=_float("DB_POOL_MAX_IDLE", 300.0),
        http_threadpool=_int("HTTP_THREADPOOL", 0),
        cors_origins=_csv("CORS_ALLOW_ORIGINS", ["*"]),
        site_origin=(os.environ.get("SITE_ORIGIN") or "").strip().rstrip("/"),
    ).validate()
