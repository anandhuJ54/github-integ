"""Set a known test password on the mock users in `<schema>.users` (default `srp_cleanup`).

    SRP_SEED_PASSWORD='...' uv run python -m surfaces.srp.auth.seed [--all] [--dry-run] [--backup-to FILE]

The password comes only from the environment variable SRP_SEED_PASSWORD (10 to 72 bytes), never an
argument, a file in the repo or a log line. Output is counts only: no password, no digest. Each user gets
its own bcrypt salt. By default only active users that have a professional seat are changed, since those
are the ones that can sign in; `--all` changes every active user. `--backup-to FILE` first writes the
previous (id, email, password_digest) to a new private file (never overwrites an existing one).

Local data only: it connects with DATABASE_URL like the API does, so point that at the local database.
One transaction; a failure leaves every digest as it was.
"""
from __future__ import annotations

import argparse
import csv
import os
import sys
from dataclasses import dataclass
from pathlib import Path

import bcrypt

from _base.config import get_settings
from _base.db.session import close_pools, connection  # tests replace these names

_COST = 12
_MIN_PASSWORD = 10
_MAX_PASSWORD_BYTES = 72  # what bcrypt reads


@dataclass(frozen=True)
class SeedReport:
    schema: str
    users_selected: int
    users_updated: int


def _check_password(password: str) -> None:
    if len(password) < _MIN_PASSWORD or len(password.encode()) > _MAX_PASSWORD_BYTES:
        raise ValueError(
            f"the seed password must be at least {_MIN_PASSWORD} characters and at most "
            f"{_MAX_PASSWORD_BYTES} bytes"
        )


def _write_backup(path: Path, rows: list[dict]) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)  # FileExistsError if it exists
    with os.fdopen(fd, "w", newline="") as handle:
        out = csv.writer(handle)
        out.writerow(["id", "email", "password_digest"])
        for row in rows:
            out.writerow([row["id"], row["email"], row["password_digest"] or ""])


def seed(
    password: str,
    *,
    cost: int | None = None,
    only_with_seat: bool = True,
    dry_run: bool = False,
    backup_path: Path | None = None,
) -> SeedReport:
    _check_password(password)
    schema = get_settings().srp_local_schema  # already checked as a plain schema name
    seat = (
        f" and exists (select 1 from {schema}.tier_agents ta"
        f" where ta.user_id = u.id and ta.deleted_at is null)"
        if only_with_seat
        else ""
    )
    with connection() as conn:
        rows = conn.execute(
            f"""select u.id, u.email, u.password_digest from {schema}.users u
                where u.deleted_at is null and u.deactivated_at is null
                  and not coalesce(u.is_manual_deactivated, false){seat}
                order by u.id"""
        ).fetchall()
        if dry_run:
            return SeedReport(schema, len(rows), 0)
        if backup_path is not None:
            _write_backup(Path(backup_path), rows)
        rounds = _COST if cost is None else cost
        for row in rows:
            digest = bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=rounds)).decode()
            conn.execute(
                f"update {schema}.users set password_digest = %s, failed_attempts = 0, "
                f"locked_at = null where id = %s",
                (digest, row["id"]),
            )
    return SeedReport(schema, len(rows), len(rows))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m surfaces.srp.auth.seed", description=__doc__.splitlines()[0])
    parser.add_argument("--all", action="store_true", help="every active user, not only those with a seat")
    parser.add_argument("--dry-run", action="store_true", help="count the users, change nothing")
    parser.add_argument("--backup-to", metavar="FILE", help="write the previous digests to a new private file")
    args = parser.parse_args(argv)

    try:
        password = os.environ.get("SRP_SEED_PASSWORD")
        if not password:
            print("SRP_SEED_PASSWORD is not set; nothing was changed", file=sys.stderr)
            return 2
        try:
            report = seed(
                password,
                cost=_COST,
                only_with_seat=not args.all,
                dry_run=args.dry_run,
                backup_path=Path(args.backup_to) if args.backup_to else None,
            )
        except ValueError as exc:  # a password rule; the message never contains the password
            print(f"{exc}; nothing was changed", file=sys.stderr)
            return 2
        except FileExistsError:
            print("the backup file already exists; nothing was changed", file=sys.stderr)
            return 2
        mode = "dry run, nothing changed" if args.dry_run else "done"
        print(f"{mode}: {report.users_selected} users selected, {report.users_updated} updated in {report.schema}.users")
        return 0
    finally:
        close_pools()  # the pool's threads must stop before the interpreter exits


if __name__ == "__main__":
    sys.exit(main())
