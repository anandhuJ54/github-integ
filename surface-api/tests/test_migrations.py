"""Migrations per Surface (alembic.ini): every revision sits in its owner's folder, on its owner's
branch; each branch has one head and starts from the `_base` baseline; the old SQL stream is closed."""
from __future__ import annotations

import importlib.util
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

from app.surfaces import ROOT, SURFACES

BASE = "_base"
OWNERS = (BASE, *SURFACES)
BASELINE = "866c5f655041"


def _scripts() -> ScriptDirectory:
    return ScriptDirectory.from_config(Config(str(ROOT / "alembic.ini")))


def _owner(path: str) -> str:
    """`<owner>/db/migrations/<file>.py` -> owner."""
    return Path(path).resolve().relative_to(ROOT).parts[0]


def _root_of(scripts: ScriptDirectory, rev):
    while rev.down_revision is not None:
        assert isinstance(rev.down_revision, str), f"{rev.revision}: merges across branches"
        rev = scripts.get_revision(rev.down_revision)
    return rev


def test_every_owner_has_a_version_folder():
    locations = [Path(p).resolve() for p in _scripts().version_locations]
    assert locations == [ROOT / o / "db" / "migrations" for o in OWNERS]
    assert all(p.is_dir() for p in locations)


def test_every_revision_is_on_its_folders_branch():
    scripts = _scripts()
    wrong = []
    for rev in scripts.walk_revisions():
        owner = _owner(rev.path)
        root = _root_of(scripts, rev)
        if set(root.branch_labels) != {owner} or _owner(root.path) != owner:
            wrong.append(f"{rev.path}: branch {sorted(root.branch_labels)} != folder {owner}")
    assert wrong == []


def test_one_head_per_branch():
    scripts = _scripts()
    owners = [_owner(scripts.get_revision(h).path) for h in scripts.get_heads()]
    assert len(owners) == len(set(owners)), owners


def test_surface_branches_start_from_the_base_baseline():
    scripts = _scripts()
    loose = []
    for rev in scripts.walk_revisions():
        if rev.down_revision is None and _owner(rev.path) != BASE:
            deps = rev.dependencies or ()
            deps = (deps,) if isinstance(deps, str) else tuple(deps)
            if BASELINE not in deps and f"{BASE}@head" not in deps:
                loose.append(rev.path)
    assert loose == []


def test_the_sql_stream_is_closed():
    """No new files in migrations/: the baseline froze the list it requires to be applied."""
    path = ROOT / BASE / "db" / "migrations" / f"{BASELINE}_base_baseline.py"
    spec = importlib.util.spec_from_file_location("base_baseline", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    on_disk = tuple(sorted(p.stem for p in (ROOT / "migrations").glob("*.sql")))
    assert on_disk == module.SQL_STREAM
