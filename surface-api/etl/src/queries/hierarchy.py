"""ETL /discovery hierarchy tab and entity panel — port of the supabase-js calls in
surface-ui/etl/src/components/discovery/{hierarchy-data.ts,hierarchy-tab.tsx,
entity-detail-panel.tsx}.

The page used PostgREST embeds with filters on the embedded rows; their meaning is rebuilt here:
- `alias:exp_rel!subject_fk!inner(cols)` + `alias.x=eq.v` filters: only entities with a matching
  relationship (EXISTS), and the matching relationships come back as the `alias` array;
- the same without `!inner`: every entity, `alias` holds the matching relationships (maybe []);
- `alias.not.is.null` / `.is(alias, null)`: the filtered embed is non-empty / empty;
- `obj:exp_entity!object_fk(cols)`: the related entity as an object, or null.
Runs as the signed-in user; exp_entity / exp_rel are readable to it (RLS).
"""
from __future__ import annotations

import re
from typing import Any

import psycopg
from sqlalchemy import exists, func, not_, or_, select
from surfaces.etl.queries.common import fetch_many, json_row, json_rows, one_of

from _base.db import tables as T
from _base.db.sql import MAX_ROWS

ent, rel = T.t_exp_entity, T.t_exp_rel
PAGE_SIZE = 50
ENTITY_COLS = ("entity_id", "entity_type", "display_name", "confidence", "claim_state", "source",
               "status", "created_at")
SORT_COLS = {"name": "display_name", "type": "entity_type", "confidence": "confidence",
             "created": "created_at"}
REL_TYPES = ("WORKS_AT", "REPRESENTS", "OPERATES_UNDER", "FRANCHISE_OF", "CLASSIFIED_AS",
             "BASED_AT", "MEMBER_OF", "SERVES_AREA")
PAGE_REL_TYPES = ("CLASSIFIED_AS", "WORKS_AT", "REPRESENTS", "OPERATES_UNDER")


def _r():
    """A fresh alias of exp_rel for one embed."""
    return rel.alias()


def _rel_match(r: Any, rel_types: tuple[str, ...] | str, obj: dict[str, Any]) -> list[Any]:
    types = (rel_types,) if isinstance(rel_types, str) else rel_types
    conds = [r.c.subject_entity_id == ent.c.entity_id, r.c.status == "current",
             r.c.relationship_type.in_(types)]
    conds += [r.c[k] == v for k, v in obj.items()]
    return conds


def _embed(alias: str, r: Any, where: list[Any], col: str) -> Any:
    return json_rows({col: r.c[col]}, where, r).label(alias)


def _clean(term: str, chars: str) -> str:
    return re.sub(f"[{re.escape(chars)}]", " ", term)


def entity_query(f: dict[str, Any], *, type_override: Any = ...) -> tuple[list[Any], list[Any]]:
    """entityQuery(): (embed columns, where clauses) for the filters."""
    cols: list[Any] = []
    where: list[Any] = [ent.c.status != "merged", ent.c.is_demo.is_(False)]
    if f.get("gcid"):
        r = _r()
        m = _rel_match(r, "CLASSIFIED_AS", {"object_gcid": f["gcid"]})
        cols.append(_embed("cls", r, m, "object_gcid"))
        where.append(exists(select(1).select_from(r).where(*m)))
    if f.get("brand"):
        r = _r()
        m = _rel_match(r, ("OPERATES_UNDER", "REPRESENTS"), {"object_entity_id": f["brand"]})
        cols.append(_embed("br", r, m, "object_entity_id"))
        where.append(or_(ent.c.entity_id == f["brand"], exists(select(1).select_from(r).where(*m))))
    if f.get("office"):
        r = _r()
        m = _rel_match(r, "WORKS_AT", {"object_entity_id": f["office"]})
        cols.append(_embed("of", r, m, "object_entity_id"))
        where.append(exists(select(1).select_from(r).where(*m)))
    if f.get("source"):
        where.append(ent.c.source == f["source"])
    t = f.get("type") if type_override is ... else type_override
    if t:
        where.append(ent.c.entity_type == t)
    if f.get("claim"):
        where.append(ent.c.claim_state == f["claim"])
    if f.get("q"):
        where.append(ent.c.display_name.ilike(f"%{_clean(f['q'], '%_,()')}%"))
    return cols, where


def _incoming_count(object_id: Any, rel_type: str) -> Any:
    return select(func.count()).select_from(rel).where(
        rel.c.object_entity_id == object_id, rel.c.relationship_type == rel_type,
        rel.c.status == "current").scalar_subquery()


def gcid_labels(conn: psycopg.Connection, gcids: list[str]) -> dict[str, str]:
    uniq = list(dict.fromkeys(g for g in gcids if g))
    if not uniq:
        return {}
    c = T.t_gbp_categories.c
    rows = fetch_many(conn, {"l": select(c.gcid, c.display_name).where(c.gcid.in_(uniq))
                             .limit(len(uniq))})["l"]
    return {r["gcid"]: r["display_name"] for r in rows}


# --- filter options ----------------------------------------------------------------------------

def sources(conn: psycopg.Connection) -> dict[str, Any]:
    s = T.t_exp_etl_sources.c
    rows = fetch_many(conn, {"s": select(s.source_domain, s.gcid).limit(2000)})["s"]
    return {"rows": rows, "labels": gcid_labels(conn, [r["gcid"] or "" for r in rows])}


def category_search(conn: psycopg.Connection, term: str) -> list[dict[str, Any]]:
    c = T.t_gbp_categories.c
    t = _clean(term, "%_,()*")
    return fetch_many(conn, {"c": select(c.gcid, c.display_name)
                             .where(or_(c.display_name.ilike(f"%{t}%"), c.gcid.ilike(f"%{t}%")))
                             .limit(20)})["c"]


def brands(conn: psycopg.Connection) -> list[dict[str, Any]]:
    return fetch_many(conn, {"b": select(ent.c.entity_id, ent.c.display_name)
                             .where(ent.c.entity_type == "brand", ent.c.status != "merged",
                                    ent.c.is_demo.is_(False))
                             .order_by(ent.c.display_name).limit(500)})["b"]


# --- the entity table ---------------------------------------------------------------------------

def table(conn: psycopg.Connection, f: dict[str, Any], page: int, sort: str,
          direction: str) -> dict[str, Any]:
    embeds, where = entity_query(f)
    col = ent.c[SORT_COLS.get(sort, "created_at")]
    order = col.asc().nulls_last() if direction == "asc" else col.desc().nulls_last()
    start = (page - 1) * PAGE_SIZE
    r = fetch_many(conn, {
        "rows": select(*(ent.c[k] for k in ENTITY_COLS), *embeds).where(*where)
        .order_by(order, ent.c.entity_id).offset(start).limit(PAGE_SIZE),
        "total": select(func.count().label("n")).select_from(ent).where(*where),
    })
    rows = r["rows"]
    ids = [x["entity_id"] for x in rows]
    rels: list[dict[str, Any]] = []
    counts: dict[str, int] = {}
    if ids:
        o = ent.alias()
        page_rels = select(
            rel.c.subject_entity_id, rel.c.relationship_type, rel.c.object_entity_id,
            rel.c.object_gcid,
            json_row({"display_name": o.c.display_name},
                     [o.c.entity_id == rel.c.object_entity_id], o).label("obj"),
        ).where(rel.c.subject_entity_id.in_(ids), rel.c.relationship_type.in_(PAGE_REL_TYPES),
                rel.c.status == "current").limit(MAX_ROWS)
        hubs = [x for x in rows if x["entity_type"] in ("location", "brand")]
        stmts: dict[str, Any] = {"rels": page_rels}
        for x in hubs:
            kind = "WORKS_AT" if x["entity_type"] == "location" else "REPRESENTS"
            stmts[x["entity_id"]] = select(_incoming_count(x["entity_id"], kind).label("n"))
        got = fetch_many(conn, stmts)
        rels = got.pop("rels")
        counts = {k: v[0]["n"] for k, v in got.items()}
    labels = gcid_labels(conn, [x["object_gcid"] or "" for x in rels
                                if x["relationship_type"] == "CLASSIFIED_AS"])
    return {"rows": rows, "total": r["total"][0]["n"], "rels": rels, "labels": labels,
            "counts": counts}


def type_counts(conn: psycopg.Connection, f: dict[str, Any]) -> dict[str, int]:
    out = {}
    stmts = {}
    for t in ("brand", "location", "professional"):
        if f.get("type") and f["type"] != t:
            out[t] = 0
            continue
        _, where = entity_query(f, type_override=t)
        stmts[t] = select(func.count().label("n")).select_from(ent).where(*where)
    for t, rows in fetch_many(conn, stmts).items():
        out[t] = rows[0]["n"]
    return {"brand": out["brand"], "location": out["location"],
            "professional": out["professional"]}


# --- the tree view ---------------------------------------------------------------------------

def _paged(conn: psycopg.Connection, embeds: list[Any], where: list[Any], page: int,
           with_advisors: bool = False) -> dict[str, Any]:
    start = (page - 1) * PAGE_SIZE
    cols = [*(ent.c[k] for k in ENTITY_COLS), *embeds]
    if with_advisors:
        cols.append(_incoming_count(ent.c.entity_id, "WORKS_AT").label("advisors"))
    r = fetch_many(conn, {
        "rows": select(*cols).where(*where).order_by(ent.c.display_name, ent.c.entity_id)
        .offset(start).limit(PAGE_SIZE),
        "total": select(func.count().label("n")).select_from(ent).where(*where),
    })
    return {"rows": r["rows"], "total": r["total"][0]["n"]}


def tree_advisors(conn: psycopg.Connection, office: str | None, unofficed_brand: str | None,
                  page: int) -> dict[str, Any]:
    base = [ent.c.entity_type == "professional", ent.c.status != "merged",
            ent.c.is_demo.is_(False)]
    r = _r()
    if office:
        m = _rel_match(r, "WORKS_AT", {"object_entity_id": office})
        return _paged(conn, [_embed("r", r, m, "object_entity_id")],
                      [*base, exists(select(1).select_from(r).where(*m))], page)
    m = _rel_match(r, "REPRESENTS", {"object_entity_id": unofficed_brand})
    w = _r()
    wm = _rel_match(w, "WORKS_AT", {})
    return _paged(conn, [_embed("r", r, m, "object_entity_id"),
                         _embed("w", w, wm, "object_entity_id")],
                  [*base, exists(select(1).select_from(r).where(*m)),
                   not_(exists(select(1).select_from(w).where(*wm)))], page)


def tree_offices(conn: psycopg.Connection, brand: str, page: int) -> dict[str, Any]:
    r = _r()
    m = _rel_match(r, "OPERATES_UNDER", {"object_entity_id": brand})
    return _paged(conn, [_embed("r", r, m, "object_entity_id")],
                  [ent.c.status != "merged", ent.c.is_demo.is_(False),
                   exists(select(1).select_from(r).where(*m))], page, with_advisors=True)


def office_name(conn: psycopg.Connection, office: str) -> dict[str, Any] | None:
    return one_of(fetch_many(conn, {"o": select(ent.c.display_name)
                                    .where(ent.c.entity_id == office).limit(2)},
                             tolerant=True)["o"])


# --- entity detail panel ---------------------------------------------------------------------

def entity_detail(conn: psycopg.Connection, entity_id: str) -> dict[str, Any]:
    e = ent.c
    o, s = ent.alias(), ent.alias()
    other = ("entity_id", "display_name", "entity_type")
    stmts: dict[str, Any] = {
        "entity": select(e.entity_id, e.entity_type, e.display_name, e.status, e.claim_state,
                         e.confidence, e.source, e.identity_keys, e.attributes, e.created_at)
        .where(e.entity_id == entity_id).limit(2),
        "out": select(rel.c.relationship_type, rel.c.object_gcid, rel.c.is_primary,
                      json_row({k: o.c[k] for k in other}, [o.c.entity_id == rel.c.object_entity_id],
                               o).label("obj"))
        .where(rel.c.subject_entity_id == entity_id, rel.c.status == "current").limit(200),
        "staged": select(T.t_exp_etl_staging.c.stage_id, T.t_exp_etl_staging.c.payload,
                         T.t_exp_etl_staging.c.field_tier, T.t_exp_etl_staging.c.observed_at,
                         T.t_exp_etl_staging.c.detail_url)
        .where(T.t_exp_etl_staging.c.entity_id == entity_id)
        .order_by(T.t_exp_etl_staging.c.observed_at.desc().nulls_last()).limit(5),
    }
    incoming_types = [t for t in REL_TYPES if t != "CLASSIFIED_AS"]
    for t in incoming_types:
        match = [rel.c.object_entity_id == entity_id, rel.c.relationship_type == t,
                 rel.c.status == "current"]
        stmts[f"in:{t}"] = select(json_row({k: s.c[k] for k in other},
                                           [s.c.entity_id == rel.c.subject_entity_id], s)
                                  .label("subj")).where(*match).limit(20)
        stmts[f"n:{t}"] = select(func.count().label("n")).select_from(rel).where(*match)
    r = fetch_many(conn, stmts)
    # the TS read the entity with .maybeSingle() and threw on its error: 2+ rows is an error
    if len(r["entity"]) > 1:
        raise psycopg.errors.CardinalityViolation("JSON object requested, multiple rows returned")
    incoming = [{"type": t, "count": r[f"n:{t}"][0]["n"], "rows": [x["subj"] for x in r[f"in:{t}"]]}
                for t in incoming_types]
    return {
        "entity": r["entity"][0] if r["entity"] else None,
        "out": r["out"],
        "outLabels": gcid_labels(conn, [x["object_gcid"] or "" for x in r["out"]]),
        "incoming": [x for x in incoming if x["count"] > 0],
        "staged": r["staged"],
    }

