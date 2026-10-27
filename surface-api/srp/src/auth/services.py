"""Local sign-in: check a password against `<schema>.users`, find the professional behind the user.

Runs on the API's own database login (`connection()`), not as the `authenticated` role, and only
reads and writes the SRP-owned users and tier_agents tables. Everything here is deterministic.

The schema name comes from `SRP_LOCAL_SCHEMA`, which `Settings` has already checked against
`[a-z_][a-z0-9_]{0,62}`, so it is safe to put in SQL; every value goes in as a parameter.

The database work finishes (and commits) before the router turns a refusal into an HTTP error, so a
failed attempt's counter update is never rolled back by the refusal.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import bcrypt

from _base.config import get_settings
from _base.db.session import connection  # tests replace this name

_log = logging.getLogger(__name__)

MAX_FAILED_ATTEMPTS = 5
LOCK_MINUTES = 15
_MAX_BCRYPT_BYTES = 72
# A real bcrypt digest of a throw-away value, checked when no usable user exists so a refusal takes
# about as long whether or not the email is known.
_DUMMY_DIGEST = bcrypt.hashpw(b"unused-placeholder", bcrypt.gensalt(rounds=12)).decode()

INVALID = "invalid_credentials"
NO_SEAT = "no_professional_seat"


@dataclass(frozen=True)
class AuthResult:
    ok: bool
    reason: str | None = None  # INVALID | NO_SEAT when not ok
    user: dict[str, Any] | None = None
    seat_id: int | None = None

    @property
    def landing_path(self) -> str | None:
        return f"/seat/professional/{self.seat_id}" if self.seat_id is not None else None


def _schema() -> str:
    return get_settings().srp_local_schema


def _check_password(password: str, digest: str | None) -> bool:
    """bcrypt check that never raises: a bad, missing or non-bcrypt digest is simply a miss."""
    raw = password.encode()
    target = digest or _DUMMY_DIGEST
    if len(raw) > _MAX_BCRYPT_BYTES:
        bcrypt.checkpw(b"x", _DUMMY_DIGEST.encode())  # keep the timing alike
        return False
    try:
        matched = bcrypt.checkpw(raw, target.encode())
    except ValueError:  # not a bcrypt digest (the mock data's digests are random strings)
        bcrypt.checkpw(raw, _DUMMY_DIGEST.encode())  # same cost as any other refusal, or this one is faster
        return False
    return matched and digest is not None


def _is_active(user: dict[str, Any]) -> bool:
    return not (user.get("deleted_at") or user.get("deactivated_at") or user.get("is_manual_deactivated"))


def _find_seat(conn: Any, user_id: int) -> int | None:
    """The professional behind a user: the primary mapping, else the lowest tier_agents id."""
    s = _schema()
    row = conn.execute(
        f"""select ta.id
            from {s}.tier_agents ta
            left join {s}.agent_mappings am on am.tier_agent_id = ta.id
            where ta.user_id = %s and ta.deleted_at is null
            order by coalesce(am.is_primary, false) desc, ta.id asc
            limit 1""",
        (user_id,),
    ).fetchone()
    return int(row["id"]) if row else None


def authenticate(email: str, password: str) -> AuthResult:
    """Check the credentials; on a hit return the user and the seat id. Never raises for a bad login.

    Three short steps, so no database connection or row lock is held while bcrypt runs (about 0.4 s a
    check): read the user; hash-check with no connection open; then one short atomic write.
    """
    s = _schema()
    with connection() as conn:
        rows = conn.execute(
            f"""select id, email, first_name, last_name, password_digest, failed_attempts, locked_at,
                       deleted_at, deactivated_at, is_manual_deactivated,
                       (locked_at is not null
                        and locked_at > localtimestamp - interval '{LOCK_MINUTES} minutes') as is_locked
                from {s}.users
                where lower(email) = %s
                limit 2""",
            (email.strip().lower(),),
        ).fetchall()
    user = rows[0] if len(rows) == 1 else None  # two rows share an email: refuse, like unknown

    if user is None or not _is_active(user) or user["is_locked"]:
        _check_password(password, None)  # dummy check, same cost
        return AuthResult(False, INVALID)

    matched = _check_password(password, user["password_digest"])  # no connection is held here

    with connection() as conn:
        if not matched:
            # One statement does the whole count-and-lock, so concurrent misses cannot lose an update or
            # push the count past the limit: the row is locked for the statement, and a user who got
            # locked meanwhile is excluded by the WHERE. A lock that has lapsed restarts the count at 1.
            lapsed = f"locked_at is not null and locked_at <= localtimestamp - interval '{LOCK_MINUTES} minutes'"
            count = f"case when {lapsed} then 1 else coalesce(failed_attempts, 0) + 1 end"
            row = conn.execute(
                f"""update {s}.users
                    set failed_attempts = {count},
                        locked_at = case when ({count}) >= %s then localtimestamp else null end
                    where id = %s
                      and not (locked_at is not null
                               and locked_at > localtimestamp - interval '{LOCK_MINUTES} minutes')
                    returning failed_attempts""",
                (MAX_FAILED_ATTEMPTS, user["id"]),
            ).fetchone()
            _log.info("sign-in refused for user %s (miss %s)", user["id"], row["failed_attempts"] if row else "locked")
            return AuthResult(False, INVALID)

        seat_id = _find_seat(conn, user["id"])
        if seat_id is None:
            conn.execute(
                f"update {s}.users set failed_attempts = 0, locked_at = null where id = %s", (user["id"],)
            )
            return AuthResult(False, NO_SEAT)

        conn.execute(
            f"update {s}.users set failed_attempts = 0, locked_at = null, "
            f"last_login_at = localtimestamp, num_logins = coalesce(num_logins, 0) + 1 where id = %s",
            (user["id"],),
        )
        return AuthResult(True, user=_public(user), seat_id=seat_id)


def current_session(user_id: int) -> AuthResult:
    """The signed-in user's record and seat, for GET /srp/auth/me. Not ok when the user is gone,
    deactivated (INVALID: the session ends) or has no seat (NO_SEAT)."""
    s = _schema()
    with connection() as conn:
        row = conn.execute(
            f"""select id, email, first_name, last_name, deleted_at, deactivated_at, is_manual_deactivated
                from {s}.users where id = %s""",
            (user_id,),
        ).fetchone()
        if row is None or not _is_active(row):
            return AuthResult(False, INVALID)
        seat_id = _find_seat(conn, row["id"])
        if seat_id is None:
            return AuthResult(False, NO_SEAT)
        return AuthResult(True, user=_public(row), seat_id=seat_id)


def _public(user: dict[str, Any]) -> dict[str, Any]:
    """The fields that may leave the API. Never the digest."""
    return {
        "id": str(user["id"]),
        "email": user["email"],
        "first_name": user.get("first_name"),
        "last_name": user.get("last_name"),
    }
