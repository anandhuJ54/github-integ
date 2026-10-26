"""Legacy HTTP routes `/api/public/dev-weekly-*` (served here as `/public/dev-weekly-*`).

Reminder and digest are called by an external scheduler with the `x-cron-secret` header
(DEV_REPORT_CRON_SECRET). No scheduler is added here. Status is public and non-sensitive.
"""
from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, PlainTextResponse, Response

from surfaces.ops.dev_weekly import services as dw

router = APIRouter(tags=["ops:dev-weekly"])


def _unauthorized() -> Response:
    return PlainTextResponse("Unauthorized", status_code=401)


@router.post("/public/dev-weekly-digest")
def dev_weekly_digest(request: Request) -> Response:
    """Compile submitted updates + team progress and email every member."""
    if not dw.authorized(request.headers):
        return _unauthorized()
    week_start = dw.week_start_iso()
    ctx = dw.load_weekly_context(week_start)
    text = dw.digest_text(ctx, week_start)
    result = dw.send_mail(
        to=dw.emails(ctx["members"]),
        subject=f"SRP Alpha weekly report — week of {week_start}",
        text=text,
        sender=dw.from_address(ctx["config"]),
    )
    return JSONResponse({"job": "digest", "week_start": week_start, **result})


@router.post("/public/dev-weekly-reminder")
def dev_weekly_reminder(request: Request) -> Response:
    """Email every member still pending for the current week."""
    if not dw.authorized(request.headers):
        return _unauthorized()
    week_start = dw.week_start_iso()
    ctx = dw.load_weekly_context(week_start)
    submitted = {
        dw.js_str(u.get("member_id")) for u in ctx["updates"] if u.get("status") == "submitted"
    }
    pending = [m for m in ctx["members"] if dw.js_str(m.get("id")) not in submitted]
    config = ctx["config"] or {}
    due_day = config.get("due_day") if config.get("due_day") is not None else "Friday"
    due_time = config.get("due_time") if config.get("due_time") is not None else "09:00"
    text = "\n".join(
        [
            f"Your SRP Alpha weekly update for the week of {week_start} is still outstanding.",
            f"It is due {dw.js_str(due_day)} {dw.js_str(due_time)}.",
            "",
            ("Open SRP Dev Progress → Weekly and fill in: self progress %, highlights, blockers, "
            "next week."),
        ]
    )
    result = dw.send_mail(
        to=dw.emails(pending),
        subject=f"Weekly update due — week of {week_start}",
        text=text,
        sender=dw.from_address(ctx["config"]),
    )
    return JSONResponse(
        {"job": "reminder", "week_start": week_start, "pending": len(pending), **result}
    )


@router.get("/public/dev-weekly-status")
def dev_weekly_status() -> dict:
    """Whether outbound email and the cron secret are configured (booleans only)."""
    return {"emailConfigured": dw.email_configured(), "cronConfigured": dw.cron_configured()}
