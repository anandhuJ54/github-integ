"""Public profile pages (/p, /o, /c): the rows behind loadProfessionalBundle / loadOrgBundle in
surface-ui/search/src/lib/profile-render.ts, fetched in one request.

The page logic (fallbacks, merging, JSON-LD) stays in TypeScript; this returns what each of its
supabase-js queries returned, under the same names. Runs as the visitor (`anon`, or the signed-in
user), so RLS is unchanged. Like the TS, a failed side read yields no rows rather than an error,
and `.maybeSingle()` yields nothing when zero or several rows match. Reads that don't depend on
each other go out together in one round trip (fetch_many), as the TS fired them in parallel.
"""
from __future__ import annotations

from typing import Any

import psycopg
from sqlalchemy import select

from _base.db.sql import fetch_many
from _base.db.tables import t_aggregate_ratings as ratings_t
from _base.db.tables import t_content_items as content_t
from _base.db.tables import t_credentials as creds_t
from _base.db.tables import t_exp_category_page_template as template_t
from _base.db.tables import t_exp_category_profile_config as config_t
from _base.db.tables import t_exp_ring as ring_t
from _base.db.tables import t_exp_taxonomy as taxonomy_t
from _base.db.tables import t_gbp_categories as cat_t
from _base.db.tables import t_graph_edges as edges_t
from _base.db.tables import t_graph_nodes as nodes_t
from _base.db.tables import t_media_items as media_t
from _base.db.tables import t_organizations as org_t
from _base.db.tables import t_professionals as pro_t
from _base.db.tables import t_reviews as reviews_t

# EXTRA_NODE_TYPES in profile-render.ts: the node types the page sections read.
EXTRA_NODE_TYPES = (
    "menu_item", "hours", "office_hours", "gallery_image", "listing", "service_area", "service",
    "product_service", "specialty", "social_profile", "profile_link", "profile_attributes",
    "identity_name", "bio", "contact_phone", "contact_email", "website", "image_photo",
    "address", "geo", "office_hours", "team_member", "language", "credential",
)
ORG_COLS = (
    "id", "name", "legal_name", "slug", "description", "logo_url", "cover_photo_url",
    "website_url", "phone", "email", "gcid", "entity_type", "address_street", "address_city",
    "address_state", "address_zip", "latitude", "longitude", "parent_org_id", "search_rank_score",
    "claimed",
)
PRO_COLS = (
    "id", "first_name", "last_name", "display_name", "slug", "headline", "bio", "photo_url",
    "cover_photo_url", "gcid", "job_title", "phone", "email", "website_url", "address_city",
    "address_state", "address_zip", "primary_org_id", "primary_license_number",
    "primary_license_state", "markets_served", "search_rank_score", "local_rank",
    "local_rank_of", "claimed",
)
REVIEW_COLS = (
    "id", "rating", "body", "title", "reviewer_name", "review_date", "source", "reply_body",
    "reply_date", "is_verified", "locations_mentioned",
)


def _batch(conn: psycopg.Connection, stmts: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """Independent reads in one round trip; a failed read is no rows, as in the TS."""
    return fetch_many(conn, stmts, tolerant=True)


def _single(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    """`.maybeSingle()`: the row when exactly one matched (queried with limit 2), else nothing."""
    return rows[0] if len(rows) == 1 else None


def _cols(t: Any, names: tuple[str, ...]) -> list[Any]:
    return [t.c[n] for n in names]


def _keys(gcid: str | None) -> list[str]:
    return [gcid, "default"] if gcid else ["default"]


def org_lane(entity_type: str | None) -> str:
    """orgLane() in profile-render.ts."""
    t = (entity_type or "").lower()
    return "brand" if t in ("company", "brand", "corporate") else "location"


def _org_stmt(org_id: Any) -> Any:
    return select(*_cols(org_t, ORG_COLS)).where(org_t.c.id == str(org_id)).limit(2)


def _shared(entity_type: str, entity_id: str, gcid: str | None, lane: str) -> dict[str, Any]:
    """The reads both bundles make: template, config, label, graph, ratings, reviews, content,
    media, taxonomy."""
    tp, cf, n = template_t.c, config_t.c, nodes_t.c
    stmts: dict[str, Any] = {
        "templateRows": select(tp.gcid, tp.entity_type, tp.sections, tp.required_sections,
                               tp.completeness_floor, tp.hero_cta, tp.schema_type)
        .where(tp.gcid.in_(_keys(gcid)), tp.entity_type == lane),
        "configRows": select(cf.gcid, cf.entity_noun, cf.service_label, cf.credential_label,
                             cf.credential_id_label, cf.cta_label, cf.schema_type,
                             cf.show_prequalify).where(cf.gcid.in_(_keys(gcid))),
        "graphNodes": select(n.node_type, n.title, n.url, n.extracted_data)
        .where(n.entity_type == entity_type, n.entity_id == entity_id, n.is_active.is_(True),
               n.node_type.in_(EXTRA_NODE_TYPES)),
        "ratings": select(ratings_t.c.source, ratings_t.c.rating_value, ratings_t.c.review_count)
        .where(ratings_t.c.entity_type == entity_type, ratings_t.c.entity_id == entity_id),
        "reviews": select(*_cols(reviews_t, REVIEW_COLS))
        .where(reviews_t.c.entity_type == entity_type, reviews_t.c.entity_id == entity_id)
        .order_by(reviews_t.c.review_date.desc()).limit(24),
        "content": select(content_t.c.id, content_t.c.title, content_t.c.slug,
                          content_t.c.excerpt, content_t.c.cover_image_url,
                          content_t.c.published_at)
        .where(content_t.c.author_type == entity_type, content_t.c.author_id == entity_id,
               content_t.c.status == "published")
        .order_by(content_t.c.published_at.desc()).limit(9),
        "media": select(media_t.c.id, media_t.c.title, media_t.c.thumbnail_url,
                        media_t.c.source_url, media_t.c.media_type)
        .where(media_t.c.entity_type == entity_type, media_t.c.entity_id == entity_id,
               media_t.c.is_active.is_(True)).limit(24),
    }
    if gcid:
        stmts["category"] = select(cat_t.c.display_name, cat_t.c.slug) \
            .where(cat_t.c.gcid == gcid).limit(2)
        stmts["taxonomy"] = select(taxonomy_t.c.term, taxonomy_t.c.level) \
            .where(taxonomy_t.c.gcid == gcid,
                   taxonomy_t.c.level.in_(("product_service", "specialization"))) \
            .order_by(taxonomy_t.c.priority.asc()).limit(40)
    return stmts


def _shared_out(rows: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    out = {k: rows[k] for k in ("templateRows", "configRows", "graphNodes", "ratings",
                                "reviews", "content", "media")}
    out["category"] = _single(rows.get("category", []))
    out["taxonomy"] = rows.get("taxonomy", [])
    return out


def professional_raw(conn: psycopg.Connection, slug: str) -> dict[str, Any] | None:
    """Two round trips: the professional, then every other read together. The office, its
    company and the 'recommends' partners are subqueries, so they need no extra trips."""
    pro = _single(_batch(conn, {"pro": select(*_cols(pro_t, PRO_COLS))
                                .where(pro_t.c.slug == slug).limit(2)})["pro"])
    if not pro:
        return None
    pid = pro["id"]
    o, p, c, r, n, e = org_t.c, pro_t.c, creds_t.c, ring_t.c, nodes_t.c, edges_t.c
    stmts = {
        **_shared("professional", pid, pro["gcid"], "professional"),
        "credentials": select(c.id, c.name, c.identifier, c.issuing_org, c.issuing_state,
                              c.verified, c.verification_url)
        .where(c.professional_id == pid, c.is_current.is_(True)),
        # loadProfessionalExpertise: proof rings (exp_ring, kept as the TS read it), proof
        # nodes, 'recommends' edges and the partners' names.
        "rings": select(r.ring_key, r.display_name, r.sort, r.color, r.schema_note)
        .where(r.layer == "proof", r.is_active.is_(True)).order_by(r.sort.asc()),
        "proofNodes": select(n.id, n.ring_key, n.ring_layer, n.node_type, n.title, n.url,
                             n.extracted_data, n.source, n.verified, n.verified_at)
        .where(n.entity_type == "professional", n.entity_id == pid, n.ring_layer == "proof",
               n.is_active.is_(True)),
        "edges": select(e.id, e.to_entity_type, e.to_entity_id, e.relationship_type, e.status,
                        e.verified).where(e.edge_type == "recommends", e.from_entity_id == pid),
        "partnerProfessionals": select(p.id, p.display_name, p.first_name, p.last_name)
        .where(p.id.in_(_partner_ids(pid, "professional"))),
        "partnerOrganizations": select(o.id, o.name)
        .where(o.id.in_(_partner_ids(pid, "organization"))),
    }
    if pro["primary_org_id"]:
        office_id = str(pro["primary_org_id"])
        stmts["office"] = _org_stmt(office_id)
        # the office's parent, read through the same RLS the TS's second query had
        parent_of_office = select(o.parent_org_id).where(o.id == office_id).scalar_subquery()
        stmts["company"] = select(*_cols(org_t, ORG_COLS)) \
            .where(o.id == parent_of_office).limit(2)
    rows = _batch(conn, stmts)
    office = _single(rows.get("office", []))
    return {
        "pro": pro,
        "office": office,
        "company": _single(rows.get("company", [])) if office else None,
        **_shared_out(rows),
        "credentials": rows["credentials"],
        "expertise": {
            "rings": rows["rings"],
            "nodes": rows["proofNodes"],
            "edges": rows["edges"],
            "partnerProfessionals": rows["partnerProfessionals"],
            "partnerOrganizations": rows["partnerOrganizations"],
        },
    }


def _partner_ids(pro_id: str, to_type: str) -> Any:
    e = edges_t.c
    return select(e.to_entity_id).where(e.edge_type == "recommends", e.from_entity_id == pro_id,
                                        e.to_entity_type == to_type, e.to_entity_id.is_not(None))


def org_raw(conn: psycopg.Connection, kind: str, slug: str) -> dict[str, Any] | None:
    org = _single(_batch(conn, {"org": select(*_cols(org_t, ORG_COLS))
                                .where(org_t.c.slug == slug).limit(2)})["org"])
    if not org:
        return None
    lane = "brand" if kind == "c" else org_lane(org["entity_type"])
    o, p = org_t.c, pro_t.c
    stmts = {
        **_shared("organization", org["id"], org["gcid"], lane),
        "children": select(o.id, o.name, o.slug, o.logo_url, o.address_city, o.address_state)
        .where(o.parent_org_id == org["id"], o.is_active.is_(True)).order_by(o.name).limit(60),
        "staff": select(p.id, p.display_name, p.first_name, p.last_name, p.slug, p.photo_url,
                        p.job_title)
        .where(p.primary_org_id == org["id"], p.is_active.is_(True))
        .order_by(p.search_rank_score.desc().nulls_last()).limit(60),
    }
    if org["parent_org_id"]:
        stmts["parent"] = _org_stmt(org["parent_org_id"])
    rows = _batch(conn, stmts)
    return {
        "org": org,
        "parent": _single(rows.get("parent", [])),
        **_shared_out(rows),
        "children": rows["children"],
        "staff": rows["staff"],
    }


def category_label_row(conn: psycopg.Connection, gcid: str) -> dict[str, Any] | None:
    """voce-hub labelFor(): gbp_categories display_name / slug, `.maybeSingle()`."""
    return _single(_batch(conn, {"c": select(cat_t.c.display_name, cat_t.c.slug)
                                 .where(cat_t.c.gcid == gcid).limit(2)})["c"])
