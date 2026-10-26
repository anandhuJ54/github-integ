"""The Demand engine /website CMS — port of the supabase-js calls in
surface-ui/marketing/src/lib/website.ts
(the loaders and `webMutations`), used by routes/_authenticated/website.*.tsx and
components/website/template-manager.tsx.

Runs as the signed-in user, so RLS decides exactly as it did for the browser. Reads keep the
PostgREST shape (select("*") → every column, the 1000-row cap, `.maybeSingle()` → one object or
null). Every loader but `page_templates` ignored its error (`res.data ?? []`): those come back
[] / null on a database error, as the page saw them.

The writes are the browser's statements, ported as they were: same table, same columns, same
filter by id / ids / "default". `updated_at` / `published_at` / `deleted_at` / `assigned_at`,
which the browser stamped with `new Date().toISOString()`, are stamped with the server's clock.
The page-from-template and duplicate flows keep their two steps (read the taken slugs, error
ignored; then insert).

Moved from xmp (xmp/queries/website.py), surface audit 2026-10-25 (the Demand engine belongs to
marketing). Same SQL.
"""
from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

import psycopg
from psycopg.types.json import Jsonb
from sqlalchemy import select
from sqlalchemy.sql import ClauseElement

from _base.db import tables as T
from _base.db.sql import compile_sql, fetch_all, fetch_many, jsonish

_log = logging.getLogger(__name__)

pages = T.t_exp_web_pages
templates = T.t_exp_web_page_templates
forms = T.t_exp_web_forms
leads = T.t_exp_web_leads
trust = T.t_exp_web_trust_items
consent_cfg = T.t_exp_web_consent_config
consent_ev = T.t_exp_web_consent_events
alerts = T.t_exp_web_alerts
ads = T.t_exp_web_ads
campaigns = T.t_exp_web_campaigns
media = T.t_exp_web_media
reps = T.t_exp_sales_reps

# jsonb columns: psycopg adapts a dict / list only when wrapped (a list would become an array)
JSON_COLS = {"body", "page_settings", "fields", "creative", "utm"}


# --- helpers ---------------------------------------------------------------------------------

class MultipleRows(ValueError):
    """`.single()` / `.maybeSingle()` matched the wrong number of rows: PostgREST answered 406,
    which the page threw. (Copied from xmp/queries/common.py with the move.)"""

    message = "JSON object requested, multiple (or no) rows returned"


def now() -> datetime:
    """The browser's `new Date().toISOString()`, from the server's clock."""
    return datetime.now(UTC)


def jsonb(values: dict[str, Any]) -> dict[str, Any]:
    """`values` with the jsonb columns wrapped for psycopg. A JSON null stays SQL NULL, as
    PostgREST stored it."""
    return {k: Jsonb(v) if k in JSON_COLS and v is not None else v for k, v in values.items()}


def soft_all(conn: psycopg.Connection, stmt: ClauseElement) -> list[dict[str, Any]]:
    """A read whose error the page ignored (`res.data ?? []`): [] on a database error."""
    return fetch_many(conn, {"r": stmt}, tolerant=True)["r"]


def one_of(rows: list[dict[str, Any]] | None) -> dict[str, Any] | None:
    """`.maybeSingle()` whose error the page ignored: the row when exactly one matched."""
    return rows[0] if rows and len(rows) == 1 else None


def execute(conn: psycopg.Connection, stmt: ClauseElement) -> list[dict[str, Any]]:
    """Run a write; the RETURNING rows (PostgREST-shaped) when it has a RETURNING clause."""
    sql, params = compile_sql(stmt)
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return [jsonish(dict(r)) for r in cur.fetchall()] if cur.description else []


def insert(table: Any, values: dict[str, Any]) -> ClauseElement:
    # inline(): no implicit `RETURNING id` (the browser's insert had no .select())
    return table.insert().inline().values(**jsonb(values))


def update(table: Any, row_id: str, values: dict[str, Any]) -> ClauseElement:
    return table.update().where(table.c.id == row_id).values(**jsonb(values))


def delete(conn: psycopg.Connection, table: Any, row_id: str) -> None:
    execute(conn, table.delete().where(table.c.id == row_id))


def free_slug(taken: set[Any], base: str) -> str:
    """The page's `let slug = base; let n = 2; while (taken.has(slug)) slug = `${base}-${n++}``."""
    slug, n = base, 2
    while slug in taken:
        slug, n = f"{base}-{n}", n + 1
    return slug


def taken_slugs(conn: psycopg.Connection, base: str, page_type: str | None = None) -> set[Any]:
    """`select("slug").like("slug", `${base}%`)` (+ `.eq("page_type", …)`), error ignored.
    PostgREST reads `*` in a like pattern as `%`."""
    stmt = select(pages.c.slug).where(pages.c.slug.like(f"{base}%".replace("*", "%")))
    if page_type is not None:
        stmt = stmt.where(pages.c.page_type == page_type)
    return {r["slug"] for r in soft_all(conn, stmt)}


# --- loaders ---------------------------------------------------------------------------------

def load_pages(conn: psycopg.Connection) -> list[dict[str, Any]]:
    return soft_all(conn, select(pages).where(pages.c.deleted_at.is_(None))
                    .order_by(pages.c.updated_at.desc()).limit(500))


def load_deleted_pages(conn: psycopg.Connection) -> list[dict[str, Any]]:
    return soft_all(conn, select(pages).where(pages.c.deleted_at.is_not(None))
                    .order_by(pages.c.deleted_at.desc()).limit(500))


def load_deleted_templates(conn: psycopg.Connection) -> list[dict[str, Any]]:
    return soft_all(conn, select(templates).where(templates.c.deleted_at.is_not(None))
                    .order_by(templates.c.deleted_at.desc()))


def load_templates(conn: psycopg.Connection) -> list[dict[str, Any]]:
    """loadPageTemplates threw its error: the one strict loader."""
    return fetch_all(conn, select(templates).where(templates.c.deleted_at.is_(None))
                     .order_by(templates.c.updated_at.desc()))


def load_forms(conn: psycopg.Connection) -> list[dict[str, Any]]:
    return soft_all(conn, select(forms).order_by(forms.c.created_at.desc()))


def load_leads(conn: psycopg.Connection) -> list[dict[str, Any]]:
    return soft_all(conn, select(leads).order_by(leads.c.created_at.desc()).limit(1000))


def load_trust(conn: psycopg.Connection) -> list[dict[str, Any]]:
    return soft_all(conn, select(trust).order_by(trust.c.sort_order.asc()))


def load_consent(conn: psycopg.Connection) -> dict[str, Any]:
    """Both reads in one round trip; each error ignored (events [], config null)."""
    r = fetch_many(conn, {
        "events": select(consent_ev).order_by(consent_ev.c.created_at.desc()).limit(1000),
        "config": select(consent_cfg).where(consent_cfg.c.id == "default"),
    }, tolerant=True)
    return {"events": r["events"], "config": one_of(r["config"])}


def load_alerts(conn: psycopg.Connection) -> list[dict[str, Any]]:
    return soft_all(conn, select(alerts).order_by(alerts.c.created_at.desc()))


def load_ads(conn: psycopg.Connection) -> list[dict[str, Any]]:
    return soft_all(conn, select(ads).order_by(ads.c.created_at.desc()))


def load_campaigns(conn: psycopg.Connection) -> list[dict[str, Any]]:
    return soft_all(conn, select(campaigns).order_by(campaigns.c.created_at.desc()))


def load_media(conn: psycopg.Connection) -> list[dict[str, Any]]:
    return soft_all(conn, select(media).order_by(media.c.created_at.desc()))


def load_sellers(conn: psycopg.Connection) -> list[dict[str, Any]]:
    return soft_all(conn, select(reps.c.id, reps.c.name, reps.c.role)
                    .order_by(reps.c.name.asc()).limit(500))


# --- CMS pages -------------------------------------------------------------------------------

def create_page(conn: psycopg.Connection, v: dict[str, Any]) -> None:
    execute(conn, insert(pages, {**v, "status": "draft", "body": {}}))


def update_page(conn: psycopg.Connection, page_id: str, patch: dict[str, Any]) -> None:
    """updatePage / applyPageTemplate / appendSectionTemplate / setPageDesignTag: the sent
    columns plus `updated_at`."""
    execute(conn, update(pages, page_id, {**patch, "updated_at": now()}))


def publish_page(conn: psycopg.Connection, page_id: str, updated_by: str | None) -> None:
    t = now()
    execute(conn, update(pages, page_id, {"status": "published", "published_at": t,
                                          "updated_at": t, "updated_by": updated_by}))


def unpublish_page(conn: psycopg.Connection, page_id: str) -> None:
    execute(conn, update(pages, page_id, {"status": "draft", "updated_at": now()}))


def trash_page(conn: psycopg.Connection, page_id: str, deleted_by: str | None) -> None:
    execute(conn, update(pages, page_id, {"deleted_at": now(), "deleted_by": deleted_by}))


def restore_page(conn: psycopg.Connection, page_id: str) -> None:
    execute(conn, update(pages, page_id, {"deleted_at": None, "deleted_by": None,
                                          "status": "draft"}))


def purge_page(conn: psycopg.Connection, page_id: str) -> None:
    delete(conn, pages, page_id)


def set_page_template(conn: psycopg.Connection, page_id: str, template_id: str | None) -> None:
    execute(conn, update(pages, page_id, {"template_id": template_id}))


def duplicate_page(conn: psycopg.Connection, slug_base: str, v: dict[str, Any]) -> None:
    """duplicatePage: the taken `<base>%` slugs of the same page type, then the copy's insert."""
    slug = free_slug(taken_slugs(conn, slug_base, v["page_type"]), slug_base)
    execute(conn, insert(pages, {**v, "slug": slug, "status": "draft"}))


def page_from_template(conn: psycopg.Connection, slug_base: str,
                       v: dict[str, Any]) -> dict[str, Any] | None:
    """createPageFromTemplate: the taken `<base>%` slugs (any type), then insert … RETURNING *."""
    slug = free_slug(taken_slugs(conn, slug_base), slug_base)
    rows = execute(conn, insert(pages, {**v, "slug": slug, "status": "draft"}).returning(pages))
    return rows[0] if rows else None


def _bulk(conn: psycopg.Connection, ids: list[str], values: dict[str, Any]) -> None:
    execute(conn, pages.update().where(pages.c.id.in_(ids)).values(**values))


def bulk_publish(conn: psycopg.Connection, ids: list[str], updated_by: str | None) -> None:
    t = now()
    _bulk(conn, ids, {"status": "published", "published_at": t, "updated_at": t,
                      "updated_by": updated_by})


def bulk_unpublish(conn: psycopg.Connection, ids: list[str]) -> None:
    _bulk(conn, ids, {"status": "draft", "updated_at": now()})


def bulk_trash(conn: psycopg.Connection, ids: list[str], deleted_by: str | None) -> None:
    _bulk(conn, ids, {"deleted_at": now(), "deleted_by": deleted_by})


# --- CMS templates ---------------------------------------------------------------------------

def create_template(conn: psycopg.Connection, v: dict[str, Any]) -> dict[str, Any] | None:
    """insert(v).select("*").single()."""
    rows = execute(conn, templates.insert().values(**jsonb(v)).returning(templates))
    return rows[0] if rows else None


def rename_template(conn: psycopg.Connection, template_id: str, name: str) -> None:
    execute(conn, update(templates, template_id, {"name": name}))


def trash_template(conn: psycopg.Connection, template_id: str, deleted_by: str | None) -> None:
    execute(conn, update(templates, template_id, {"deleted_at": now(), "deleted_by": deleted_by}))


def restore_template(conn: psycopg.Connection, template_id: str) -> None:
    execute(conn, update(templates, template_id, {"deleted_at": None, "deleted_by": None}))


def purge_template(conn: psycopg.Connection, template_id: str) -> None:
    delete(conn, templates, template_id)


# --- forms, leads, trust, consent, alerts, ads, campaigns, media -----------------------------

def create_form(conn: psycopg.Connection, v: dict[str, Any]) -> None:
    execute(conn, insert(forms, {**v, "active": True}))


def update_row(conn: psycopg.Connection, table: Any, row_id: str, patch: dict[str, Any]) -> None:
    """`.update(patch).eq("id", id)` with the sent columns."""
    if patch:
        execute(conn, update(table, row_id, patch))


def set_lead_status(conn: psycopg.Connection, lead_id: str, status: str) -> None:
    execute(conn, update(leads, lead_id, {"status": status}))


def assign_lead(conn: psycopg.Connection, lead_id: str, assigned_to: str | None) -> None:
    execute(conn, update(leads, lead_id, {"assigned_to": assigned_to,
                                          "assigned_at": now() if assigned_to else None}))


def create_trust_item(conn: psycopg.Connection, v: dict[str, Any]) -> None:
    execute(conn, insert(trust, v))


def update_trust_item(conn: psycopg.Connection, item_id: str, patch: dict[str, Any]) -> None:
    execute(conn, update(trust, item_id, {**patch, "updated_at": now()}))


def save_consent_config(conn: psycopg.Connection, patch: dict[str, Any]) -> None:
    execute(conn, consent_cfg.update().where(consent_cfg.c.id == "default")
            .values(**patch, updated_at=now()))


def create_alert(conn: psycopg.Connection, v: dict[str, Any]) -> None:
    execute(conn, insert(alerts, {**v, "active": True}))


def create_ad(conn: psycopg.Connection, v: dict[str, Any]) -> None:
    execute(conn, insert(ads, {**v, "status": "draft", "spend": 0}))


def create_campaign(conn: psycopg.Connection, v: dict[str, Any]) -> None:
    execute(conn, insert(campaigns, {**v, "status": "draft", "assigned_profiles": 0}))


def create_media(conn: psycopg.Connection, v: dict[str, Any]) -> None:
    execute(conn, insert(media, v))
