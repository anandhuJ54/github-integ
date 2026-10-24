"""xmp enterprise pages: lib/enterprise-xmp.ts (brand, hierarchy explorer, leaderboards, view-as,
moderation queue) and routes/_authenticated/enterprise.$orgSlug.{campaigns,users}.tsx — the rows
each supabase-js query returned, under the names the page used.

The page logic stays in TypeScript. Reads run as the signed-in user (RLS unchanged) and keep the
1000-row PostgREST cap, including the users page's `.limit(2000)` and the hierarchy reads (1i).
The writes are the page's own statements, ported as they are: same table, columns and filter, as
the signed-in user, so RLS decides as before (review_campaigns and invitations have no policy:
inserts fail; professionals has no update policy: 0 rows; audit_log inserts are allowed).
"""
from __future__ import annotations

from typing import Any

import psycopg
from psycopg.types.json import Jsonb
from sqlalchemy import select

from _base.core.sql import fetch_all, fetch_many
from _base.schema import tables as T
from xmp.queries.common import call_rpc, cols, execute, single, soft

org_t, pro_t, nodes_t = T.t_organizations, T.t_professionals, T.t_graph_nodes
camp_t, rules_t, roles_t, inv_t, acct_t, audit_t = T.t_review_campaigns, \
    T.t_content_compliance_rules, T.t_user_roles, T.t_invitations, T.t_user_accounts, T.t_audit_log

BRAND_COLS = "id,name,slug,logo_url,entity_type,address_city,address_state,search_rank_score"
OFFICE_PRO_COLS = ("id,display_name,first_name,last_name,slug,photo_url,bio,address_city,"
                   "address_state,search_rank_score,claimed,primary_org_id")
VIEW_AS_PRO_COLS = ("id,display_name,first_name,last_name,slug,photo_url,bio,headline,job_title,"
                    "email,phone,address_city,address_state,search_rank_score,claimed,primary_org_id")
VIEW_AS_OFFICE_COLS = ("id,name,slug,phone,address_street,address_city,address_state,address_zip,"
                       "search_rank_score,claimed")


# --- lib/enterprise-xmp.ts ---------------------------------------------------------------------

def brand_stmt(slug: str) -> Any:
    """loadBrand(): `.maybeSingle()`, error ignored."""
    return select(*cols(org_t, BRAND_COLS)).where(org_t.c.slug == slug).limit(2)


def office_pros_stmt(office_id: str, limit: int) -> Any:
    """loadOfficePros(): the office's roster by display_name (nulls last)."""
    return select(*cols(pro_t, OFFICE_PRO_COLS)).where(pro_t.c.primary_org_id == office_id) \
        .order_by(pro_t.c.display_name.asc().nulls_last()).limit(limit)


def top_offices_stmt(brand_id: str, limit: int) -> Any:
    """loadTopOfficesByScore(): the brand's offices with a score, best first."""
    o = org_t.c
    return select(o.id, o.name, o.slug, o.address_city, o.address_state, o.search_rank_score,
                  o.claimed) \
        .where(o.parent_org_id == brand_id, o.search_rank_score > 0) \
        .order_by(o.search_rank_score.desc()).limit(limit)


def view_as_professional(conn: psycopg.Connection, pro_id: str) -> dict[str, Any] | None:
    """loadViewAsProfessional(): None when the professional isn't readable. Errors were ignored
    (each read's data is null / [])."""
    pro = single(fetch_many(conn, {"p": select(*cols(pro_t, VIEW_AS_PRO_COLS))
                                   .where(pro_t.c.id == pro_id).limit(2)}, tolerant=True)["p"])
    if pro is None:
        return None
    n = nodes_t.c
    rows = fetch_many(conn, {
        # only when the professional has a primary_org_id (the subquery is NULL otherwise)
        "office": select(*cols(org_t, "id,name,slug,address_city,address_state")).where(
            org_t.c.id == select(pro_t.c.primary_org_id).where(pro_t.c.id == pro_id)
            .scalar_subquery()).limit(2),
        "nodes": select(n.id, n.node_type, n.title, n.url, n.ring)
        .where(n.entity_id == pro_id, n.is_active.is_(True)).order_by(n.ring).limit(300),
    }, tolerant=True)
    # The page's reviews read selects `review_text`, which reviews doesn't have: PostgREST
    # refused it (400), the page ignored the error and showed no reviews. Still none.
    return {"pro": pro, "office": single(rows["office"]), "nodes": rows["nodes"], "reviews": []}


def view_as_location(conn: psycopg.Connection, office_id: str) -> dict[str, Any] | None:
    """loadViewAsLocation(): the office (error ignored) and loadOfficePros(id, 100) (thrown)."""
    office = single(fetch_many(conn, {"o": select(*cols(org_t, VIEW_AS_OFFICE_COLS))
                                      .where(org_t.c.id == office_id).limit(2)}, tolerant=True)["o"])
    if office is None:
        return None
    return {"office": office, "pros": fetch_all(conn, office_pros_stmt(office_id, 100))}


def moderation_reviews(conn: psycopg.Connection, brand_id: str, limit: int) -> list[dict[str, Any]]:
    """loadModerationQueue(): loadTopReviews(brand, 200), whose error the page threw, then those
    professionals' newest `limit` reviews. That reviews read selects `review_text`, which reviews
    doesn't have: PostgREST refused it (400), the page ignored the error and showed an empty
    queue. Still empty; the RPC still runs so its error still reaches the page."""
    call_rpc(conn, "exp_xmp_top_reviews", {"p_brand": brand_id, "p_limit": 200})
    return []


# --- enterprise.$orgSlug.campaigns.tsx / users.tsx: the org and its hierarchy -------------------

CAMPAIGN_ORG_COLS = "id,name,slug,entity_type,gcid,hierarchy_path"
USERS_ORG_COLS = "id,name,slug,entity_type,parent_org_id,hierarchy_path,hierarchy_depth"
CAMPAIGN_COLS = ("id,entity_type,entity_id,name,campaign_type,status,subject,message_body,"
                 "target_platform,sent_count,opened_count,clicked_count,completed_count,"
                 "compliance_approved,includes_required_disclosures,created_at")
USERS_PRO_COLS = ("id,display_name,first_name,last_name,photo_url,email,user_id,primary_org_id,"
                  "search_rank_score,claimed,is_active")


def _org_tree(conn: psycopg.Connection, slug: str, names: str):
    """The root org by slug (`.maybeSingle()`, error ignored) and the orgs whose hierarchy_path
    contains its id (`.like("hierarchy_path", "%id%")`, error ignored), plus the ids the page
    built from them: the root, then every descendant that isn't the root."""
    root = single(fetch_many(conn, {"r": select(*cols(org_t, names)).where(org_t.c.slug == slug)
                                    .limit(2)}, tolerant=True)["r"])
    if root is None:
        return None, [], []
    desc = fetch_many(conn, {"d": select(*cols(org_t, names))
                             .where(org_t.c.hierarchy_path.like(f"%{root['id']}%"))},
                      tolerant=True)["d"]
    ids = [root["id"], *[o["id"] for o in desc if o["id"] != root["id"]]]
    return root, desc, ids


def campaigns_page(conn: psycopg.Connection, slug: str) -> dict[str, Any]:
    """CampaignsPage load(): `root` null when the slug is unknown. Errors were ignored."""
    root, desc, ids = _org_tree(conn, slug, CAMPAIGN_ORG_COLS)
    if root is None:
        return {"root": None}
    c = camp_t.c
    stmts: dict[str, Any] = {
        "campaigns": select(*cols(camp_t, CAMPAIGN_COLS))
        .where(c.entity_type == "organization", c.entity_id.in_(ids))
        .order_by(c.created_at.desc()),
    }
    if root.get("gcid"):
        stmts["rules"] = select(*cols(rules_t, "id,rule_name,rule_type,rule_value,applies_to,"
                                               "severity")) \
            .where(rules_t.c.gcid == root["gcid"], rules_t.c.is_active.is_(True))
    rows = fetch_many(conn, stmts, tolerant=True)
    return {"root": root, "descendants": desc, "campaigns": rows["campaigns"],
            "rules": rows.get("rules", [])}


def users_page(conn: psycopg.Connection, slug: str, user_id: str) -> dict[str, Any]:
    """EnterpriseUsersPage load(): `root` null when the slug is unknown. Errors were ignored.
    `adminRoles` are the signed-in user's own active roles on the tree; `accounts` the
    user_accounts of the roster's linked users (not read when none is linked)."""
    root, desc, ids = _org_tree(conn, slug, USERS_ORG_COLS)
    if root is None:
        return {"root": None}
    rl, inv = roles_t.c, inv_t.c
    rows = fetch_many(conn, {
        # `.limit(2000)`: PostgREST returned at most 1000 rows, kept (1i)
        "pros": select(*cols(pro_t, USERS_PRO_COLS)).where(pro_t.c.primary_org_id.in_(ids))
        .limit(2000),
        "roles": select(*cols(roles_t, "id,user_id,role,entity_type,entity_id,can_login_as,"
                                       "is_active"))
        .where(rl.entity_type == "organization", rl.entity_id.in_(ids)),
        "invites": select(*cols(inv_t, "id,email,status,invited_at,entity_type,entity_id"))
        .where(inv.entity_type == "organization", inv.entity_id.in_(ids))
        .order_by(inv.invited_at.desc()).limit(100),
        "adminRoles": select(rl.can_login_as)
        .where(rl.user_id == user_id, rl.entity_type == "organization", rl.entity_id.in_(ids),
               rl.is_active.is_(True)),
    }, tolerant=True)
    user_ids = [p["user_id"] for p in rows["pros"] if p.get("user_id")]
    accounts: list[dict[str, Any]] = []
    if user_ids:
        a = acct_t.c
        accounts = fetch_many(conn, {"a": select(a.supabase_user_id, a.email, a.last_login_at,
                                                 a.is_active)
                                     .where(a.supabase_user_id.in_(user_ids))}, tolerant=True)["a"]
    return {"root": root, "descendants": desc, "pros": rows["pros"], "roles": rows["roles"],
            "invites": rows["invites"], "adminRoles": rows["adminRoles"], "accounts": accounts}


# --- writes (as they are) ----------------------------------------------------------------------

def update_campaign_status(conn: psycopg.Connection, campaign_id: str, status: str) -> None:
    """updateStatus(): `review_campaigns.update({status}).eq("id", id)` (no policy: 0 rows)."""
    execute(conn, camp_t.update().where(camp_t.c.id == campaign_id).values(status=status))


def insert_campaign(conn: psycopg.Connection, values: dict[str, Any]) -> None:
    """duplicate() / launch(): `review_campaigns.insert({...})` with the keys the page sent
    (no policy: the insert fails with an RLS error, as before)."""
    execute(conn, camp_t.insert().inline().values(**values))


def insert_invitations(conn: psycopg.Connection, records: list[dict[str, Any]]) -> None:
    """submitSingleInvite() / submitBulkInvite(): `invitations.insert(record | records)`."""
    execute(conn, inv_t.insert().inline().values(records))


def audit_stmt(values: dict[str, Any]) -> Any:
    v = dict(values)
    if v.get("field_changes") is not None:
        v["field_changes"] = Jsonb(v["field_changes"])
    return audit_t.insert().inline().values(**v)


def impersonate(conn: psycopg.Connection, user_id: str, pro_id: str, impersonating: str,
                org_slug: str) -> None:
    """impersonate(): the audit_log insert, whose error the page showed."""
    execute(conn, audit_stmt({"user_id": user_id, "impersonating": impersonating,
                              "action": "user.impersonate", "entity_type": "professional",
                              "entity_id": pro_id, "field_changes": {"org_slug": org_slug}}))


def deactivate(conn: psycopg.Connection, user_id: str, pro_id: str) -> None:
    """deactivate(): `professionals.update({is_active: false}).eq("id", id)` (no update policy:
    0 rows), then the audit_log insert whose error the page ignored."""
    execute(conn, pro_t.update().where(pro_t.c.id == pro_id).values(is_active=False))
    soft(conn, audit_stmt({"user_id": user_id, "action": "user.deactivate",
                           "entity_type": "professional", "entity_id": pro_id,
                           "field_changes": {"is_active": False}}))
