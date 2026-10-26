"""srp /dashboard pages (the pro dashboard): routes/_authenticated/dashboard.{index,content,listings,reviews}.tsx —
the rows each supabase-js query returned, under the names the page used.

Each page starts from the signed-in user's professional (`professionals.user_id = auth.uid()`,
`.maybeSingle()` with its error ignored: null unless exactly one row). `professional_id` instead
reads that professional by id (parity and support); RLS decides either way, as for any read.
Every read's error was ignored (null / no rows). Reads keep the 1000-row PostgREST cap.

Moved from xmp (xmp/queries/dashboard.py), surface audit 2026-10-25. Same SQL.
"""
from __future__ import annotations

from typing import Any

import psycopg
from sqlalchemy import select
from surfaces.srp.queries.common import cols, single

from _base.db import tables as T
from _base.db.sql import fetch_many

pro_t, scores_t, subs_t, plg_t = T.t_professionals, T.t_search_rank_scores, T.t_subscriptions, \
    T.t_plg_rules
content_t, tax_t, listings_t, vnr_t, reviews_t = T.t_content_items, T.t_exp_taxonomy, \
    T.t_listings, T.t_exp_vertical_node_registry, T.t_reviews

HOME_PRO_COLS = ("id,display_name,first_name,last_name,job_title,headline,photo_url,address_city,"
                 "gcid,local_rank,local_rank_of")
PRO_COLS = "id,display_name,first_name,last_name,photo_url,gcid"
TERM_COLS = "id,term,term_display,level,search_volume_monthly,search_intent,priority"


def pro_stmt(names: str, user_id: str, professional_id: str | None = None) -> Any:
    where = pro_t.c.id == professional_id if professional_id else pro_t.c.user_id == user_id
    return select(*cols(pro_t, names)).where(where).limit(2)


def _pro(conn: psycopg.Connection, names: str, user_id: str,
         professional_id: str | None) -> dict[str, Any] | None:
    return single(fetch_many(conn, {"p": pro_stmt(names, user_id, professional_id)},
                             tolerant=True)["p"])


def home(conn: psycopg.Connection, user_id: str, professional_id: str | None = None) -> dict:
    """DashboardPage: the professional, its newest score, its subscription and the active PLG
    rules for its gcid (`gcid ?? ""`)."""
    pro = _pro(conn, HOME_PRO_COLS, user_id, professional_id)
    if pro is None:
        return {"pro": None}
    s, sub, plg = scores_t.c, subs_t.c, plg_t.c
    rows = fetch_many(conn, {
        "score": select(*cols(scores_t, "total_score,max_possible,score_change_7d,score_reviews,"
                                        "score_web_analytics,score_profile,score_connections,"
                                        "score_listings,score_content,gaps,next_milestone"))
        .where(s.entity_type == "professional", s.entity_id == pro["id"])
        .order_by(s.calculated_at.desc()).limit(1),
        "subscription": select(sub.plan_name, sub.status)
        .where(sub.entity_type == "professional", sub.entity_id == pro["id"]).limit(2),
        "plg": select(*cols(plg_t, "id,headline,body,cta_text,cta_url,cta_action,icon,priority"))
        .where(plg.is_active.is_(True), plg.gcid == (pro.get("gcid") or ""))
        .order_by(plg.priority.asc()).limit(5),
    }, tolerant=True)
    return {"pro": pro, "score": single(rows["score"]),
            "subscription": single(rows["subscription"]), "plg": rows["plg"]}


def content(conn: psycopg.Connection, user_id: str, professional_id: str | None = None) -> dict:
    """ContentPage: the professional's content items and, when it has a gcid, its category's top
    topics, top questions and every term (the page filters answered questions)."""
    pro = _pro(conn, PRO_COLS, user_id, professional_id)
    if pro is None:
        return {"pro": None}
    c, t = content_t.c, tax_t.c
    stmts: dict[str, Any] = {
        "items": select(*cols(content_t, "id,title,slug,excerpt,status,published_at,views,"
                                         "ai_mentions,keywords,topic_ids,published_url,"
                                         "content_type"))
        .where(c.author_type == "professional", c.author_id == pro["id"])
        .order_by(c.created_at.desc()).limit(100),
    }
    gcid = pro.get("gcid")
    if gcid:
        by_volume = t.search_volume_monthly.desc().nulls_last()
        stmts["topics"] = select(*cols(tax_t, TERM_COLS)) \
            .where(t.gcid == gcid, t.level == "topic", t.is_active.is_(True)) \
            .order_by(by_volume).limit(5)
        stmts["questions"] = select(*cols(tax_t, TERM_COLS)) \
            .where(t.gcid == gcid, t.level == "question", t.is_active.is_(True)) \
            .order_by(by_volume).limit(20)
        stmts["terms"] = select(*cols(tax_t, TERM_COLS)).where(t.gcid == gcid)
    rows = fetch_many(conn, stmts, tolerant=True)
    return {"pro": pro, "items": rows["items"], "topics": rows.get("topics", []),
            "questions": rows.get("questions", []), "terms": rows.get("terms", [])}


def me(conn: psycopg.Connection, user_id: str, professional_id: str | None = None) -> dict:
    """ListingsPage's first read: the professional (the page then resolves the listings subject
    with exp_office_mode)."""
    return {"pro": _pro(conn, PRO_COLS, user_id, professional_id)}


def listing_rows(conn: psycopg.Connection, entity_type: str, entity_id: str,
                 gcid: str | None) -> dict:
    """ListingsPage: the subject's listings and, when the professional has a gcid, the category's
    active presence-ring registry nodes by priority."""
    lt, v = listings_t.c, vnr_t.c
    stmts: dict[str, Any] = {
        "listings": select(*cols(listings_t, "id,directory_key,directory_name,directory_url,"
                                             "status,listing_url,last_verified,last_submitted,"
                                             "has_drift,drift_fields,score_points,name_match,"
                                             "phone_match,address_match"))
        .where(lt.entity_type == entity_type, lt.entity_id == entity_id),
    }
    if gcid:
        stmts["registry"] = select(*cols(vnr_t, "id,node_name,node_slug,connection_method,"
                                                "score_points,priority,url_pattern,ring")) \
            .where(v.gcid == gcid, v.ring == "presence", v.is_active.is_(True)) \
            .order_by(v.priority.asc())
    rows = fetch_many(conn, stmts, tolerant=True)
    return {"listings": rows["listings"], "registry": rows.get("registry", [])}


def reviews(conn: psycopg.Connection, user_id: str, professional_id: str | None = None) -> dict:
    """ReviewsPage: the professional and its newest 200 reviews."""
    pro = _pro(conn, PRO_COLS, user_id, professional_id)
    if pro is None:
        return {"pro": None}
    r = reviews_t.c
    rows = fetch_many(conn, {"reviews": select(*cols(reviews_t, "id,rating,title,body,"
                                                                "reviewer_name,review_date,source,"
                                                                "reply_body,reply_date,is_flagged,"
                                                                "flag_reason"))
                             .where(r.entity_type == "professional", r.entity_id == pro["id"])
                             .order_by(r.review_date.desc()).limit(200)}, tolerant=True)
    return {"pro": pro, "reviews": rows["reviews"]}
