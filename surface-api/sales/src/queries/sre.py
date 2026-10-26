"""sales SRE call console (S3) — port of the supabase-js calls in
surface-ui/sales/src/lib/sre-console.ts: the rep (exp_sales_reps), its promo code
(exp_promo_codes), its claim queues (exp_claim_events), and three inserts (exp_activity_events,
exp_promo_redemptions, exp_trial_extensions).

Runs as the signed-in user, so RLS decides exactly as it did for the browser (on GCP
exp_claim_events, exp_promo_codes, exp_promo_redemptions and exp_trial_extensions have RLS off).
Reads are the browser's statements, PostgREST-shaped: each queue keeps its `.limit(250)`, the
promo code its `.limit(1)`; none reaches the 1000-row cap. The rep id is the page's constant
(SRE_REP_ID), sent by the page as before.

Inserts are the browser's statements (only the keys sent, no RETURNING). `occurred_at` /
`redeemed_at`, which the browser stamped with `new Date().toISOString()`, are stamped with the
server's clock. `actor` (logCallOutcome) and `granted_by` (extendTrial: the page's SRE_REP_ID)
stay request fields: neither came from `auth.getUser()`.
"""
from __future__ import annotations

from typing import Any

import psycopg
from psycopg.types.json import Jsonb
from sqlalchemy import select
from surfaces.sales.queries.core import insert_rows
from surfaces.sales.queries.cpq import cols, execute, maybe_single, now

from _base.db import tables as T
from _base.db.sql import fetch_all, fetch_many

reps = T.t_exp_sales_reps
promos = T.t_exp_promo_codes
claims = T.t_exp_claim_events
activity = T.t_exp_activity_events
redemptions = T.t_exp_promo_redemptions
trials = T.t_exp_trial_extensions

CLAIM_COLS = ("id,entity_type,entity_id,entity_label,group_key,event_type,nora_engagement,"
              "upgraded,contact_phone,contact_email,occurred_at,state,is_demo")
QUEUES = ("attempted", "engaged", "lapsed_no_upgrade")


# --- reads -----------------------------------------------------------------------------------

def rep_stmt(rep_id: str) -> Any:
    """loadSreRep: select("id, name, role").eq("id", id).maybeSingle() (limit 2: enough to see
    a second row)."""
    return select(reps.c.id, reps.c.name, reps.c.role).where(reps.c.id == rep_id).limit(2)


def load_rep(conn: psycopg.Connection, rep_id: str) -> dict[str, Any] | None:
    return maybe_single(fetch_all(conn, rep_stmt(rep_id)))


def promo_stmt(seller_id: str) -> Any:
    """loadPromoCode: select("code, discount_pct, active, seller_id").eq("seller_id", id)
    .eq("active", true).limit(1).maybeSingle() (no ORDER BY, as before)."""
    return (select(*cols(promos, "code,discount_pct,active,seller_id"))
            .where(promos.c.seller_id == seller_id, promos.c.active.is_(True)).limit(1))


def load_promo(conn: psycopg.Connection, seller_id: str) -> dict[str, Any] | None:
    """The raw row or null; the page maps it to {code, discount_pct}."""
    return maybe_single(fetch_all(conn, promo_stmt(seller_id)))


def queue_stmt(seller_id: str, event_type: str) -> Any:
    """loadQueue: .eq("seller_id").eq("event_type").order("occurred_at", asc).limit(250), plus
    .gt("nora_engagement", 0) for "engaged"."""
    stmt = select(*cols(claims, CLAIM_COLS)).where(claims.c.seller_id == seller_id,
                                                   claims.c.event_type == event_type)
    if event_type == "engaged":
        stmt = stmt.where(claims.c.nora_engagement > 0)
    return stmt.order_by(claims.c.occurred_at.asc()).limit(250)


def load_queues(conn: psycopg.Connection, seller_id: str) -> dict[str, list[dict[str, Any]]]:
    """loadQueues: the three queue reads (a Promise.all whose errors threw) in one round trip."""
    return fetch_many(conn, {k: queue_stmt(seller_id, k) for k in QUEUES})


# --- writes ----------------------------------------------------------------------------------

def log_call_outcome(conn: psycopg.Connection, values: dict[str, Any]) -> None:
    """logCallOutcome: insert({event_type, subject_type, subject_id, actor, occurred_at, source,
    value}); occurred_at from the server's clock. `value` is jsonb (a JSON null stays NULL)."""
    row = {**values, "occurred_at": now()}
    if row.get("value") is not None:
        row["value"] = Jsonb(row["value"])
    execute(conn, insert_rows(activity, [row]))


def send_promo_code(conn: psycopg.Connection, values: dict[str, Any]) -> None:
    """sendPromoCode: insert({code, subject_id, redeemed_at}); redeemed_at from the server's
    clock."""
    execute(conn, insert_rows(redemptions, [{**values, "redeemed_at": now()}]))


def extend_trial(conn: psycopg.Connection, values: dict[str, Any]) -> None:
    """extendTrial: insert({subject_id, days, granted_by, reason}). The page clamps `days` to
    1..7 (and the table checks days <= 7), as before."""
    execute(conn, insert_rows(trials, [values]))
