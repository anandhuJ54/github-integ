"""Migration runner for the one shared database.

One Postgres ⇒ one linear history, in `migrations/NNNN_*.sql` with a single
`meta/_journal.json`. This applies pending files in order and records them. It is a
*helper*, not an auto-deploy: per AGENTS.md §4 the real apply is human-approved
(snapshot `zz_backup_*` → apply → verify by JOIN → log in docs/ETL-Enhancements.md).

Named `migrate.py` (not `migrations.py`) so it doesn't clash with the `migrations/` dir
on `import migrate`. Usage (from repo root):

    uv run python -m migrate status
    uv run python -m migrate apply
"""
from __future__ import annotations

import sys
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parent / "migrations"
APPLIED_TABLE = "schema_migrations"


def _pending(conn) -> list[Path]:
    files = sorted(MIGRATIONS.glob("[0-9][0-9][0-9][0-9]_*.sql"))
    with conn.cursor() as cur:
        cur.execute(
            f"create table if not exists {APPLIED_TABLE} "
            "(tag text primary key, applied_at timestamptz default now())"
        )
        conn.commit()
        cur.execute(f"select tag from {APPLIED_TABLE}")
        applied = {r[0] for r in cur.fetchall()}
    return [f for f in files if f.stem not in applied]


def status() -> None:
    from _base.db.session import connection

    with connection() as conn:
        pending = _pending(conn)
    if not pending:
        print("up to date — no pending migrations")
        return
    print(f"{len(pending)} pending:")
    for f in pending:
        print(f"  {f.name}")


def apply() -> None:
    from _base.db.session import connection

    with connection() as conn:
        for f in _pending(conn):
            print(f"applying {f.name} ...")
            with conn.cursor() as cur:
                cur.execute(f.read_text())
                cur.execute(f"insert into {APPLIED_TABLE} (tag) values (%s)", (f.stem,))
            conn.commit()
    print("done")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    {"status": status, "apply": apply}.get(cmd, status)()
