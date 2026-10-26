"""Category schema generator (port of `lib/expertise-schema.functions.ts`).

Projects a category's Knowledge Model (exp_category_knowledge) into per-lane schema.org
payloads with two model calls per lane (fields, then payloads), stamps the conversion tether
deterministically (never trusted to the model) and gates each lane, retrying once.
"""
from __future__ import annotations

import json
import math
import os
from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context
from datetime import UTC, datetime
from typing import Any

import httpx
from fastapi import Depends, HTTPException
from psycopg.types.json import Jsonb

from _base.auth import current_user
from _base.db.session import role_connection
from _base.server_fn import FnCall, bad_input, fn_router
from surfaces.graph.expertise_schema.schemas import (
    _GenIn,
)
from surfaces.graph.internal import execute, parse_input, soft_execute, soft_maybe_one

router = fn_router("graph")

ELEMENTS = [
    "Core identity",
    "Credentials & authority",
    "Experience & track record",
    "Published content",
    "Media & voice",
    "Social presence & engagement",
    "Reviews & reputation",
    "Affiliations & upstream",
    "Web presence & entity graph",
]

PROFILE_KINDS = (
    "header | infoCards | lines | stats | properties | services | chips | score | roster | "
    "reviews | posts | disclaimer"
)

MODEL = "claude-sonnet-4-6"
ELEMENT_LIST = "\n".join(f"{i + 1}. {e}" for i, e in enumerate(ELEMENTS))

# Gates (the bar proven on real estate: 149/167 fields, tether on all surfaces).
GATE_MIN_FIELDS = 100  # prompt targets 110-135; floor guards against thin output
GATE_MIN_SEO = 18


def _compact(o: Any) -> str:
    """JSON.stringify (compact)."""
    return json.dumps(o, separators=(",", ":"), ensure_ascii=False)


def _js_join(items: Any, sep: str) -> str:
    """Array.prototype.join: null/undefined -> ''."""
    out = []
    for x in items or []:
        if x is None:
            out.append("")
        elif isinstance(x, bool):
            out.append("true" if x else "false")
        elif isinstance(x, dict):
            out.append("[object Object]")
        else:
            out.append(str(x))
    return sep.join(out)


def _js_round(x: float) -> int:
    return math.floor(x + 0.5)


def extract_json(text: str) -> Any:
    t = text.strip()
    if t[:3] == "```":
        t = t[3:]
        if t[:4].lower() == "json":
            t = t[4:]
    t = t.removesuffix("```")
    t = t.strip()
    first, last = t.find("{"), t.rfind("}")
    if first == -1 or last == -1 or last <= first:
        raise ValueError("Model did not return a JSON object.")
    return json.loads(t[first:last + 1])


def call_anthropic(api_key: str, system: str, user: str, max_tokens: int = 16000) -> Any:
    resp = httpx.post(
        "https://api.anthropic.com/v1/messages",
        headers={"x-api-key": api_key, "anthropic-version": "2023-06-01",
                 "content-type": "application/json"},
        json={"model": MODEL, "max_tokens": max_tokens, "system": system,
              "messages": [{"role": "user", "content": user}]},
        timeout=600.0,
    )
    if not resp.is_success:
        raise RuntimeError(f"Anthropic API error: {resp.status_code} {resp.text[:200]}")
    j = resp.json()
    if j.get("stop_reason") == "max_tokens":
        raise RuntimeError("truncated: hit max_tokens (decomposition should prevent this)")
    content = j.get("content") or []
    raw = ((content[0] or {}).get("text") if content else None) or ""
    return extract_json(raw.strip())


def km_actions_for_lane(km: dict | None, lane: str) -> list[dict]:
    acts = (km or {}).get("conversion_actions")
    if not isinstance(acts, list):
        return []

    def lane_of(a: dict) -> Any:
        if a.get("lane") is not None:
            return a["lane"]
        lanes = a.get("lanes")
        return lanes[0] if isinstance(lanes, list) and lanes else None

    return [a for a in acts if lane_of(a) == lane]


def fields_system(lane: str) -> str:
    if lane == "professional":
        lane_rule = (
            'This is the PROFESSIONAL lane (the individual practitioner). schemaType MUST be '
            '"Person + <the category\'s professional @type>". Element 1 carries PERSON fields '
            "(name, jobTitle, credentials, contact)."
        )
    else:
        lane_rule = (
            "This is the LOCATION lane (the place/organization). schemaType MUST be the "
            "category's organization/LocalBusiness @type. Element 1 carries PLACE/ORG fields "
            "(address, geo, hours, areaServed, parentOrganization)."
        )
    return f"""You are the schema architect for an expertise-graph platform (Experience.com). Produce ONLY the 9 expertise elements with EXHAUSTIVE schema.org fields for ONE lane of a Google Business Profile category. No jsonld/html/profile/seo — fields only.

OUTPUT: a SINGLE JSON object, no prose or fences:
{{ "schemaType": string, "elements": [ {{ "n":1..9, "name":string, "group":string, "fields":[ {{ "label":string, "prop":string, "type":string, "source":string, "scored"?:true }} ] }} ] }}

The 9 elements, fixed order:
{ELEMENT_LIST}

RULES:
- EXHAUSTIVE: 110-135 total fields across the 9 elements. Enumerate every authority field a real profile in THIS category carries. Do NOT summarize or truncate.
- Use REAL schema.org properties (name, jobTitle, hasCredential, aggregateRating, review, sameAs, address, geo, openingHoursSpecification, makesOffer, areaServed, parentOrganization, employee, subjectOf, interactionStatistic, knowsAbout, award, memberOf, hasOfferCatalog, etc.).
- Mark ~28-32% of the most authority-bearing fields scored:true.
- Choose the correct schema.org @type for THIS category (do NOT default to RealEstateAgent).
- {lane_rule}"""


def fields_user(data: dict, lane: str, km: dict | None) -> str:
    km = km or {}
    svc = _js_join((km.get("services") or [])[:20], "; ")
    term = _js_join(km.get("terminology") or [], ", ")
    comp = _js_join(km.get("compliance_rules") or [], "; ")
    return (
        f'Category: "{data["displayName"]}" (gcid: {data["gcid"]}). '
        f"Produce the {lane.upper()} lane.\n"
        f"SERVICES: {svc or '—'}\n"
        f"TERMINOLOGY: {term or '—'}\n"
        f"COMPLIANCE (honor; correct regulator): {comp or '—'}\n"
        "Return the exhaustive 9-element fields JSON now (110-135 fields)."
    )


def payloads_system(lane: str, schema_type: str) -> str:
    return f"""You are the schema architect for Experience.com. For ONE lane whose FIELDS are already defined, produce the remaining payloads. Output a SINGLE JSON object, no prose or fences:
{{ "seo":[[attr,pattern],...], "jsonld": string (a complete JSON-LD @graph), "html": string (microdata snippet), "profile":[ProfileSection,...] }}
ProfileSection kinds: {PROFILE_KINDS}
RULES:
- schemaType is "{schema_type}". jsonld @type must reflect it.
- seo: 20-24 rows of [attribute, pattern] covering the search intents + category terminology.
- profile: complete visitor sections — a header (name/subtitle/rating/chips), the key sections for a {lane} in this category (listings/menu/services/stats as appropriate), reviews (multi-source), posts, and a disclaimer. Plausible sample data.
- Include a header section (kind:"header") and leave its "ctas" as [] — the platform stamps CTAs deterministically.
- jsonld MUST be valid JSON (it is parsed). Do NOT include a potentialAction — the platform injects it deterministically."""


def payloads_user(lane: str, schema_type: str, fields_obj: dict, km: dict | None) -> str:
    summary = []
    for e in fields_obj.get("elements") or []:
        item = {k: e[k] for k in ("n", "name") if k in e}
        item["fields"] = [f.get("label") for f in (e.get("fields") or [])]
        summary.append(item)
    intents_src = (km or {}).get("search_intents")
    intents = [
        s.get("query") for s in (intents_src if isinstance(intents_src, list) else [])
        if (s.get("lane") if s.get("lane") is not None else lane) == lane
    ]
    return (
        f"Lane={lane}, schemaType={schema_type}. The lane already has these elements/fields:\n"
        f"{_compact(summary)[:3500]}\n"
        f"Search intents (SEO must cover these): {_js_join(intents, ' | ') or '—'}\n"
        "Return the seo/jsonld/html/profile JSON now."
    )


def _button(a: dict) -> Any:
    return a.get("profile_button") if a.get("profile_button") is not None else a.get(
        "profileButton")


def stamp_tether(lane_obj: dict, km_acts: list[dict]) -> None:
    """Deterministic tether stamp (never trust the model for this)."""
    ctas = [b for b in (_button(a) for a in km_acts) if b]
    profile = lane_obj.get("profile")
    header = next((p for p in (profile or []) if isinstance(p, dict) and p.get("kind") == "header"),
                  None) if isinstance(profile, list) else None
    if header is not None:
        header["ctas"] = ctas
    elif isinstance(profile, list):
        profile.insert(0, {"kind": "header", "name": "", "subtitle": "", "initials": "",
                           "ctas": ctas})
    pa = [
        {"@type": a.get("schema_action") if a.get("schema_action") is not None
         else a.get("schemaAction"), "name": a.get("label")}
        for a in km_acts
    ]
    try:
        jl = json.loads(lane_obj["jsonld"])
        graph = jl.get("@graph") if isinstance(jl, dict) else None
        if isinstance(graph, list) and graph:
            target = next((n for n in graph if isinstance(n, dict) and n.get("@type")), graph[0])
            target["potentialAction"] = pa
        elif isinstance(jl, dict):
            jl["potentialAction"] = pa
        elif not isinstance(jl, list):
            raise TypeError("jsonld is not an object")
        lane_obj["jsonld"] = _compact(jl)
    except Exception:  # noqa: BLE001, S110 — the jsonld gate catches invalid json below
        pass


def _fields_of(e: Any) -> list:
    f = e.get("fields") if isinstance(e, dict) else None
    return f if isinstance(f, list) else []


def count_fields(lane_obj: dict) -> int:
    return sum(len(_fields_of(e)) for e in lane_obj.get("elements") or [])


def count_scored(lane_obj: dict) -> int:
    return sum(
        1 for e in lane_obj.get("elements") or [] for f in _fields_of(e)
        if isinstance(f, dict) and f.get("scored")
    )


def potential_action_count(lane_obj: dict) -> int:
    try:
        jl = json.loads(lane_obj["jsonld"])
    except Exception:  # noqa: BLE001
        return -1  # invalid json
    found: list[Any] = []

    def walk(o: Any) -> None:
        if found:
            return
        if isinstance(o, list):
            for x in o:
                walk(x)
        elif isinstance(o, dict):
            if o.get("potentialAction"):
                found.append(o["potentialAction"])
            else:
                for v in o.values():
                    walk(v)

    walk(jl)
    return len(found[0]) if found and isinstance(found[0], list) else 0


def gate_lane(lane_obj: dict, km_acts: list[dict]) -> dict:
    fields = count_fields(lane_obj)
    scored = count_scored(lane_obj)
    pct = _js_round(100 * scored / fields) if fields else 0
    seo = len(lane_obj.get("seo") or [])
    header = next((p for p in lane_obj.get("profile") or []
                   if isinstance(p, dict) and p.get("kind") == "header"), None)
    ctas = (header or {}).get("ctas")
    ctas = ctas if ctas is not None else []
    expected = [b for b in (_button(a) for a in km_acts) if b]
    pa_count = potential_action_count(lane_obj)
    failures: list[str] = []
    if len(lane_obj.get("elements") or []) != 9:
        failures.append("not 9 elements")
    if fields < GATE_MIN_FIELDS:
        failures.append(f"fields {fields} < {GATE_MIN_FIELDS}")
    if pct < 20 or pct > 40:
        failures.append(f"scored ratio {pct}% out of range")
    if seo < GATE_MIN_SEO:
        failures.append(f"seo rows {seo} < {GATE_MIN_SEO}")
    if pa_count < 0:
        failures.append("jsonld invalid")
    if expected:
        if _compact(ctas) != _compact(expected):
            failures.append("header.ctas != KM buttons")
        if pa_count != len(expected):
            failures.append(f"potentialAction {pa_count} != KM {len(expected)}")
    return {"pass": not failures, "failures": failures}


def build_lane(api_key: str, data: dict, lane: str, km: dict) -> dict:
    """One fully-formed, gated lane (with a single retry on gate failure)."""
    km_acts = km_actions_for_lane(km, lane)
    last: list[str] = []
    for _attempt in range(2):
        fields_obj = call_anthropic(api_key, fields_system(lane), fields_user(data, lane, km))
        schema_type = fields_obj.get("schemaType")
        if schema_type is None:
            schema_type = "Person" if lane == "professional" else "LocalBusiness"
        rest = call_anthropic(api_key, payloads_system(lane, schema_type),
                              payloads_user(lane, schema_type, fields_obj, km))
        lane_obj = {
            "key": lane,
            "label": "Agent (professional)" if lane == "professional" else "Office (location)",
            "schemaType": schema_type,
            "elements": fields_obj.get("elements"),
            "seo": rest.get("seo"),
            "jsonld": rest.get("jsonld"),
            "html": rest.get("html"),
            "profile": rest.get("profile"),
        }
        stamp_tether(lane_obj, km_acts)
        gate = gate_lane(lane_obj, km_acts)
        if gate["pass"]:
            return lane_obj
        last = gate["failures"]
    raise RuntimeError(f'Lane "{lane}" failed gates after retry: {"; ".join(last)}')


@router.post("/generateCategorySchema")
def generate_category_schema(call: FnCall, claims: dict = Depends(current_user)) -> dict:
    data = parse_input(_GenIn, call.data).model_dump()
    user_id = claims.get("sub")
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")

    # Source of truth: the Knowledge Model row we PROJECT from (read as the caller).
    with role_connection("authenticated", claims) as conn:
        km = soft_maybe_one(
            conn,
            "select terminology, services, compliance_rules, value_props, search_intents, "
            "conversion_actions, updated_at from exp_category_knowledge where gcid = %s",
            (data["gcid"],),
        )
    if not km:
        raise bad_input("No Knowledge Model for this category — build Layer 1 first.")
    if not isinstance(km.get("conversion_actions"), list) or not km["conversion_actions"]:
        raise bad_input(
            "Knowledge Model has no conversion_actions — generate the logic layer before schema."
        )

    et = data["entityType"]
    lanes = (["location"] if et == "location" else ["professional"] if et == "professional"
             else ["professional", "location"])
    # Lanes are independent -> build in parallel (fields -> payloads is sequential within each).
    with ThreadPoolExecutor(max_workers=len(lanes)) as pool:
        futures = [pool.submit(copy_context().run, build_lane, api_key, data, ln, km)
                   for ln in lanes]
        built = [f.result() for f in futures]

    parsed = {"gcid": data["gcid"], "displayName": data["displayName"], "entityType": et,
              "lanes": built}
    now = datetime.now(UTC)
    persisted, persist_error = False, None
    try:
        # Direct upsert into exp_category_schema with the service role, as the TS did.
        with role_connection("service_role", write=True) as conn:
            execute(
                conn,
                "insert into exp_category_schema (gcid, entity_type, schema_json, model, "
                "knowledge_updated_at, generated_by, generated_at, updated_at) "
                "values (%s, %s, %s, %s, %s, %s, %s, %s) on conflict (gcid) do update set "
                "entity_type = excluded.entity_type, schema_json = excluded.schema_json, "
                "model = excluded.model, knowledge_updated_at = excluded.knowledge_updated_at, "
                "generated_by = excluded.generated_by, generated_at = excluded.generated_at, "
                "updated_at = excluded.updated_at",
                (data["gcid"], et, Jsonb(parsed), f"{MODEL} (decomposed)", km.get("updated_at"),
                 user_id, now, now),
            )
        persisted = True
    except Exception as e:  # noqa: BLE001 — reported in the result, as the TS did
        persist_error = str(e)

    with role_connection("authenticated", claims, write=True) as conn:
        soft_execute(  # audit is non-critical
            conn,
            "insert into audit_log (user_id, action, entity_type, entity_id, field_changes) "
            "values (%s, %s, %s, %s, %s)",
            (user_id, "category.schema.generate", "category", data["gcid"],
             Jsonb({"lanes": len(built), "fields": [count_fields(ln) for ln in built],
                    "method": "decomposed"})),
        )

    return {
        "ok": True,
        "schema": parsed,
        "persisted": persisted,
        "persistError": persist_error,
        "stats": [{"lane": ln["key"], "schemaType": ln["schemaType"],
                   "fields": count_fields(ln), "scored": count_scored(ln)} for ln in built],
    }
