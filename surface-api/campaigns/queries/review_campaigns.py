"""Enterprise review campaigns: routes/_authenticated/enterprise.$orgSlug.campaigns.tsx — the rows
each supabase-js query returned, under the names the page used.

Moved from xmp (xmp/queries/enterprise.py), surface audit 2026-10-25: review campaigns belong to
campaigns (open decision O11 still applies; behaviour is unchanged, no features added). Same SQL.
The page logic stays in TypeScript. Reads run as the signed-in user (RLS unchanged) and keep the
1000-row PostgREST cap. The writes are the page's own statements, ported as they are: same table,
columns and filter, as the signed-in user, so RLS decides as before (review_campaigns has no
insert or update policy: inserts fail, updates touch 0 rows).
"""
from __future__ import annotations

from typing import Any

import psycopg
from sqlalchemy import select
from sqlalchemy.sql import ClauseElement

from _base.core.sql import compile_sql, fetch_many
from _base.schema import tables as T

org_t, camp_t, rules_t = T.t_organizations, T.t_review_campaigns, T.t_content_compliance_rules

CAMPAIGN_ORG_COLS = "id,name,slug,entity_type,gcid,hierarchy_path"
CAMPAIGN_COLS = ("id,entity_type,entity_id,name,campaign_type,status,subject,message_body,"
                 "target_platform,sent_count,opened_count,clicked_count,completed_count,"
                 "compliance_approved,includes_required_disclosures,created_at")


# --- small helpers (copied from xmp/queries/common.py with the move; no cross-Surface import) ---

def cols(t: Any, names: str) -> list[Any]:
    """A supabase-js select list ("a,b,c") as the table's columns."""
    return [t.c[n.strip()] for n in names.split(",")]


def single(rows: list[dict[str, Any]] | None) -> dict[str, Any] | None:
    """`.maybeSingle()` whose error the page ignored: the row when exactly one matched
    (query with limit 2), else nothing."""
    return rows[0] if rows and len(rows) == 1 else None


def execute(conn: psycopg.Connection, stmt: ClauseElement) -> None:
    sql, params = compile_sql(stmt)
    with conn.cursor() as cur:
        cur.execute(sql, params)


# --- the org and its hierarchy -----------------------------------------------------------------

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


# --- writes (as they are) ----------------------------------------------------------------------

def update_campaign_status(conn: psycopg.Connection, campaign_id: str, status: str) -> None:
    """updateStatus(): `review_campaigns.update({status}).eq("id", id)` (no policy: 0 rows)."""
    execute(conn, camp_t.update().where(camp_t.c.id == campaign_id).values(status=status))


def insert_campaign(conn: psycopg.Connection, values: dict[str, Any]) -> None:
    """duplicate() / launch(): `review_campaigns.insert({...})` with the keys the page sent
    (no policy: the insert fails with an RLS error, as before)."""
    execute(conn, camp_t.insert().inline().values(**values))
