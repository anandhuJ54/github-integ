"""Weekly reporting loop helpers (reminder + digest senders).

Port of legacy `lib/dev-weekly.server.ts`. Email is optional: without RESEND_API_KEY the send
is skipped and reported, never faked. Reads use the service role (legacy `supabaseAdmin`).
"""
from __future__ import annotations

import hmac
import logging
import math
import os
from collections.abc import Mapping
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

import httpx

from _base.db.session import role_connection

log = logging.getLogger(__name__)

RESEND_URL = "https://api.resend.com/emails"
DEFAULT_FROM = "dev-reports@experience.com"
WEIGHT = {"P0": 4, "P1": 3, "P2": 2, "P3": 1}


def week_start_iso(d: datetime | date | None = None) -> str:
    """Monday (UTC) of the week containing `d`, as YYYY-MM-DD."""
    if d is None:
        d = datetime.now(UTC)
    day = d.astimezone(UTC).date() if isinstance(d, datetime) else d
    return (day - timedelta(days=day.weekday())).isoformat()


def email_configured() -> bool:
    return bool(os.environ.get("RESEND_API_KEY"))


def cron_configured() -> bool:
    return bool(os.environ.get("DEV_REPORT_CRON_SECRET"))


def authorized(headers: Mapping[str, str]) -> bool:
    """x-cron-secret must equal DEV_REPORT_CRON_SECRET; no secret configured → refuse."""
    secret = os.environ.get("DEV_REPORT_CRON_SECRET")
    if not secret:
        return False
    header = headers.get("x-cron-secret") or ""
    return hmac.compare_digest(header.encode(), secret.encode())


def send_mail(to: list[str], subject: str, text: str, sender: str) -> dict:
    """Send through Resend. Returns the legacy MailResult shape; raises on a Resend error."""
    if not to:
        return {"sent": False, "reason": "no_recipients", "recipients": 0}
    key = os.environ.get("RESEND_API_KEY")
    if not key:
        log.warning(
            '[dev-weekly] RESEND_API_KEY missing — skipping send of "%s" to %d recipients',
            subject,
            len(to),
        )
        return {"sent": False, "reason": "email_not_configured", "recipients": len(to)}
    res = httpx.post(
        RESEND_URL,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json={"from": sender, "to": to, "subject": subject, "text": text},
        timeout=None,
    )
    if not res.is_success:
        log.error("[dev-weekly] Resend failed [%s]: %s", res.status_code, res.text)
        raise RuntimeError(f"Resend failed [{res.status_code}]: {res.text}")
    return {"sent": True, "recipients": len(to)}


def load_weekly_context(week_start: str) -> dict:
    with role_connection("service_role") as conn:

        def q(sql: str, params: list[Any] | None = None) -> list[dict]:
            return list(conn.execute(sql, params).fetchall())

        launch = q("select * from exp_dev_launch order by launch_date asc limit 1")
        config = q("select * from exp_dev_config limit 1")
        teams = q("select * from exp_dev_teams order by sort_order asc")
        members = q("select * from exp_dev_members order by name asc")
        projects = q("select * from exp_dev_projects")
        updates = q("select * from exp_dev_weekly_updates where week_start = %s", [week_start])
    return {
        "launch": launch[0] if launch else None,
        "config": config[0] if config else None,
        "teams": teams,
        "members": members,
        "projects": projects,
        "updates": updates,
    }


def js_round(x: float) -> float:
    """JavaScript Math.round (half up)."""
    return float(math.floor(x + 0.5))


def team_progress(projects: list[dict]) -> float | None:
    """Priority-weighted mean progress, one decimal; None when the team has no projects."""
    num = 0.0
    den = 0
    for p in projects:
        w = WEIGHT.get(js_str(p.get("priority") if p.get("priority") is not None else "P2"), 2)
        pct = p.get("progress_pct")
        num += w * (float(pct) if pct is not None else 0.0)
        den += w
    return js_round((num / den) * 10) / 10 if den else None


def from_address(config: dict | None) -> str:
    value = (config or {}).get("from_email")
    return js_str(value) if value is not None else DEFAULT_FROM


def js_str(value: Any) -> str:
    """JavaScript `String(value)` for DB values (null → "null", 50.0 → "50")."""
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, (float, Decimal)):
        f = float(value)
        if math.isfinite(f) and f.is_integer():
            return str(int(f))
        return repr(f) if isinstance(value, float) else str(f)
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def days_until(launch_date: Any, now: datetime | None = None) -> int:
    """Whole days from now to launch_date 00:00 UTC (JS Math.round)."""
    now = now or datetime.now(UTC)
    d = launch_date if isinstance(launch_date, date) else date.fromisoformat(str(launch_date)[:10])
    target = datetime(d.year, d.month, d.day, tzinfo=UTC)
    return int(js_round((target - now).total_seconds() / 86400))


def digest_text(ctx: dict, week_start: str, now: datetime | None = None) -> str:
    lines = [f"SRP Alpha weekly report — week of {week_start}"]
    launch = ctx.get("launch")
    if launch:
        days = days_until(launch.get("launch_date"), now)
        lines.append(
            f"{days} days to the {js_str(launch.get('phase'))} launch on "
            f"{js_str(launch.get('launch_date'))}."
        )
    members = ctx["members"]
    updates = ctx["updates"]
    submitted_ids = {js_str(u.get("member_id")) for u in updates if u.get("status") == "submitted"}
    lines += [f"{len(submitted_ids)} of {len(members)} members submitted an update.", ""]

    for team in ctx["teams"]:
        team_id = js_str(team.get("id"))
        team_members = [m for m in members if js_str(m.get("team_id")) == team_id]
        if not team_members:
            continue
        progress = team_progress([p for p in ctx["projects"] if js_str(p.get("team_id")) == team_id])
        team_submitted = sum(1 for m in team_members if js_str(m.get("id")) in submitted_ids)
        progress_s = "no projects" if progress is None else f"{js_str(progress)}%"
        lines.append(
            f"## {js_str(team.get('name'))} — {progress_s} · "
            f"{team_submitted}/{len(team_members)} submitted"
        )
        for m in team_members:
            u = next(
                (
                    x
                    for x in updates
                    if js_str(x.get("member_id")) == js_str(m.get("id"))
                    and x.get("status") == "submitted"
                ),
                None,
            )
            if u is None:
                continue
            self_pct = (
                "" if u.get("self_progress_pct") is None
                else f" — self {js_str(u.get('self_progress_pct'))}%"
            )
            lines.append(f"- {js_str(m.get('name'))} ({js_str(m.get('role'))}){self_pct}")
            if u.get("highlights"):
                lines.append(f"  Highlights: {js_str(u['highlights'])}")
            if u.get("blockers"):
                lines.append(f"  Blockers: {js_str(u['blockers'])}")
            if u.get("next_week"):
                lines.append(f"  Next week: {js_str(u['next_week'])}")
        chase = [js_str(m.get("name")) for m in team_members if js_str(m.get("id")) not in submitted_ids]
        if chase:
            lines.append(f"  Awaiting: {', '.join(chase)}")
        lines.append("")
    return "\n".join(lines).strip()


def emails(members: list[dict]) -> list[str]:
    out = []
    for m in members:
        e = (js_str(m.get("email")) if m.get("email") is not None else "").strip()
        if "@" in e:
            out.append(e)
    return out
