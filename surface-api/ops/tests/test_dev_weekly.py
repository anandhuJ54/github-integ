"""Weekly dev reporting jobs (legacy dev-weekly-* routes)."""
from __future__ import annotations

from datetime import UTC, date, datetime

import pytest

from surfaces.ops import dev_weekly as dw

MEMBERS = [
    {"id": "m1", "team_id": "t1", "name": "Ann", "role": "dev", "email": "ann@x.test"},
    {"id": "m2", "team_id": "t1", "name": "Bo", "role": "qa", "email": "nope"},
    {"id": "m3", "team_id": "t2", "name": "Cy", "role": "pm", "email": " cy@x.test "},
]
CTX = {
    "launch": {"launch_date": date(2026, 11, 2), "phase": "alpha"},
    "config": {"from_email": "reports@x.test", "due_day": None, "due_time": "10:00"},
    "teams": [{"id": "t1", "name": "Core"}, {"id": "t2", "name": "Data"}, {"id": "t3", "name": "Empty"}],
    "members": MEMBERS,
    "projects": [
        {"team_id": "t1", "priority": "P0", "progress_pct": 50},
        {"team_id": "t1", "priority": None, "progress_pct": 80},
    ],
    "updates": [
        {"member_id": "m1", "status": "submitted", "self_progress_pct": 60, "highlights": "H",
         "blockers": None, "next_week": "N"},
        {"member_id": "m3", "status": "draft", "self_progress_pct": None},
    ],
}


def test_week_start_and_round():
    assert dw.week_start_iso(datetime(2026, 10, 23, 23, tzinfo=UTC)) == "2026-10-19"
    assert dw.week_start_iso(date(2026, 10, 19)) == "2026-10-19"
    assert dw.week_start_iso(date(2026, 10, 25)) == "2026-10-19"
    assert dw.js_round(2.5) == 3 and dw.js_round(-2.5) == -2


def test_team_progress():
    # P0 weight 4 × 50 + default P2 weight 2 × 80 → 360 / 6 = 60
    assert dw.team_progress(CTX["projects"]) == 60
    assert dw.team_progress([{"priority": "P1", "progress_pct": 33}, {"priority": "P3"}]) == 24.8
    assert dw.team_progress([]) is None


def test_digest_text():
    text = dw.digest_text(CTX, "2026-10-19", now=datetime(2026, 10, 23, 12, tzinfo=UTC))
    assert text.split("\n") == [
        "SRP Alpha weekly report — week of 2026-10-19",
        "10 days to the alpha launch on 2026-11-02.",
        "1 of 3 members submitted an update.",
        "",
        "## Core — 60% · 1/2 submitted",
        "- Ann (dev) — self 60%",
        "  Highlights: H",
        "  Next week: N",
        "  Awaiting: Bo",
        "",
        "## Data — no projects · 0/1 submitted",
        "  Awaiting: Cy",
    ]


def test_send_mail_skips_without_key(monkeypatch):
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    assert dw.send_mail([], "s", "t", "f") == {"sent": False, "reason": "no_recipients", "recipients": 0}
    assert dw.send_mail(["a@x"], "s", "t", "f") == {
        "sent": False, "reason": "email_not_configured", "recipients": 1}


def test_send_mail_resend(monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "rk")
    seen = {}

    class Res:
        def __init__(self, ok):
            self.is_success = ok
            self.status_code = 200 if ok else 422
            self.text = "bad"

    def post(url, headers=None, json=None, timeout=None):
        seen.update(url=url, headers=headers, body=json)
        return Res(seen.setdefault("ok", True))

    monkeypatch.setattr(dw.httpx, "post", post)
    assert dw.send_mail(["a@x"], "S", "T", "F") == {"sent": True, "recipients": 1}
    assert seen["url"] == "https://api.resend.com/emails"
    assert seen["headers"]["Authorization"] == "Bearer rk"
    assert seen["body"] == {"from": "F", "to": ["a@x"], "subject": "S", "text": "T"}
    seen["ok"] = False
    with pytest.raises(RuntimeError, match=r"Resend failed \[422\]: bad"):
        dw.send_mail(["a@x"], "S", "T", "F")


def ctx_responder(sql, params):
    table = sql.split(" from ")[1].split()[0]
    return {
        "exp_dev_launch": [CTX["launch"]],
        "exp_dev_config": [CTX["config"]],
        "exp_dev_teams": CTX["teams"],
        "exp_dev_members": CTX["members"],
        "exp_dev_projects": CTX["projects"],
        "exp_dev_weekly_updates": CTX["updates"],
    }[table]


def test_cron_secret_required(monkeypatch, anon_client):
    monkeypatch.delenv("DEV_REPORT_CRON_SECRET", raising=False)
    res = anon_client.post("/public/dev-weekly-reminder", headers={"x-cron-secret": ""})
    assert res.status_code == 401 and res.text == "Unauthorized"
    monkeypatch.setenv("DEV_REPORT_CRON_SECRET", "s3")
    assert anon_client.post("/public/dev-weekly-digest", headers={"x-cron-secret": "no"}).status_code == 401
    assert anon_client.post("/public/dev-weekly-digest").status_code == 401


def test_reminder(monkeypatch, fake_db, anon_client):
    monkeypatch.setenv("DEV_REPORT_CRON_SECRET", "s3")
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    sent = {}
    monkeypatch.setattr(dw, "send_mail", lambda **kw: sent.update(kw) or {"sent": True, "recipients": 1})
    db = fake_db(ctx_responder)
    res = anon_client.post("/public/dev-weekly-reminder", headers={"x-cron-secret": "s3"})
    body = res.json()
    assert body["job"] == "reminder" and body["pending"] == 2 and body["sent"] is True
    assert body["week_start"] == dw.week_start_iso()
    assert sent["to"] == ["cy@x.test"] and sent["sender"] == "reports@x.test"
    assert "It is due Friday 10:00." in sent["text"]
    assert all(e[0] == "service_role" for e in db.log)
    assert db.find("exp_dev_weekly_updates")[0][3] == [dw.week_start_iso()]


def test_digest(monkeypatch, fake_db, anon_client):
    monkeypatch.setenv("DEV_REPORT_CRON_SECRET", "s3")
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    fake_db(ctx_responder)
    res = anon_client.post("/public/dev-weekly-digest", headers={"x-cron-secret": "s3"})
    assert res.json() == {"job": "digest", "week_start": dw.week_start_iso(), "sent": False,
                          "reason": "email_not_configured", "recipients": 2}


def test_status(monkeypatch, anon_client):
    monkeypatch.setenv("RESEND_API_KEY", "x")
    monkeypatch.delenv("DEV_REPORT_CRON_SECRET", raising=False)
    assert anon_client.get("/public/dev-weekly-status").json() == {
        "emailConfigured": True, "cronConfigured": False}
