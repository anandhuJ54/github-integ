"""disco-staging-backfill — staging schema step 5 (port; docs/ETL-Staging-Data-Schema.md).

Rebuilds identity_candidates.universal of existing exp_etl_staging rows of ONE source from what
each row already holds (its universal values, its payload taxonomy keys and its _extra), with
the same code the harvest uses (build_staging_static). No page fetch, no AI. Top-level
identity_candidates fields are not changed.

dry_run (default true) writes NOTHING and returns before / after counts per static key.
dry_run:false writes one batch (upsert by stage_id) — only after the owner approved the dry-run
numbers.

POST /public/disco-staging-backfill   header x-disco-worker-key
body { domain, gcid, after_stage_id?, limit? (<= 500), dry_run?, routes?, boilerplate_texts? }
"""
from __future__ import annotations

import math
from typing import Any

from fastapi import APIRouter, Request
from psycopg.types.json import Jsonb
from starlette.concurrency import run_in_threadpool

from _base.db.session import role_connection
from _base.disco.agent_engine import js_number, json_stringify
from etl.disco import contract_row as cr
from etl.routers._worker import is_invalid, jresp, read_json, worker_key_ok

router = APIRouter(tags=["etl:disco"])

SUBJECT_BY_LABEL = {"person": "person", "branch": "location", "firm": "firm"}
ACTION_IDS = {"person.actions", "location.actions"}
_STAGE_COLS = ("stage_id, source_id, gcid, entity_type, detail_url, resolution_status, payload, "
               "identity_candidates")


def non_empty(v: Any) -> bool:
    return v is not None and not (isinstance(v, str) and v.strip() == "") and not (
        isinstance(v, list) and not v)


# Fix (backfill keeps stored actions and credentials, 2026-10-13): stored actions go back in as
# page form (label + url); stored credentials keep every entry as stored.
def to_page_value(fid: str, v: Any, action_sep: str) -> Any:
    if fid not in ACTION_IDS or not isinstance(v, list):
        return v
    out = []
    for a in v:
        if isinstance(a, dict) and isinstance(a.get("url"), str):
            label = a.get("label") if a.get("label") is not None else a["url"]
            out.append(f"{label}{action_sep}{a['url']}")
        else:
            out.append(a)
    return out


def keep_stored_credentials(stored: Any, rebuilt: Any) -> Any:
    old = [c for c in stored if isinstance(c, dict)] if isinstance(stored, list) else []
    if not old:
        return rebuilt
    names = {str(c.get("name") if c.get("name") is not None else "").lower() for c in old}
    added = [c for c in (rebuilt if isinstance(rebuilt, list) else [])
             if str((c or {}).get("name") if (c or {}).get("name") is not None else "").lower()
             not in names]
    return [*old, *added]


def stable(v: Any) -> str:
    """JSON with sorted object keys, to compare stored and rebuilt values by content."""
    if isinstance(v, list):
        return f"[{','.join(stable(x) for x in v)}]"
    if isinstance(v, dict):
        return "{" + ",".join(f"{json_stringify(k)}:{stable(v[k])}" for k in sorted(v)) + "}"
    return json_stringify(v)


def _limit(v: Any) -> int:
    n = js_number(500 if v is None else v)
    if math.isnan(n):
        return 500
    return int(max(1, min(500, n)))


def backfill(body: dict) -> tuple[int, dict]:
    domain, gcid = body["domain"], body["gcid"]
    dry_run = body.get("dry_run") is not False
    limit = _limit(body.get("limit"))
    try:
        lib = cr.sc()
        with role_connection("service_role") as conn:
            c_row = cr.latest_contract_row(conn, domain, gcid, "extraction")
            contract = ((c_row or {}).get("extraction") or {}).get("site_contract")
            if not contract:
                return 200, {"ok": False, "reason": "no_contract"}
            try:
                src = cr.source_row(conn, domain, gcid, "source_id")
            except Exception as e:  # noqa: BLE001 - the TS answered no_source with the error
                return 200, {"ok": False, "reason": "no_source", "error": str(e)}
            if not src:
                return 200, {"ok": False, "reason": "no_source", "error": None}
            sql = f"select {_STAGE_COLS} from exp_etl_staging where source_id = %s and gcid = %s"
            params: list[Any] = [src["source_id"], gcid]
            if body.get("after_stage_id"):
                sql += " and stage_id > %s"
                params.append(body["after_stage_id"])
            sql += " order by stage_id asc limit %s"
            params.append(limit)
            with conn.cursor() as cur:
                cur.execute(sql, params)
                rows = [dict(r) for r in cur.fetchall()]
            if not rows:
                return 200, {"ok": True, "done": True, "rows": 0}
            reg = cr.registry_rows(conn, gcid)

        # Taxonomy routes by schema.org meaning (same rule as mapping), from the registry and
        # the rows' subjects.
        tax_keys = lib.resolve_taxonomy_keys(lib.filter_taxonomy_rows(reg),
                                             contract.get("primary_subject"))
        votes: dict[str, dict[str, int]] = {}
        for r in rows:
            for slug, label in ((r.get("payload") or {}).get("_subjects") or {}).items():
                s = SUBJECT_BY_LABEL.get(label) if isinstance(label, str) else None
                if not s:
                    continue
                m = votes.setdefault(slug, {})
                m[s] = m.get(s, 0) + 1
        taxonomy_fields: dict[str, Any] = {}
        for slug, m in votes.items():
            subject = min(m.items(), key=lambda kv: -kv[1])[0]
            taxonomy_fields[slug] = {
                "tier": "css", "locator": {"tier": "css", "strategy": "css", "css": "backfill"},
                "type": "text", "hits": 1, "samples": 1, "subject": subject, "scope": None,
            }
        generic = lib.build_static_routes({
            "fields": {}, "taxonomyFields": taxonomy_fields, "taxKeys": tax_keys,
            "primary": contract.get("primary_subject"), "extraFields": {}, "extraCandidates": {},
            "extraValues": [], "sampleUrls": [],
        })["routes"]
        routes: dict[str, list] = {}
        for src0 in (generic, contract.get("static_routes") or {}, body.get("routes") or {}):
            for sid, rs in src0.items():
                if isinstance(rs, list):
                    routes[sid] = [*routes.get(sid, []), *rs]
        boilerplate: dict[str, list] = dict(contract.get("boilerplate_values") or {})
        for sid, texts in (body.get("boilerplate_texts") or {}).items():
            boilerplate[sid] = [*boilerplate.get(sid, []),
                                *(lib.boilerplate_key(t) for t in (texts or []))]
        work_contract = {**contract, "static_routes": routes, "boilerplate_values": boilerplate}

        before: dict[str, int] = {}
        after: dict[str, int] = {}
        changed: dict[str, int] = {}  # rows whose value differs by content
        extras_removed = 0
        examples: list[dict] = []
        updates: list[dict] = []
        for r in rows:
            ic = r.get("identity_candidates") or {}
            payload = r.get("payload") or {}
            old_u = ic.get("universal") or {}
            values: dict[str, Any] = {}
            for fid, v in old_u.items():
                if non_empty(v) and (lib.is_identity_id(fid) or fid in lib.HELPER_IDS):
                    values[fid] = to_page_value(fid, v, lib.ACTION_SEP)
            for slug, v in payload.items():
                if not slug.startswith("_") and non_empty(v):
                    values[lib.TAX_PREFIX + slug] = v
            old_extras = payload.get("_extra") or {}
            page_url = r.get("detail_url") if r.get("detail_url") is not None else str(
                ic.get("url") if ic.get("url") is not None else "")
            st = lib.build_staging_static({"contract": work_contract, "values": values,
                                           "extras": old_extras, "pageUrl": page_url})
            if non_empty(old_u.get("person.credentials")):
                kept = keep_stored_credentials(old_u["person.credentials"],
                                               st["universal"].get("person.credentials"))
                if non_empty(kept):
                    st["universal"]["person.credentials"] = kept
            for fid in dict.fromkeys([*old_u, *st["universal"]]):
                if not lib.is_identity_id(fid):
                    continue
                if stable(old_u.get(fid)) != stable(st["universal"].get(fid)):
                    changed[fid] = changed.get(fid, 0) + 1
            for fid, v in old_u.items():
                if non_empty(v):
                    before[fid] = before.get(fid, 0) + 1
            for fid in st["universal"]:
                after[fid] = after.get(fid, 0) + 1
            extras_removed += len(old_extras) - len(st["extras"])
            if len(examples) < 2:
                examples.append({"stage_id": r["stage_id"], "before": old_u,
                                 "after": st["universal"]})
            new_payload = {k: v for k, v in payload.items() if k != "_extra"}
            if st["extras"]:
                new_payload["_extra"] = st["extras"]
            if st["sources"]:
                new_payload["_static_sources"] = st["sources"]
            else:
                new_payload.pop("_static_sources", None)
            updates.append({
                "stage_id": r["stage_id"], "source_id": r["source_id"], "gcid": r["gcid"],
                "entity_type": r["entity_type"], "payload": new_payload,
                "identity_candidates": {**ic, "universal": st["universal"]},
            })

        written = 0
        if not dry_run:
            with role_connection("service_role", write=True) as conn, conn.cursor() as cur:
                cur.executemany(
                    "insert into exp_etl_staging "
                    "(stage_id, source_id, gcid, entity_type, payload, identity_candidates) "
                    "values (%s, %s, %s, %s, %s, %s) on conflict (stage_id) do update set "
                    "source_id = excluded.source_id, gcid = excluded.gcid, "
                    "entity_type = excluded.entity_type, payload = excluded.payload, "
                    "identity_candidates = excluded.identity_candidates",
                    [(u["stage_id"], u["source_id"], u["gcid"], u["entity_type"],
                      Jsonb(u["payload"]), Jsonb(u["identity_candidates"])) for u in updates],
                )
            written = len(updates)
        statuses: dict[str, int] = {}
        for r in rows:
            k = str(r.get("resolution_status"))
            statuses[k] = statuses.get(k, 0) + 1
        return 200, {
            "ok": True, "dry_run": dry_run, "rows": len(rows), "written": written,
            "statuses": statuses, "last_stage_id": rows[-1]["stage_id"], "done": len(rows) < limit,
            "before": before, "after": after, "changed": changed, "extras_removed": extras_removed,
            "routes_used": sorted(routes), "examples": examples,
        }
    except Exception as error:  # noqa: BLE001 - the worker always answers in JSON
        return 500, {"ok": False, "reason": "error", "error": f"{type(error).__name__}: {error}"}


@router.post("/public/disco-staging-backfill")
async def disco_staging_backfill(request: Request):
    if not worker_key_ok(request):
        return jresp({"error": "unauthorized"}, 401)
    body = await read_json(request)
    if is_invalid(body):
        return jresp({"error": "Invalid JSON body"}, 400)
    b = body if isinstance(body, dict) else {}
    if not b.get("domain") or not b.get("gcid"):
        return jresp({"error": "domain and gcid are required"}, 400)
    status, out = await run_in_threadpool(backfill, b)
    return jresp(out, status)
