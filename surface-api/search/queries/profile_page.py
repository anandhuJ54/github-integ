"""The long-form professional profile page (/:category/:city/:professional, surface-ui/search) —
the rows each supabase-js query returned, under the same names.

Moved from graph (graph/queries/entities.py), surface audit 2026-10-25 (ruling: profile data
comes from search; only the expertise graph data comes from graph). Same SQL. The page logic
stays in TypeScript. Reads run on the caller's role connection (RLS unchanged) and keep the
1000-row PostgREST cap.
"""
from __future__ import annotations

from typing import Any

import psycopg
from sqlalchemy import or_, select

from _base.core.sql import fetch_all, fetch_many
from _base.schema import tables as T

profile_v = T.t_v_professional_profile
reviews_t, content_t, creds_t = T.t_reviews, T.t_content_items, T.t_credentials
pro_t, org_t, nodes_t = T.t_professionals, T.t_organizations, T.t_graph_nodes
tax_t, tx_t, ratings_t = T.t_exp_taxonomy, T.t_transaction_signals, T.t_aggregate_ratings


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
