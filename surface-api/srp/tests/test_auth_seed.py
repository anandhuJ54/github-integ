"""Test-password seed (srp/local-login-srp-home, task 8): sets a bcrypt digest on the mock users.

Prints counts only; never the password or a digest. The database is a recording fake.
"""
from __future__ import annotations

import os
import stat

import bcrypt
import pytest

from _base.config import get_settings
from surfaces.srp.auth import seed

PASSWORD = "mock-seed-pw-1234"
USERS = [
    {"id": 1, "email": "mock.users.1@example.test", "password_digest": "mockold1"},
    {"id": 2, "email": "mock.users.2@example.test", "password_digest": "mockold2"},
    {"id": 3, "email": "mock.users.3@example.test", "password_digest": None},
]


@pytest.fixture
def db(monkeypatch, fake_db_for):
    monkeypatch.delenv("SRP_LOCAL_SCHEMA", raising=False)
    get_settings.cache_clear()

    def responder(sql, params):
        low = " ".join(sql.lower().split())
        if low.startswith("select") and "from srp_cleanup.users" in low:
            return [dict(u) for u in USERS]
        if low.startswith("update srp_cleanup.users"):
            return []
        raise AssertionError(f"unexpected SQL: {sql}")

    recording = fake_db_for([])(responder)
    monkeypatch.setattr(seed, "connection", lambda: recording.role_connection("service"))
    yield recording
    get_settings.cache_clear()


def _updates(db):
    return db.find("update srp_cleanup.users")


def test_every_selected_user_gets_a_digest_that_verifies(db):
    report = seed.seed(PASSWORD, cost=4)
    ups = _updates(db)
    assert report.users_updated == len(USERS) == len(ups)
    for (_role, _write, _sql, params), user in zip(ups, USERS, strict=True):
        digest, user_id = params
        assert user_id == user["id"]
        assert bcrypt.checkpw(PASSWORD.encode(), digest.encode())


def test_each_user_gets_its_own_salt(db):
    seed.seed(PASSWORD, cost=4)
    digests = [p[0] for _r, _w, _s, p in _updates(db)]
    assert len(set(digests)) == len(digests)


def test_the_update_also_clears_any_lock(db):
    seed.seed(PASSWORD, cost=4)
    sql = " ".join(_updates(db)[0][2].lower().split())
    assert "failed_attempts = 0" in sql and "locked_at = null" in sql


def test_by_default_only_users_with_a_professional_seat_are_selected(db):
    seed.seed(PASSWORD, cost=4)
    sql = " ".join(db.find("select")[0][2].lower().split())
    assert "exists (select 1 from srp_cleanup.tier_agents" in sql
    assert "u.deleted_at is null" in sql and "u.deactivated_at is null" in sql


def test_all_users_mode_drops_the_seat_condition(db):
    seed.seed(PASSWORD, cost=4, only_with_seat=False)
    sql = " ".join(db.find("select")[0][2].lower().split())
    assert "tier_agents" not in sql


def test_a_dry_run_changes_nothing(db):
    report = seed.seed(PASSWORD, cost=4, dry_run=True)
    assert report.users_updated == 0 and report.users_selected == len(USERS)
    assert _updates(db) == []


def test_the_schema_comes_from_the_setting(db, monkeypatch):
    monkeypatch.setenv("SRP_LOCAL_SCHEMA", "other_schema")
    get_settings.cache_clear()
    with pytest.raises(AssertionError, match="other_schema"):  # the fake only knows srp_cleanup
        seed.seed(PASSWORD, cost=4)


# --- password rules ------------------------------------------------------------------------------


@pytest.mark.parametrize("password", ["", "short", "x" * 9, "p" * 73])
def test_a_bad_password_is_refused_before_any_database_call(db, password):
    with pytest.raises(ValueError):
        seed.seed(password, cost=4)
    assert db.log == []


def test_the_refusal_message_does_not_echo_the_password(db):
    with pytest.raises(ValueError) as e:
        seed.seed("zq9-tiny", cost=4)
    assert "zq9-tiny" not in str(e.value)


# --- backup of the previous digests ---------------------------------------------------------------


def test_a_backup_is_written_before_any_update_and_is_private(db, tmp_path):
    path = tmp_path / "digests.csv"
    seed.seed(PASSWORD, cost=4, backup_path=path)
    lines = path.read_text().splitlines()
    assert lines[0] == "id,email,password_digest"
    assert lines[1] == "1,mock.users.1@example.test,mockold1"
    assert lines[3] == "3,mock.users.3@example.test,"  # a null digest stays empty
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
    assert db.log.index(db.find("select")[0]) < db.log.index(_updates(db)[0])


def test_an_existing_backup_file_is_never_overwritten(db, tmp_path):
    path = tmp_path / "digests.csv"
    path.write_text("keep me")
    with pytest.raises(FileExistsError):
        seed.seed(PASSWORD, cost=4, backup_path=path)
    assert path.read_text() == "keep me" and _updates(db) == []


# --- command line ---------------------------------------------------------------------------------


def test_main_reads_the_password_from_the_environment_and_prints_counts_only(db, monkeypatch, capsys):
    monkeypatch.setenv("SRP_SEED_PASSWORD", PASSWORD)
    monkeypatch.setattr(seed, "_COST", 4)
    assert seed.main([]) == 0
    out = capsys.readouterr()
    text = out.out + out.err
    assert "3" in text
    assert PASSWORD not in text
    assert "$2" not in text  # no digest


def test_main_without_a_password_exits_2_and_touches_nothing(db, monkeypatch, capsys):
    monkeypatch.delenv("SRP_SEED_PASSWORD", raising=False)
    assert seed.main([]) == 2
    assert "SRP_SEED_PASSWORD" in capsys.readouterr().err
    assert db.log == []


def test_main_dry_run_and_all_flags(db, monkeypatch, capsys):
    monkeypatch.setenv("SRP_SEED_PASSWORD", PASSWORD)
    assert seed.main(["--dry-run", "--all"]) == 0
    assert _updates(db) == []
    assert "tier_agents" not in " ".join(db.find("select")[0][2].lower().split())


# --- the connection pool is closed on the way out --------------------------------------------------


@pytest.mark.parametrize("env", [PASSWORD, None], ids=["success", "refused"])
def test_main_always_closes_the_connection_pool(db, monkeypatch, env):
    closed = []
    monkeypatch.setattr(seed, "close_pools", lambda: closed.append(True))
    if env is None:
        monkeypatch.delenv("SRP_SEED_PASSWORD", raising=False)
    else:
        monkeypatch.setenv("SRP_SEED_PASSWORD", env)
    monkeypatch.setattr(seed, "_COST", 4)
    seed.main(["--dry-run"])
    assert closed == [True]
