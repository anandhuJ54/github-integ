"""graph entity pages: /control-graph tabs, the /:category/:city/:professional page and the public
/p|o|c/:slug/graph expertise graph — the rows each supabase-js query returned, under the same names.

The page logic stays in TypeScript. Reads run on the caller's role connection (RLS unchanged);
RPCs go through one allow-list (GRAPH_RPCS) with each parameter cast to its database type, and
the functions check roles themselves, as they did for the browser.

Caps: every read keeps the 1000-row PostgREST cap (`_base.core.sql.MAX_ROWS`), except the
expertise graph's node, edge and external-node reads, which return everything (ruling
2026-10-24: the largest professional has 2,644 active nodes).
"""
from __future__ import annotations

from typing import Any

import psycopg
from sqlalchemy import func, or_, select, union

from _base.core.sql import fetch_all, fetch_many, jsonish
from _base.schema import tables as T

profile_v = T.t_v_professional_profile
reviews_t, content_t, creds_t = T.t_reviews, T.t_content_items, T.t_credentials
pro_t, org_t, nodes_t, edges_t = T.t_professionals, T.t_organizations, T.t_graph_nodes, \
    T.t_graph_edges
tax_t, tx_t, ratings_t, scores_t = T.t_exp_taxonomy, T.t_transaction_signals, \
    T.t_aggregate_ratings, T.t_search_rank_scores
entity_t, rel_t, claim_t, ctrl_t = T.t_exp_entity, T.t_exp_rel, T.t_exp_claim, \
    T.t_exp_control_nodes


def _cols(t: Any, names: str) -> list[Any]:
    """A supabase-js select list ("a, b, c") as the table's columns."""
    return [t.c[n.strip()] for n in names.split(",")]


def single(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    """`.maybeSingle()` whose error the page ignored: the row when exactly one matched
    (queried with limit 2), else nothing."""
    return rows[0] if len(rows) == 1 else None


class MultipleRows(ValueError):
    """`.maybeSingle()` matched more than one row (PostgREST's error, which the page threw)."""


def single_or_raise(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    if len(rows) > 1:
        raise MultipleRows("JSON object requested, multiple (or no) rows returned")
    return rows[0] if rows else None


# --- /control-graph ----------------------------------------------------------------------------

def rpc_rows(conn: psycopg.Connection, sql: str, params: dict[str, Any] | None = None):
    """A set-returning RPC: its rows, as PostgREST sent them."""
    with conn.cursor() as cur:
        cur.execute(sql, params or {})
        return [jsonish(dict(r)) for r in cur.fetchall()] if cur.description else []


def validate_graph(conn: psycopg.Connection) -> list[dict[str, Any]]:
    """graph-health-card.tsx: rpc("exp_validate_graph")."""
    return rpc_rows(conn, "select * from public.exp_validate_graph()")


def control_users(conn: psycopg.Connection) -> list[dict[str, Any]]:
    """claims-tab.tsx: rpc("list_control_users")."""
    return rpc_rows(conn, "select * from public.list_control_users()")


def control_nodes_stmt() -> Any:
    """control-tree-tab.tsx: exp_control_nodes ordered by name."""
    return select(*_cols(ctrl_t, "node_id, name, node_type, parent_id, is_billing_container, "
                                 "linked_entity_id, status, created_at")).order_by(ctrl_t.c.name)


def brands_stmt() -> Any:
    """control-tree-tab.tsx: brand entities not merged/deactivated, by name, 500."""
    e = entity_t.c
    return select(e.entity_id, e.display_name, e.entity_type) \
        .where(e.entity_type == "brand", ~e.status.in_(("merged", "deactivated"))) \
        .order_by(e.display_name).limit(500)


def entities_stmt() -> Any:
    """entities-tab.tsx: the newest 1000 entities."""
    return select(*_cols(entity_t, "entity_id, display_name, entity_type, status, claim_state, "
                                   "confidence, created_at, is_demo")) \
        .order_by(entity_t.c.created_at.desc()).limit(1000)


def relationships_stmt(entity_id: str) -> Any:
    """entities-tab.tsx RelationshipRows: an entity's relationships, newest 200."""
    return select(*_cols(rel_t, "rel_id, relationship_type, object_entity_id, object_gcid, status, "
                                "is_primary, valid_from, valid_to, confidence")) \
        .where(rel_t.c.subject_entity_id == entity_id) \
        .order_by(rel_t.c.created_at.desc()).limit(200)


def claims_stmt() -> Any:
    """claims-tab.tsx: the newest 500 claims."""
    return select(*_cols(claim_t, "claim_id, entity_id, user_id, claim_type, status, evidence, "
                                  "verified_at, created_at")) \
        .order_by(claim_t.c.created_at.desc()).limit(500)


def entities_lite_stmt() -> Any:
    """claims-tab.tsx: `.limit(2000)` unordered — capped at 1000 like PostgREST (gap 1g)."""
    e = entity_t.c
    return select(e.entity_id, e.display_name, e.entity_type).limit(2000)


# name → [(param, db type)]. Each is a role-checked SECURITY DEFINER function; it decides.
GRAPH_RPCS: dict[str, list[tuple[str, str]]] = {
    "exp_claim_adjudicate": [("p_claim", "uuid"), ("p_approve", "boolean"), ("p_note", "text")],
    "exp_ctrl_create_node": [("p_name", "text"), ("p_node_type", "text"), ("p_parent", "uuid"),
                             ("p_billing", "boolean"), ("p_linked_entity", "uuid")],
    "exp_ctrl_update_node": [("p_id", "uuid"), ("p_name", "text"), ("p_node_type", "text"),
                             ("p_parent", "uuid"), ("p_move", "boolean"), ("p_billing", "boolean"),
                             ("p_linked_entity", "uuid"), ("p_status", "text")],
}


class UnknownRpc(ValueError):
    """Not an allow-listed function, or a parameter it doesn't take."""


def rpc_sql(name: str, args: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """The call for an allow-listed function with the named arguments given (omitted ones take
    the function's defaults, as supabase-js `rpc` did)."""
    if name not in GRAPH_RPCS:
        raise UnknownRpc(f"unknown function {name!r}")
    allowed = dict(GRAPH_RPCS[name])
    unknown = set(args) - set(allowed)
    if unknown:
        raise UnknownRpc(f"{name}: unknown parameter(s) {sorted(unknown)}")
    named = ", ".join(f"{p} => %({p})s::{t}" for p, t in GRAPH_RPCS[name] if p in args)
    return f"select public.{name}({named}) as v", {p: args[p] for p in args}


def call_rpc(conn: psycopg.Connection, name: str, args: dict[str, Any]) -> Any:
    sql, params = rpc_sql(name, args)
    with conn.cursor() as cur:
        cur.execute(sql, params)
        row = cur.fetchone()
    return jsonish(next(iter(row.values()))) if row else None


# --- /:category/:city/:professional ------------------------------------------------------------

TAX_LEVELS = ("specialization", "topic", "service", "product_service", "product")
ORG_PROFILE_COLS = ("id, name, slug, schema_type, website_url, canonical_url, logo_url, phone, "
                    "address_street, address_city, address_state, address_zip, address_country, "
                    "same_as, wikidata_id")


def profile_view_stmt(slug: str) -> Any:
    return select(profile_v).where(profile_v.c.slug == slug).limit(2)


def profile_side_stmts(prof_id: str, gcid: str | None) -> dict[str, Any]:
    """loadProfile()'s Promise.all, plus loadOrg() of the professional's primary_org_id."""
    n = nodes_t.c
    stmts: dict[str, Any] = {
        "reviews": select(*_cols(reviews_t, "id, rating, title, body, reviewer_name, review_date, "
                                            "reply_body, reply_date, source, is_verified"))
        .where(reviews_t.c.entity_type == "professional", reviews_t.c.entity_id == prof_id)
        .order_by(reviews_t.c.review_date.desc()).limit(5),
        "content": select(*_cols(content_t, "id, title, slug, excerpt, cover_image_url, "
                                            "published_at"))
        .where(content_t.c.author_type == "professional", content_t.c.author_id == prof_id,
               content_t.c.status == "published")
        .order_by(content_t.c.published_at.desc()).limit(3),
        "credentials": select(*_cols(creds_t, "id, credential_type, name, identifier, issuing_org, "
                                              "issuing_org_url, issuing_state, valid_until, "
                                              "verified, schema_credential_category, wikidata_id"))
        .where(creds_t.c.professional_id == prof_id, creds_t.c.is_current.is_(True))
        .order_by(creds_t.c.verified.desc()),
        "pro": select(*_cols(pro_t, "id, canonical_url, phone, email, website_url, address_zip, "
                                    "wikidata_id, primary_org_id"))
        .where(pro_t.c.id == prof_id).limit(2),
        "graphNodes": select(n.node_type, n.url, n.title, n.schema_property, n.source)
        .where(n.entity_type == "professional", n.entity_id == prof_id, n.is_active.is_(True),
               or_(n.ring == 2, n.schema_property == "sameAs")),
        "transactionSignals": select(tx_t.c.city, tx_t.c.state, tx_t.c.zip_code,
                                     tx_t.c.transaction_type)
        .where(tx_t.c.professional_id == prof_id).limit(50),
        "aggregateRating": select(*_cols(ratings_t, "rating_value, review_count, rating_1, "
                                                    "rating_2, rating_3, rating_4, rating_5"))
        .where(ratings_t.c.entity_type == "professional", ratings_t.c.entity_id == prof_id,
               ratings_t.c.source == "all").limit(2),
        # loadOrg(proRes.primary_org_id): the same row, keyed off the professional in SQL
        "org": select(*_cols(org_t, ORG_PROFILE_COLS))
        .where(org_t.c.id == select(pro_t.c.primary_org_id).where(pro_t.c.id == prof_id)
               .scalar_subquery()).limit(2),
    }
    if gcid:
        stmts["taxonomy"] = select(tax_t.c.term, tax_t.c.level, tax_t.c.wikidata_id) \
            .where(tax_t.c.gcid == gcid, tax_t.c.level.in_(TAX_LEVELS)).limit(50)
    return stmts


def professional_page(conn: psycopg.Connection, slug: str) -> dict[str, Any]:
    """The rows behind loadProfile(): `profile` (null when the slug is unknown) and, when found,
    each side read under the name the page used. A failed side read is no rows, as in the TS."""
    prof = single_or_raise(fetch_all(conn, profile_view_stmt(slug)))
    if prof is None:
        return {"profile": None}
    rows = fetch_many(conn, profile_side_stmts(prof["id"], prof.get("gcid")), tolerant=True)
    return {
        "profile": prof,
        "reviews": rows["reviews"],
        "content": rows["content"],
        "credentials": rows["credentials"],
        "pro": single(rows["pro"]),
        "graphNodes": rows["graphNodes"],
        "taxonomy": rows.get("taxonomy", []),
        "transactionSignals": rows["transactionSignals"],
        "aggregateRating": single(rows["aggregateRating"]),
        "org": single(rows["org"]),
    }


def services_stmt(gcid: str) -> Any:
    """ServicesSection: a category's services, by priority, 20."""
    return select(tax_t.c.id, tax_t.c.term, tax_t.c.level) \
        .where(tax_t.c.gcid == gcid, tax_t.c.level.in_(("product_service", "specialization"))) \
        .order_by(tax_t.c.priority.asc()).limit(20)


# --- /p|o|c/:slug/graph ------------------------------------------------------------------------

NODE_COLS = ("id, entity_type, entity_id, node_type, ring, title, url, source, source_id, "
             "source_url, verified, verified_at, schema_type, schema_property, score_points, "
             "score_counted, fetched_at")
PRO_COLS = ("id, first_name, last_name, display_name, slug, job_title, headline, photo_url, gcid, "
            "address_city, address_state, address_zip, phone, email, website_url, bio, short_bio, "
            "gbp_place_id, primary_license_number, primary_license_state, primary_license_type, "
            "primary_license_verified, languages, markets_served, claimed, primary_org_id, "
            "canonical_url, schema_type")
ORG_COLS = ("id, name, legal_name, slug, logo_url, gcid, address_city, address_state, "
            "address_zip, phone, website_url, entity_type, parent_org_id, claimed, gbp_place_id, "
            "description")


def expertise_entity_stmt(kind: str, slug: str) -> Any:
    """resolveEntity(): the professional, or the organization (office/company), by slug."""
    if kind == "professional":
        return select(*_cols(pro_t, PRO_COLS)).where(pro_t.c.slug == slug).limit(2)
    return select(*_cols(org_t, ORG_COLS)).where(org_t.c.slug == slug).limit(2)


def _own_ids(entity_type: str, entity_id: str) -> Any:
    """The entity's active node ids (aliased: never correlated with an outer graph_nodes)."""
    n = nodes_t.alias("own").c
    return select(n.id).where(n.entity_type == entity_type, n.entity_id == entity_id,
                              n.is_active.is_(True))


def own_nodes_stmt(entity_type: str, entity_id: str) -> Any:
    n = nodes_t.c
    return select(*_cols(nodes_t, NODE_COLS)) \
        .where(n.entity_type == entity_type, n.entity_id == entity_id, n.is_active.is_(True))


def edges_stmt(entity_type: str, entity_id: str) -> Any:
    """`.or(from_node_id.in.(own ids),to_node_id.in.(own ids))`, the own ids as a subquery."""
    own = _own_ids(entity_type, entity_id)
    return select(*_cols(edges_t, "id, from_node_id, to_node_id, edge_type, schema_property, "
                                  "weight")) \
        .where(or_(edges_t.c.from_node_id.in_(own), edges_t.c.to_node_id.in_(own)))


def external_nodes_stmt(entity_type: str, entity_id: str) -> Any:
    """Nodes at the other end of those edges that aren't the entity's own active nodes."""
    own = _own_ids(entity_type, entity_id)
    e = edges_t.c
    ends = union(select(e.from_node_id.label("id")).where(or_(e.from_node_id.in_(own),
                                                               e.to_node_id.in_(own))),
                 select(e.to_node_id.label("id")).where(or_(e.from_node_id.in_(own),
                                                             e.to_node_id.in_(own))))
    return select(*_cols(nodes_t, NODE_COLS)) \
        .where(nodes_t.c.id.in_(select(ends.subquery().c.id)), nodes_t.c.id.not_in(own))


def expertise_side_stmts(entity_type: str, entity_id: str, org_id: str | None) -> dict[str, Any]:
    """The capped side reads: score, review count, the office/parent org and the brand above it."""
    s = scores_t.c
    stmts: dict[str, Any] = {
        "score": select(s.total_score, s.max_possible, s.local_rank, s.local_rank_of)
        .where(s.entity_type == entity_type, s.entity_id == entity_id).limit(2),
        "reviewCount": select(func.count().label("count"))
        .select_from(reviews_t).where(reviews_t.c.entity_id == entity_id),
    }
    if org_id:
        o = org_t.c
        stmts["org"] = select(o.id, o.name, o.slug, o.parent_org_id).where(o.id == org_id).limit(2)
        # the brand above it: the org's parent_org_id, resolved in SQL (one round trip)
        office = org_t.alias("office")
        stmts["brand"] = select(o.id, o.name, o.slug).where(
            o.id == select(office.c.parent_org_id).where(office.c.id == org_id).scalar_subquery()
        ).limit(2)
    return stmts


def expertise_graph(conn: psycopg.Connection, kind: str, slug: str) -> dict[str, Any] | None:
    """The rows behind loadExpertiseGraph(); None when the slug resolves to nothing. Node, edge
    and external-node reads are uncapped (ruling 2026-10-24); a failed side read is no rows."""
    # resolveEntity() ignored errors (no entity); the uncapped reads below raise instead
    entity = single(fetch_many(conn, {"e": expertise_entity_stmt(kind, slug)}, tolerant=True)["e"])
    if entity is None:
        return None
    etype = "professional" if kind == "professional" else "organization"
    eid = str(entity["id"])
    org_id = entity.get("primary_org_id" if kind == "professional" else "parent_org_id")
    side = fetch_many(conn, expertise_side_stmts(etype, eid, org_id), tolerant=True)
    org = single(side.get("org", []))
    brand = single(side["brand"]) if org and org.get("parent_org_id") else None
    own = fetch_all(conn, own_nodes_stmt(etype, eid), max_rows=None)
    edges = fetch_all(conn, edges_stmt(etype, eid), max_rows=None) if own else []
    external = fetch_all(conn, external_nodes_stmt(etype, eid), max_rows=None) if edges else []
    count = side["reviewCount"]
    return {
        "entity": entity,
        "ownRows": own,
        "score": single(side["score"]),
        "reviewCount": count[0]["count"] if count else None,
        "org": org,
        "brand": brand,
        "edges": edges,
        "external": external,
    }
