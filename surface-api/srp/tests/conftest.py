"""srp test fixtures on top of the shared ones (surface-api/conftest.py)."""
from __future__ import annotations

import bcrypt
import pytest

# Modules whose `role_connection` the execute-style fake DB replaces.
_MODULES = ("surfaces.srp.review.router",)


def _digest(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=4)).decode()


class Store:
    """In-memory stand-in for the users and tier_agents tables."""

    SECRET = "L" * 32
    PASSWORD = "correct horse battery"
    WRONG = "not the password"
    USER_ID = 7
    SEAT_ID = 42

    def __init__(self, **over):
        self.user = {
            "id": self.USER_ID,
            "email": "mock.users.7@example.test",
            "first_name": "Riley",
            "last_name": "Okafor",
            "password_digest": _digest(self.PASSWORD),
            "failed_attempts": 0,
            "is_locked": False,  # computed by the database from locked_at in the real query
            "locked_at": None,
            "deleted_at": None,
            "deactivated_at": None,
            "is_manual_deactivated": False,
            **over,
        }
        self.seat: int | None = self.SEAT_ID
        self.misses: list[tuple] = []
        self.resets = 0
        self.logins = 0
        self.lookups: list[object] = []

    def responder(self, sql: str, params):
        low = " ".join(sql.lower().split())
        if "from srp_cleanup.users" in low and "where lower(email) = %s" in low:
            self.lookups.append(params)
            email = params[0] if isinstance(params, (tuple, list)) else params
            return [self.user] if self.user and email == self.user["email"].lower() else []
        if "from srp_cleanup.users" in low and "where id = %s" in low:
            return [self.user] if self.user and params[0] == self.user["id"] else []
        if "from srp_cleanup.tier_agents" in low:
            return [{"id": self.seat}] if self.seat is not None else []
        if low.startswith("update srp_cleanup.users") and "set failed_attempts = case" in low:
            # the service's one-statement count-and-lock, mirrored: skipped while locked, a lapsed lock
            # restarts the count, five misses lock
            limit, _uid = params
            if self.user["is_locked"]:
                return []
            lapsed = self.user["locked_at"] is not None
            count = 1 if lapsed else int(self.user["failed_attempts"] or 0) + 1
            lock_now = count >= limit
            self.misses.append((count, lock_now))
            self.user["failed_attempts"] = count
            self.user["is_locked"] = bool(lock_now)
            self.user["locked_at"] = "now" if lock_now else None
            return [{"failed_attempts": count}]
        if low.startswith("update srp_cleanup.users") and "last_login_at" in low:
            self.logins += 1
            self.user.update(failed_attempts=0, is_locked=False)
            return []
        if low.startswith("update srp_cleanup.users") and "set failed_attempts = 0" in low:
            self.resets += 1
            self.user.update(failed_attempts=0, is_locked=False)
            return []
        raise AssertionError(f"unexpected SQL: {sql}")


@pytest.fixture
def fake_db(fake_db_for):
    return fake_db_for(_MODULES)


@pytest.fixture
def client(surface_client):
    return surface_client("srp")


@pytest.fixture
def anon_client(surface_client):
    return surface_client("srp", signed_in=False)


@pytest.fixture
def store(monkeypatch, fake_db_for):
    """Local sign-in on, with a fake `srp_cleanup` behind `surfaces.srp.auth.services.connection`."""
    from _base.config import get_settings
    from surfaces.srp.auth import services

    monkeypatch.setenv("LOCAL_AUTH_ENABLED", "1")
    monkeypatch.setenv("LOCAL_AUTH_JWT_SECRET", Store.SECRET)
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    get_settings.cache_clear()
    s = Store()
    db = fake_db_for([])(s.responder)
    monkeypatch.setattr(services, "connection", lambda: db.role_connection("service"))
    s.db = db
    yield s
    get_settings.cache_clear()
