"""graph /categories pages — port of the supabase-js calls in surface-ui/graph:
routes/_authenticated/categories.index.tsx, categories.$gcid.tsx, the category tabs
(components/{ai-config,compliance,listings,node-registry,operations,schema,scoring,taxonomy}-tab.tsx)
and lib/listings/catalog.ts.

Runs as the signed-in user, so RLS decides exactly as it did for the browser. Reads keep the
PostgREST shape (select("*") → every column, the 1000-row cap, `.maybeSingle()` → one object or
null). The writes are the browser's statements, ported as they were (ruling 2026-10-24, "modify
as it is"): same table, same columns, same filter by id / gcid — no proposals routing, no extra
checks. Where the page ignored a call's error, the port does too (see `soft_many`, `soft`).
"""
from __future__ import annotations

import logging
from typing import Any, Literal

import psycopg
from psycopg.types.json import Jsonb
from sqlalchemy import func, or_, select
from sqlalchemy.sql import ClauseElement

from _base.core.sql import capped, compile_sql, fetch_all, fetch_many, jsonish
from _base.schema import tables as T

_log = logging.getLogger(__name__)

cat = T.t_gbp_categories

SortKey = Literal["display_name", "gcid", "entity_type", "status", "estimated_profiles",
                  "estimated_locations"]


class MultipleRows(Exception):
    """`.maybeSingle()` on more than one row: supabase-js returned an error (PGRST116)."""

    message = "JSON object requested, multiple (or no) rows returned"


# --- helpers ---------------------------------------------------------------------------------

def maybe_single(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    """`.maybeSingle()` whose error the page threw: the row, None, or MultipleRows."""
    if len(rows) > 1:
        raise MultipleRows(MultipleRows.message)
    return rows[0] if rows else None


def one_of(rows: list[dict[str, Any]] | None) -> dict[str, Any] | None:
    """`.maybeSingle()` whose error the page ignored: the row when exactly one matched."""
    return rows[0] if rows and len(rows) == 1 else None


def soft_many(conn: psycopg.Connection,
              stmts: dict[str, ClauseElement]) -> dict[str, list[dict[str, Any]] | None]:
    """Independent reads in one round trip; a failed one is None (the page's `x.data` on error).

    Tries the batch in one pipeline; when any statement fails, reruns each in a savepoint so
    one failure doesn't lose the others."""
    try:
        return dict(fetch_many(conn, stmts))
    except psycopg.Error:
        pass  # fetch_many left the transaction usable
    out: dict[str, list[dict[str, Any]] | None] = {}
    for k, stmt in stmts.items():
        sql, params = compile_sql(capped(stmt))
        try:
            with conn.transaction(), conn.cursor() as cur:
                cur.execute(sql, params)
                out[k] = [jsonish(dict(r)) for r in cur.fetchall()]
        except psycopg.Error as exc:
            _log.warning("graph categories: %r failed, returning null: %s", k,
                         exc.diag.message_primary if exc.diag else exc)
            out[k] = None
    return out


def execute(conn: psycopg.Connection, stmt: ClauseElement) -> None:
    sql, params = compile_sql(stmt)
    with conn.cursor() as cur:
        cur.execute(sql, params)


def soft(conn: psycopg.Connection, stmt: ClauseElement) -> bool:
    """A write whose error the page ignored (the audit_log inserts): savepoint, False on error."""
    try:
        with conn.transaction():
            execute(conn, stmt)
        return True
    except psycopg.Error as exc:
        _log.warning("graph categories: ignored write error (as the page did): %s",
                     exc.diag.message_primary if exc.diag else exc)
        return False


def each_committed(conn: psycopg.Connection, stmts: list[ClauseElement]) -> None:
    """Writes the page sent one request at a time, stopping at the first error: the ones before
    the failure stay written (each was its own request), so commit them before re-raising."""
    for stmt in stmts:
        try:
            with conn.transaction():
                execute(conn, stmt)
        except psycopg.Error:
            conn.commit()
            raise


def audit(conn: psycopg.Connection, action: str, entity_type: str, entity_id: str,
          *, has_metadata: bool = False) -> None:
    """`await supabase.from("audit_log").insert({...})`, error ignored.

    audit_log has no `metadata` column: PostgREST rejected the inserts that sent one (PGRST204)
    before they reached the database, so those wrote nothing — and still write nothing here.
    entity_id is a uuid column: an insert with a gcid there fails in Postgres, ignored as before.
    """
    if has_metadata:
        return
    a = T.t_audit_log
    soft(conn, a.insert().inline().values(action=action, entity_type=entity_type, entity_id=entity_id))


# --- categories index ----------------------------------------------------------------------

def stats(conn: psycopg.Connection) -> dict[str, int]:
    """fetchStats(): exact counts (four head-count requests → one statement)."""
    c = cat.c
    row = fetch_many(conn, {"s": select(
        func.count().label("total"),
        func.count().filter(c.status == "active").label("active"),
        func.count().filter(c.status == "excluded").label("excluded"),
        func.count().filter(c.is_launched.is_(True)).label("launched"),
    ).select_from(cat)})["s"][0]
    return {k: row[k] or 0 for k in ("total", "active", "excluded", "launched")}


def clean_search(q: str) -> str:
    """The page's `search.trim().replace(/[,%()]/g, "")`."""
    return q.strip().translate({ord(ch): None for ch in ",%()"})


def categories(conn: psycopg.Connection, q: str, sort: SortKey, asc: bool) -> list[dict[str, Any]]:
    """fetchCategories(): select * order by <sort> nulls last limit 500, optional
    `or=(display_name.ilike.%q%,gcid.ilike.%q%)` (PostgREST reads `*` in a like pattern as `%`)."""
    col = cat.c[sort]
    stmt = select(cat).order_by((col.asc() if asc else col.desc()).nulls_last()).limit(500)
    q = clean_search(q)
    if q:
        pat = f"%{q}%".replace("*", "%")
        stmt = stmt.where(or_(cat.c.display_name.ilike(pat), cat.c.gcid.ilike(pat)))
    return fetch_all(conn, stmt)


CHILD_VIEWS: dict[str, tuple[str, ...]] = {
    # categories.index.tsx CategoryRow (tree kids)
    "tree": ("gcid", "display_name", "entity_type", "status", "estimated_profiles",
             "estimated_locations", "supports_single_pro_office"),
    # categories.$gcid.tsx childrenQ
    "detail": ("gcid", "display_name", "entity_type", "estimated_profiles", "estimated_locations"),
}


def children(conn: psycopg.Connection, gcids: list[str], view: str) -> list[dict[str, Any]]:
    c = cat.c
    return fetch_all(conn, select(*(c[k] for k in CHILD_VIEWS[view]))
                     .where(c.gcid.in_(gcids)).order_by(c.display_name.asc()))


# --- category detail (summary loader) ------------------------------------------------------

def detail(conn: psycopg.Connection, gcid: str) -> dict[str, Any]:
    """fetchDetail()'s ten reads, raw: the page computes the counts from them as before.

    Only the category read's error was thrown; every other read's error left `data` null
    (→ `?? []` / null on the page), so those come back null here.

    `groups` is always null: the page's embed `exp_category_groups(name,slug)` has no
    relationship to follow (exp_category_group_memberships has no foreign key to
    exp_category_groups, which has no name/slug columns), so PostgREST answered it with an
    error and the page showed no groups. Ported as that outcome, not re-queried.
    """
    k, cp, n, tx, ui = (T.t_exp_category_knowledge, T.t_exp_category_compliance,
                        T.t_exp_vertical_node_registry, T.t_exp_taxonomy,
                        T.t_exp_category_ui_config)
    d, s = T.t_exp_category_directories, T.t_exp_category_secondaries
    r = soft_many(conn, {
        "category": select(cat).where(cat.c.gcid == gcid),
        "knowledge": select(k).where(k.c.gcid == gcid),
        "compliance": select(cp).where(cp.c.gcid == gcid),
        "nodes": select(n.c.ring, n.c.entity_scope).where(n.c.gcid == gcid),
        "taxonomy": select(tx.c.gcid).where(tx.c.gcid == gcid).limit(1),
        "uiConfigs": select(ui).where(ui.c.gcid == gcid),
        "directories": select(d.c.directory_key, d.c.directory_name, d.c.is_required,
                              d.c.priority, d.c.schema_type, d.c.notes)
        .where(d.c.gcid == gcid).order_by(d.c.priority.asc()),
        "secondaries": select(s.c.secondary_gcid, s.c.relevance, s.c.notes)
        .where(s.c.primary_gcid == gcid).order_by(s.c.relevance.asc()),
        "validation": _validation(gcid),
    })
    if r["category"] is None:  # the one error the page threw: rerun it to raise the real error
        r["category"] = fetch_all(conn, select(cat).where(cat.c.gcid == gcid))
    return {
        "category": maybe_single(r["category"]),
        "knowledge": r["knowledge"],
        "compliance": one_of(r["compliance"]),
        "nodes": r["nodes"],
        "taxonomy": r["taxonomy"],
        "uiConfigs": r["uiConfigs"],
        "directories": r["directories"],
        "secondaries": r["secondaries"],
        "groups": None,
        "validation": r["validation"],
    }


def _validation(gcid: str) -> ClauseElement:
    """rpc exp_validate_category_full(p_gcid) — a read-only set-returning check."""
    fn = func.public.exp_validate_category_full(gcid).table_valued("check_code", "passed", "detail")
    return select(fn.c.check_code, fn.c.passed, fn.c.detail).select_from(fn)


def set_category(conn: psycopg.Connection, gcid: str, patch: dict[str, Any]) -> None:
    """updateCategory: `gbp_categories.update(patch).eq("gcid", gcid)`."""
    if patch:
        execute(conn, cat.update().where(cat.c.gcid == gcid).values(**patch))


# --- compliance tab ------------------------------------------------------------------------

ccr = T.t_content_compliance_rules


def compliance(conn: psycopg.Connection, gcid: str) -> dict[str, Any] | None:
    cp = T.t_exp_category_compliance
    return maybe_single(fetch_all(conn, select(cp).where(cp.c.gcid == gcid)))


def compliance_rules(conn: psycopg.Connection, gcid: str) -> list[dict[str, Any]]:
    return fetch_all(conn, select(ccr).where(ccr.c.gcid == gcid).order_by(ccr.c.rule_name))


def add_rule(conn: psycopg.Connection, payload: dict[str, Any]) -> None:
    execute(conn, ccr.insert().inline().values(**payload))
    audit(conn, "compliance_rule.create", "content_compliance_rules", payload.get("gcid"))


def update_rule(conn: psycopg.Connection, rule_id: str, payload: dict[str, Any]) -> None:
    execute(conn, ccr.update().where(ccr.c.id == rule_id).values(**payload))
    audit(conn, "compliance_rule.update", "content_compliance_rules", rule_id)


def set_rule_active(conn: psycopg.Connection, rule_id: str, is_active: bool) -> None:
    execute(conn, ccr.update().where(ccr.c.id == rule_id).values(is_active=is_active))


def delete_rule(conn: psycopg.Connection, rule_id: str) -> None:
    execute(conn, ccr.delete().where(ccr.c.id == rule_id))


# --- AI config tab -------------------------------------------------------------------------

know = T.t_exp_category_knowledge


def ai_knowledge(conn: psycopg.Connection, gcid: str) -> dict[str, Any] | None:
    return maybe_single(fetch_all(conn, select(know.c.ai_agents).where(know.c.gcid == gcid)))


def ai_compliance(conn: psycopg.Connection, gcid: str) -> dict[str, Any] | None:
    cp = T.t_exp_category_compliance.c
    return maybe_single(fetch_all(conn, select(
        cp.content_restrictions, cp.prohibited_phrases, cp.required_disclaimers,
    ).where(cp.gcid == gcid)))


def set_ai_agents(conn: psycopg.Connection, gcid: str, ai_agents: Any) -> None:
    execute(conn, know.update().where(know.c.gcid == gcid).values(ai_agents=Jsonb(ai_agents)))
    audit(conn, "ai_config.update", "exp_category_knowledge", gcid)


# --- node registry tab ---------------------------------------------------------------------

vnr = T.t_exp_vertical_node_registry


def rings(conn: psycopg.Connection) -> list[dict[str, Any]]:
    r = T.t_exp_rings.c
    return fetch_all(conn, select(r.position, r.ring_key, r.ring_name, r.legacy_key,
                                  r.seo_function, r.schema_types).order_by(r.position.asc()))


def entity_type(conn: psycopg.Connection, gcid: str) -> dict[str, Any] | None:
    """`.maybeSingle()` whose error the page ignored: null when the category has 2 rows."""
    return one_of(fetch_all(conn, select(know.c.entity_type).where(know.c.gcid == gcid)))


def schema_type(conn: psycopg.Connection, gcid: str) -> dict[str, Any] | None:
    st = T.t_exp_category_schema_type.c
    return one_of(fetch_all(conn, select(st.schema_type, st.confidence).where(st.gcid == gcid)))


def schema_ring_map(conn: psycopg.Connection, stype: str) -> list[dict[str, Any]]:
    m = T.t_exp_schema_type_ring_map.c
    return fetch_all(conn, select(m.ring_key, m.schema_property, m.inherited_from)
                     .where(m.schema_type == stype))


def node_registry(conn: psycopg.Connection, gcid: str) -> list[dict[str, Any]]:
    return fetch_all(conn, select(vnr).where(vnr.c.gcid == gcid).order_by(vnr.c.priority.asc()))


def add_node(conn: psycopg.Connection, payload: dict[str, Any]) -> None:
    execute(conn, vnr.insert().inline().values(**payload))


def update_node(conn: psycopg.Connection, node_id: str, payload: dict[str, Any]) -> None:
    execute(conn, vnr.update().where(vnr.c.id == node_id).values(**payload))


def delete_node(conn: psycopg.Connection, node_id: str) -> None:
    execute(conn, vnr.delete().where(vnr.c.id == node_id))


def reorder_nodes(conn: psycopg.Connection, updates: list[dict[str, Any]]) -> None:
    each_committed(conn, [vnr.update().where(vnr.c.id == u["id"]).values(priority=u["priority"])
                          for u in updates])


# --- operations / schema tabs --------------------------------------------------------------

def operation_nodes(conn: psycopg.Connection, gcid: str) -> list[dict[str, Any]]:
    return fetch_all(conn, select(vnr.c.node_name, vnr.c.ring).where(vnr.c.gcid == gcid)
                     .limit(1000))


def stored_schema(conn: psycopg.Connection, gcid: str) -> dict[str, Any] | None:
    s = T.t_exp_category_schema.c
    return one_of(fetch_all(conn, select(s.schema_json, s.model).where(s.gcid == gcid)))


def schema_registry(conn: psycopg.Connection, gcid: str) -> list[dict[str, Any]]:
    c = vnr.c
    return fetch_all(conn, select(c.node_name, c.ring, c.entity_scope, c.connection_method,
                                  c.schema_type, c.schema_property, c.required_for_score,
                                  c.priority)
                     .where(c.gcid == gcid, c.is_active.is_(True)))


# --- listings tab + catalog ----------------------------------------------------------------

def listings(conn: psycopg.Connection, gcid: str) -> dict[str, Any]:
    """Three reads whose errors the page ignored (null → the static fallback)."""
    o, x, s = (T.t_exp_listings_overlays.c, T.t_exp_listings_crosswalk.c,
               T.t_exp_listings_category_status.c)
    return soft_many(conn, {
        "overlays": select(o.overlay).where(o.gcid == gcid),
        "crosswalk": select(x.publisher_id, x.code, x.label, x.breadcrumb, x.confidence)
        .where(x.gcid == gcid),
        "status": select(s.family, s.present).where(s.gcid == gcid),
    })


def catalog(conn: psycopg.Connection, catalog_version: str) -> dict[str, Any]:
    """fetchCatalogs(): publishers + field map rows (null on error → the page's fallback)."""
    p, f = T.t_exp_listings_publishers.c, T.t_exp_listings_field_map.c
    return soft_many(conn, {
        "publishers": select(p.id, p.name, p.kind, p.subtitle, p.publishes_to, p.ops_notes,
                             p.display_sort, p.channel_role, p.role_status),
        "fieldMap": select(f.publisher_id, f.section, f.section_note, f.their_field,
                           f.our_target, f.rules, f.applicability, f.status_default,
                           f.variant_family, f.sort).where(f.catalog_version == catalog_version),
    })


# --- scoring tab ---------------------------------------------------------------------------

def scoring(conn: psycopg.Connection, gcid: str) -> dict[str, Any]:
    """Six `.maybeSingle()` reads whose errors the page ignored."""
    def one(table: Any, *cols: str) -> ClauseElement:
        return select(*(table.c[k] for k in cols)).where(table.c.gcid == gcid)

    r = soft_many(conn, {
        "ear": one(T.t_exp_category_ear, "ear", "band", "ear_professional", "non_reviewable"),
        "eaa": one(T.t_exp_category_eaa, "eaa", "band", "eaa_professional", "non_authored"),
        "completeness": one(T.t_exp_category_completeness, "total_node_types",
                            "core_node_types", "expected_m"),
        "eaq": one(T.t_exp_category_eaq, "eaq", "band", "eaq_professional", "non_qa"),
        "eav": one(T.t_exp_category_eav, "eav", "band", "eav_professional", "non_video"),
        "category": one(cat, "display_name"),
    })
    return {k: one_of(v) for k, v in r.items()}


# --- taxonomy tab --------------------------------------------------------------------------

tax = T.t_exp_taxonomy
TAXONOMY_COLS = ("id", "gcid", "level", "term", "term_display", "term_slug", "entity_scope",
                 "source", "validated", "priority", "search_intent", "search_volume_monthly",
                 "wikidata_id")


def taxonomy(conn: psycopg.Connection, gcid: str) -> list[dict[str, Any]]:
    return fetch_all(conn, select(*(tax.c[k] for k in TAXONOMY_COLS)).where(tax.c.gcid == gcid)
                     .order_by(tax.c.priority.asc()))


def reorder_taxonomy(conn: psycopg.Connection, gcid: str, updates: list[dict[str, Any]]) -> None:
    each_committed(conn, [tax.update().where(tax.c.id == u["id"]).values(priority=u["priority"])
                          for u in updates])
    audit(conn, "taxonomy.reorder", "exp_taxonomy", gcid, has_metadata=True)


def add_term(conn: psycopg.Connection, payload: dict[str, Any]) -> None:
    execute(conn, tax.insert().inline().values(**payload))
    audit(conn, "taxonomy.create", "exp_taxonomy", payload.get("gcid"), has_metadata=True)


def update_term(conn: psycopg.Connection, term_id: str, payload: dict[str, Any]) -> None:
    execute(conn, tax.update().where(tax.c.id == term_id).values(**payload))
    audit(conn, "taxonomy.update", "exp_taxonomy", term_id, has_metadata=True)


def delete_term(conn: psycopg.Connection, term_id: str) -> None:
    execute(conn, tax.delete().where(tax.c.id == term_id))
    audit(conn, "taxonomy.delete", "exp_taxonomy", term_id)

