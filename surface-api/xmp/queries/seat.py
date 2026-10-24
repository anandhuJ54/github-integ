"""xmp seat pages: lib/seat.ts (location and professional seats, listings), lib/nora/interview-data.ts
(interview subject, claim source) and lib/insurance-team.ts (Team Central) — the rows each
supabase-js query returned, under the names the page used.

The page logic (merging, filtering, the listings subject, periods and pace) stays in TypeScript.
Reads run as the signed-in user (RLS unchanged) and keep the 1000-row PostgREST cap. Reads whose
error the page ignored are tolerant (no rows / null); reads it threw raise. The commercial tables
(exp_revenue_components etc.) are only read here.
"""
from __future__ import annotations

from typing import Any, Literal

import psycopg
from sqlalchemy import select

from _base.core.sql import fetch_all, fetch_many
from _base.schema import tables as T
from xmp.queries.common import cols, single, single_or_raise

org_t, pro_t, nodes_t, reviews_t = T.t_organizations, T.t_professionals, T.t_graph_nodes, \
    T.t_reviews
scores_t, ratings_t, listings_t, claims_t = T.t_search_rank_scores, T.t_aggregate_ratings, \
    T.t_listings, T.t_claim_queue

PRO_COLS = ("id,display_name,first_name,last_name,slug,photo_url,bio,headline,job_title,email,"
            "phone,gcid,address_city,address_state,search_rank_score,claimed,is_demo,"
            "primary_org_id")
ORG_COLS = ("id,name,slug,logo_url,phone,email,website_url,gcid,address_street,address_city,"
            "address_state,address_zip,gbp_place_id,gbp_connected,search_rank_score,claimed,"
            "is_demo,parent_org_id")
SCORE_COLS = ("total_score,max_possible,score_pct,score_reviews,score_profile,score_listings,"
              "score_content,score_web_analytics,score_connections,gaps,next_milestone,"
              "next_milestone_gap,calculated_at")
REVIEW_COLS = ("id,rating,title,body,reviewer_name,reviewer_photo_url,review_date,source,"
               "reply_body,entity_id")
LISTING_COLS = ("id,directory_key,directory_name,directory_url,listing_url,status,has_drift,"
                "last_verified")

Kind = Literal["professional", "organization"]


# --- the seat helpers (loadScore, loadRatings, loadReviews, loadListings) ----------------------

def score_stmt(entity_type: str, entity_id: str) -> Any:
    """loadScore(): the newest score row (`.limit(1).maybeSingle()`)."""
    s = scores_t.c
    return select(*cols(scores_t, SCORE_COLS)) \
        .where(s.entity_type == entity_type, s.entity_id == entity_id) \
        .order_by(s.calculated_at.desc()).limit(1)


def ratings_stmt(entity_type: str, ids: Any) -> Any:
    """loadRatings() before its filter (which the page applies)."""
    r = ratings_t.c
    return select(r.source, r.rating_value, r.review_count, r.last_review_date) \
        .where(r.entity_type == entity_type, r.entity_id.in_(ids))


def reviews_stmt(entity_type: str, ids: Any, limit: int) -> Any:
    """loadReviews(): newest first."""
    r = reviews_t.c
    return select(*cols(reviews_t, REVIEW_COLS)) \
        .where(r.entity_type == entity_type, r.entity_id.in_(ids)) \
        .order_by(r.review_date.desc()).limit(limit)


def listings_stmt(entity_type: str, entity_id: str) -> Any:
    """loadListings(): by directory_key, 100."""
    lt = listings_t.c
    return select(*cols(listings_t, LISTING_COLS)) \
        .where(lt.entity_type == entity_type, lt.entity_id.in_([entity_id])) \
        .order_by(lt.directory_key).limit(100)


def listings(conn: psycopg.Connection, entity_type: str, entity_id: str) -> list[dict[str, Any]]:
    """loadListings() (errors ignored → [])."""
    return fetch_many(conn, {"l": listings_stmt(entity_type, entity_id)}, tolerant=True)["l"]


# --- LOCATION seat -----------------------------------------------------------------------------

def location_seat(conn: psycopg.Connection, office_id: str) -> dict[str, Any] | None:
    """loadLocationSeat()'s reads: None when the office isn't readable. Every read's error was
    ignored. The professionals' ratings and reviews key off the roster read's ids; the page
    filters the ratings and merges the two review lists."""
    office = single(fetch_many(conn, {"o": select(*cols(org_t, ORG_COLS))
                                      .where(org_t.c.id == office_id).limit(2)}, tolerant=True)["o"])
    if office is None:
        return None
    p = pro_t.c
    stmts: dict[str, Any] = {
        "pros": select(*cols(pro_t, PRO_COLS)).where(p.primary_org_id == office_id)
        .order_by(p.search_rank_score.desc().nulls_last()).limit(200),
        "score": score_stmt("organization", office_id),
        "ratings": ratings_stmt("organization", [office_id]),
        "officeReviews": reviews_stmt("organization", [office_id], 20),
    }
    if office.get("parent_org_id"):
        stmts["brand"] = select(*cols(org_t, "id,name,slug,logo_url")) \
            .where(org_t.c.id == office["parent_org_id"]).limit(2)
    rows = fetch_many(conn, stmts, tolerant=True)
    # the roster's ids, as the page passed them (an empty roster reads nothing)
    ids = [r["id"] for r in rows["pros"]][:200]
    more = fetch_many(conn, {"proRatings": ratings_stmt("professional", ids),
                             "proReviews": reviews_stmt("professional", ids, 20)},
                      tolerant=True) if ids else {"proRatings": [], "proReviews": []}
    return {
        "office": office,
        "brand": single(rows.get("brand")),
        "pros": rows["pros"],
        "score": single(rows["score"]),
        "ratings": rows["ratings"],
        "proRatings": more["proRatings"],
        "officeReviews": rows["officeReviews"],
        "proReviews": more["proReviews"],
    }


# --- PROFESSIONAL seat -------------------------------------------------------------------------

def professional_seat(conn: psycopg.Connection, pro_id: str) -> dict[str, Any] | None:
    """loadProfessionalSeat()'s reads except the listings (the page resolves the listings subject
    with exp_office_mode first): None when the professional isn't readable. Errors were ignored.
    `brand` is the office's parent, read only when the office has one."""
    pro = single(fetch_many(conn, {"p": select(*cols(pro_t, PRO_COLS))
                                   .where(pro_t.c.id == pro_id).limit(2)}, tolerant=True)["p"])
    if pro is None:
        return None
    n = nodes_t.c
    stmts: dict[str, Any] = {
        "score": score_stmt("professional", pro_id),
        "ratings": ratings_stmt("professional", [pro_id]),
        "reviews": reviews_stmt("professional", [pro_id], 25),
        "nodes": select(*cols(nodes_t, "id,ring,node_type,title,url,source,score_points,"
                                       "verified"))
        .where(n.entity_type == "professional", n.entity_id == pro_id, n.is_active.is_(True))
        .order_by(n.ring).limit(400),
    }
    if pro.get("primary_org_id"):
        stmts["office"] = select(*cols(org_t, "id,name,slug,logo_url,address_city,address_state,"
                                              "parent_org_id")) \
            .where(org_t.c.id == pro["primary_org_id"]).limit(2)
    rows = fetch_many(conn, stmts, tolerant=True)
    office = single(rows.get("office"))
    brand = None
    if office and office.get("parent_org_id"):
        brand = single(fetch_many(conn, {"b": select(*cols(org_t, "id,name,slug,logo_url,"
                                                                  "address_city,address_state"))
                                         .where(org_t.c.id == office["parent_org_id"]).limit(2)},
                                  tolerant=True)["b"])
    return {"pro": pro, "office": office, "brand": brand, "score": single(rows["score"]),
            "ratings": rows["ratings"], "reviews": rows["reviews"], "nodes": rows["nodes"]}


# --- lib/nora/interview-data.ts ----------------------------------------------------------------

def interview_subject(conn: psycopg.Connection, kind: str, entity_id: str) -> dict[str, Any] | None:
    """loadInterviewSubject()'s row (`.maybeSingle()`, error thrown); the page shapes it."""
    if kind == "professional":
        stmt = select(*cols(pro_t, "id,display_name,first_name,last_name,gcid,website_url,"
                                   "address_city,address_state,phone,claimed"))
        stmt = stmt.where(pro_t.c.id == entity_id)
    else:
        stmt = select(*cols(org_t, "id,name,gcid,website_url,address_city,address_state,phone,"
                                   "claimed")).where(org_t.c.id == entity_id)
    return single_or_raise(fetch_all(conn, stmt.limit(2)))


def claim_queue_row(conn: psycopg.Connection, entity_id: str) -> dict[str, Any] | None:
    """loadClaimSource(): the newest claim_queue row for the entity, select("*"); unreadable
    under RLS (or an error) → null, as the page ignored it."""
    c = claims_t.c
    stmt = select(claims_t).where(c.entity_id == entity_id).order_by(c.created_at.desc()).limit(1)
    return single(fetch_many(conn, {"c": stmt}, tolerant=True)["c"])


# --- lib/insurance-team.ts ---------------------------------------------------------------------

reps_t, terr_t, rev_t, quota_t, groups_t = T.t_exp_sales_reps, T.t_exp_territories, \
    T.t_exp_revenue_components, T.t_exp_sales_quotas, T.t_exp_category_groups
tb_t, exp_v, month_v = T.t_exp_territory_brand, T.t_v_logo_expansion, T.t_v_logo_expansion_month


def team_base(conn: psycopg.Connection, group_key: str) -> dict[str, Any]:
    """loadTeamCentral()'s first Promise.all (any error thrown, as the page did)."""
    rows = fetch_many(conn, {
        "reps": select(reps_t).where(reps_t.c.group_key == group_key).order_by(reps_t.c.role),
        "territories": select(terr_t).order_by(terr_t.c.tier, terr_t.c.seq),
        "revenue": select(*cols(rev_t, "id,seller_id,attributed_seller_id,amount,period_start,"
                                       "source")).where(rev_t.c.group_key == group_key),
        "quotas": select(quota_t).where(quota_t.c.group_key == group_key),
        "groups": select(groups_t.c.group_key, groups_t.c.label),
    })
    return rows


def team_family(conn: psycopg.Connection, family_key: str | None, territory_ids: list[str],
                year: int) -> dict[str, Any]:
    """The family-dependent reads, after the page picked the family and its territories: the
    territory→brand links, the linked organizations' names, the expansion views and the territory
    sellers' names (any error thrown, as the page did). The page reads only the sellers outside
    the team; every territory seller is returned here and the page's map keeps the same names."""
    stmts: dict[str, Any] = {}
    if territory_ids:
        stmts["links"] = select(tb_t.c.territory_id, tb_t.c.org_id) \
            .where(tb_t.c.territory_id.in_(territory_ids))
        linked = select(tb_t.c.org_id).where(tb_t.c.territory_id.in_(territory_ids))
        stmts["orgs"] = select(org_t.c.id, org_t.c.name).where(org_t.c.id.in_(linked))
        sellers = select(terr_t.c.seller_id).where(terr_t.c.id.in_(territory_ids),
                                                   terr_t.c.seller_id.is_not(None))
        stmts["sellers"] = select(reps_t.c.id, reps_t.c.name).where(reps_t.c.id.in_(sellers))
    if family_key:
        stmts["expansion"] = select(exp_v).where(exp_v.c.group_key == family_key) \
            .order_by(exp_v.c.year)
        m = month_v.c
        stmts["months"] = select(m.month_start, m.month_revenue, m.cumulative_revenue, m.year) \
            .where(m.group_key == family_key, m.year == year).order_by(m.month_start)
    rows = fetch_many(conn, stmts) if stmts else {}
    return {k: rows.get(k, []) for k in ("links", "orgs", "sellers", "expansion", "months")}
