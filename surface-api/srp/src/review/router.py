"""Server functions from legacy `lib/reviews.functions.ts`: review replies and flags.

All run as the signed-in user (`authenticated` role, RLS applies), like the legacy
`requireSupabaseAuth` client. AI drafts are checked against `content_compliance_rules` plus
the category's `exp_category_compliance` prohibited phrases, server-side.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import UTC, datetime
from typing import Any

import httpx
import psycopg
from fastapi import Depends, HTTPException
from pydantic import BaseModel, ValidationError

from _base.auth import current_user
from _base.db.session import role_connection
from _base.server_fn import FnCall, bad_input, fn_router
from surfaces.srp.review.pg import maybe_single, rows, safe
from surfaces.srp.review.schemas import CheckInput, DraftInput, FlagInput, SaveInput

log = logging.getLogger(__name__)
router = fn_router("srp")

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
MODEL = "claude-sonnet-4-6"
DEFAULT_STYLE = (
    "warm, professional, concise (under 80 words). Thank the reviewer by first name. "
    "Do not make guarantees."
)


def _parse(model: type[BaseModel], data: Any) -> Any:
    try:
        return model.model_validate(data)
    except ValidationError as exc:
        detail = "; ".join(
            f"{'.'.join(str(p) for p in e['loc']) or 'data'}: {e['msg']}" for e in exc.errors()
        )
        raise bad_input(detail) from exc


def js_len(text: str) -> int:
    """JavaScript `string.length` (UTF-16 code units)."""
    return len(text.encode("utf-16-le")) // 2


def check_compliance(text: str, rules: list[dict]) -> list[dict]:
    """Prohibited phrases / category restrictions that apply to review replies."""
    lower = text.lower()
    issues = []
    for r in rules:
        applies_to = r.get("applies_to")
        if applies_to and "review_reply" not in applies_to:
            continue
        if r.get("rule_type") in ("prohibited_phrase", "category_restriction") and (
            str(r.get("rule_value") or "").lower() in lower
        ):
            issues.append(
                {
                    "rule_name": r.get("rule_name"),
                    "severity": r.get("severity"),
                    "rule_type": r.get("rule_type"),
                    "rule_value": r.get("rule_value"),
                }
            )
    return issues


def load_compliance_rules(conn: Any, gcid: str | None) -> list[dict]:
    """Active rules for a category (or global) plus its exp_category_compliance phrases."""
    g = gcid or ""
    rules = list(
        safe(
            conn,
            "select rule_name, rule_type, rule_value, severity, applies_to "
            "from content_compliance_rules where is_active = true and (gcid = %s or gcid is null)",
            [g],
            [],
        )
    )
    if g:
        cat = maybe_single(
            safe(
                conn,
                "select prohibited_phrases from exp_category_compliance where gcid = %s limit 2",
                [g],
                [],
            )
        )
        for phrase in (cat or {}).get("prohibited_phrases") or []:
            if not phrase:
                continue
            rules.append(
                {
                    "rule_name": "Category prohibited phrase",
                    "rule_type": "prohibited_phrase",
                    "rule_value": phrase,
                    "severity": "block",
                    "applies_to": None,
                }
            )
    return rules


def _audit(conn: Any, user_id: str, action: str, entity_id: str, changes: dict) -> None:
    """audit_log insert; the legacy code ignored its result, so a failure is only logged."""
    try:
        with conn.transaction():
            conn.execute(
                "insert into audit_log (user_id, action, entity_type, entity_id, field_changes) "
                "values (%s, %s, 'review', %s, %s::jsonb)",
                [user_id, action, entity_id, json.dumps(changes)],
            )
    except psycopg.Error as exc:
        log.warning("audit_log insert failed: %s", type(exc).__name__)


def build_prompts(pro: dict, review: dict, style: str, rules: list[dict]) -> tuple[str, str]:
    prohibited = "; ".join(
        str(r.get("rule_value"))
        for r in rules
        if r.get("rule_type") in ("prohibited_phrase", "category_restriction")
    )
    pro_name = pro.get("display_name") or pro.get("first_name") or "the team"
    system = (
        f"You write public review replies for {pro_name}. Style: {style}.\n"
        f"Never use any of these phrases: {prohibited}.\n"
        f"Keep under 80 words. Reply as {pro_name} (first person). Do not include hashtags or links."
    )
    rating = review.get("rating")
    rating_s = "null" if rating is None else _num_str(rating)
    title = f"Title: {review['title']}\n" if review.get("title") else ""
    reviewer = review.get("reviewer_name")
    user = (
        f"Reviewer: {reviewer if reviewer is not None else 'Customer'}\n"
        f"Rating: {rating_s}/5\n"
        f"{title}Review: {review.get('body') if review.get('body') is not None else ''}\n\n"
        "Write a public reply."
    )
    return system, user


def _num_str(value: Any) -> str:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return str(value)
    return str(int(f)) if f.is_integer() else str(f)


def review_style(ai_agents: Any) -> str:
    agents = ai_agents if isinstance(ai_agents, dict) else {}

    def sub(key: str) -> dict:
        v = agents.get(key)
        return v if isinstance(v, dict) else {}

    for candidate in (
        sub("review_response").get("style"),
        agents.get("review_response_style"),
        sub("review_responder").get("style"),
    ):
        if candidate is not None:
            return str(candidate)
    return DEFAULT_STYLE


@router.post("/draftReviewReply")
def draft_review_reply(call: FnCall, claims: dict = Depends(current_user)) -> dict:
    data: DraftInput = _parse(DraftInput, call.data)
    user_id = claims["sub"]
    # Reads first; the connection is released before the model call.
    with role_connection("authenticated", claims) as conn:
        review = maybe_single(
            safe(
                conn,
                "select id, rating, title, body, reviewer_name, source from reviews "
                "where id = %s limit 2",
                [data.reviewId],
                None,
            )
        )
        if not review:
            raise bad_input("Review not found")
        pro = maybe_single(
            safe(
                conn,
                "select id, display_name, first_name, gcid from professionals where id = %s limit 2",
                [data.professionalId],
                [],
            )
        )
        if not pro:
            raise bad_input("Professional not found")
        knowledge = maybe_single(
            safe(
                conn,
                "select ai_agents from exp_category_knowledge where gcid = %s limit 2",
                [pro.get("gcid") or ""],
                [],
            )
        )
        style = review_style((knowledge or {}).get("ai_agents"))
        rules = load_compliance_rules(conn, pro.get("gcid"))

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")
    system, user = build_prompts(pro, review, style, rules)
    resp = httpx.post(
        ANTHROPIC_URL,
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json={
            "model": MODEL,
            "max_tokens": 400,
            "system": system,
            "messages": [{"role": "user", "content": user}],
        },
        timeout=None,
    )
    if not resp.is_success:
        raise HTTPException(
            status_code=500,
            detail=f"Anthropic API error: {resp.status_code} {resp.text[:200]}",
        )
    body = resp.json()
    content = body.get("content") or []
    first = content[0] if content and isinstance(content[0], dict) else {}
    draft = str(first.get("text") or "").strip()
    issues = check_compliance(draft, rules)
    with role_connection("authenticated", claims, write=True) as conn:
        _audit(
            conn,
            user_id,
            "review.reply.draft",
            data.reviewId,
            {"length": js_len(draft), "issues": len(issues)},
        )
    return {"draft": draft, "issues": issues}


@router.post("/checkReplyCompliance")
def check_reply_compliance(call: FnCall, claims: dict = Depends(current_user)) -> dict:
    data: CheckInput = _parse(CheckInput, call.data)
    with role_connection("authenticated", claims) as conn:
        rules = load_compliance_rules(conn, data.gcid)
    return {"issues": check_compliance(data.text, rules)}


@router.post("/saveReviewReply")
def save_review_reply(call: FnCall, claims: dict = Depends(current_user)) -> dict:
    data: SaveInput = _parse(SaveInput, call.data)
    with role_connection("authenticated", claims, write=True) as conn:
        rows(
            conn,
            "update reviews set reply_body = %s, reply_date = %s, reply_source = 'experience' "
            "where id = %s returning id",
            [data.replyBody, datetime.now(UTC), data.reviewId],
        )
        _audit(conn, claims["sub"], "review.reply.save", data.reviewId,
               {"length": js_len(data.replyBody)})
    return {"ok": True}


@router.post("/flagReview")
def flag_review(call: FnCall, claims: dict = Depends(current_user)) -> dict:
    data: FlagInput = _parse(FlagInput, call.data)
    with role_connection("authenticated", claims, write=True) as conn:
        rows(
            conn,
            "update reviews set is_flagged = true, flag_reason = %s, flag_status = 'pending' "
            "where id = %s returning id",
            [data.reason, data.reviewId],
        )
        _audit(conn, claims["sub"], "review.flag", data.reviewId, {"reason": data.reason})
    return {"ok": True}
