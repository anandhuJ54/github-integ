"""Public engagement reads (port of legacy `lib/engagement.functions.ts`).

Direct card actions, the compare view and taxonomy-derived related searches. Read-only, live
data only, as the signed-out visitor (`anon` role, RLS applies). A failed read yields no rows,
exactly as the TS `.catch(() => ({ data: [] }))` / `data ?? []` did.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from typing import Any

from _base.server_fn import FnCall, bad_input, fn_router
from search.routers._sql import safe_rows

router = fn_router("search")

ROLE = "anon"
CARD_NODE_TYPES = ["contact_phone", "website", "contact_email", "address"]
COMPARE_NODE_TYPES = ["specialty", "language", "credential"]


def _empty_action() -> dict:
    return {"phone": None, "website": None, "email": None, "address": None}


def trim(value: Any) -> str | None:
    """Trimmed string, or None when not a string or blank."""
    text = value.strip() if isinstance(value, str) else ""
    return text or None


def address_of(row: dict) -> str | None:
    parts = [
        trim(row.get(k))
        for k in ("address_street", "address_city", "address_state", "address_zip")
    ]
    return ", ".join(p for p in parts if p) or None


def _num(value: Any) -> int | float | None:
    """JS `Number(x)` for DB numerics (None stays None)."""
    if value is None:
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return float("nan")


def _js_str(value: Any) -> str:
    """JS `String(x)` for a JSON scalar (number or string)."""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _id_list(data: Any, key: str, limit: int) -> list:
    """`(input?.<key> ?? []).filter(Boolean).slice(0, limit)`."""
    if data is None:
        return []
    if not isinstance(data, dict):
        raise bad_input("invalid input")
    values = data.get(key)
    if values is None:
        return []
    if not isinstance(values, list):
        raise bad_input(f"{key} must be an array")
    return [v for v in values if v][:limit]


# --- getCardActions ---------------------------------------------------------


def merge_card_actions(rows: list[dict], nodes: list[dict]) -> dict[str, dict]:
    """Table rows first (professionals then organizations), then graph nodes fill the gaps."""
    out: dict[str, dict] = {}

    def put(entity_id: str, **patch: str | None) -> None:
        current = out.get(entity_id) or _empty_action()
        out[entity_id] = {
            k: current[k] if current[k] is not None else patch.get(k) for k in current
        }

    for row in rows:
        put(
            str(row.get("id")),
            phone=trim(row.get("phone")),
            website=trim(row.get("website_url")),
            email=trim(row.get("email")),
            address=address_of(row),
        )
    for node in nodes:
        entity_id = str(node.get("entity_id"))
        node_type = str(node.get("node_type") or "")
        value = trim(node.get("title")) or trim(node.get("url"))
        if not value:
            continue
        if node_type == "contact_phone":
            put(entity_id, phone=value)
        elif node_type == "website":
            put(entity_id, website=trim(node.get("url")) or value)
        elif node_type == "contact_email":
            put(entity_id, email=value)
        elif node_type == "address":
            put(entity_id, address=value)
    return out


def card_actions(entity_ids: list) -> dict[str, dict]:
    if not entity_ids:
        return {}
    ids = [str(i) for i in entity_ids]
    queries = [
        (
            ("select id, phone, email, website_url, address_city, address_state, address_zip "
            "from professionals where id = any(%s)"),
            (ids,),
        ),
        (
            ("select id, phone, email, website_url, address_street, address_city, address_state, "
            "address_zip from organizations where id = any(%s)"),
            (ids,),
        ),
        (
            ("select entity_id, node_type, title, url from graph_nodes "
            "where entity_id = any(%s) and node_type = any(%s) and is_active = true limit 400"),
            (ids, CARD_NODE_TYPES),
        ),
    ]
    with ThreadPoolExecutor(max_workers=len(queries)) as pool:
        pros, orgs, nodes = pool.map(lambda q: safe_rows(ROLE, *q), queries)
    return merge_card_actions([*pros, *orgs], nodes)


@router.post("/getCardActions")
def get_card_actions(call: FnCall) -> dict[str, dict]:
    """Call / Website / Directions / Message data for a batch of result cards."""
    return card_actions(_id_list(call.data, "entityIds", 40))


# --- getCompareEntities -----------------------------------------------------


def _values_by_type(nodes: list[dict], entity_id: str, node_type: str) -> list[str]:
    out: list[str] = []
    for node in nodes:
        if str(node.get("entity_id")) != entity_id or node.get("node_type") != node_type:
            continue
        extracted = node.get("extracted_data")
        if not isinstance(extracted, dict):
            extracted = {}
        value = (
            trim(extracted.get("language"))
            or trim(extracted.get("name"))
            or trim(extracted.get("specialty"))
            or trim(node.get("title"))
            or ""
        )
        if value:
            out.append(value)
    return out


def _components(raw: Any) -> list[dict]:
    if isinstance(raw, dict):
        items = list(raw.items())
    elif isinstance(raw, list):
        items = [(str(i), v) for i, v in enumerate(raw)]
    else:
        items = []
    kept = [
        (k, v)
        for k, v in items
        if isinstance(v, str) or (isinstance(v, (int, float)) and not isinstance(v, bool))
    ]
    return [{"label": str(k).replace("_", " "), "value": _js_str(v)} for k, v in kept[:8]]


def _dedupe(values: list[str]) -> list[str]:
    return list(dict.fromkeys(values))


def build_compare(
    docs: list[dict],
    scores: list[dict],
    nodes: list[dict],
    creds: list[dict],
    cats: list[dict],
    actions: dict[str, dict],
) -> list[dict]:
    """Shape the compare rows exactly as the TS handler did."""
    score_by_id = {str(r.get("entity_id")): r for r in scores}
    labels = {r.get("gcid"): r.get("display_name") for r in cats}
    out: list[dict] = []
    for doc in docs:
        entity_id = str(doc.get("entity_id"))
        score_row = score_by_id.get(entity_id) or {}
        table_creds = [
            trim(r.get("credential_name")) or trim(r.get("credential_type")) or ""
            for r in creds
            if str(r.get("professional_id")) == entity_id
        ]
        table_creds = [c for c in table_creds if c]
        location = ", ".join(p for p in (trim(doc.get("city")), trim(doc.get("state"))) if p)
        gcid = doc.get("gcid")
        out.append(
            {
                "id": str(doc.get("id")),
                "entityId": entity_id,
                "name": "" if doc.get("name") is None else str(doc.get("name")),
                "slug": doc.get("slug"),
                "entityType": "" if doc.get("entity_type") is None else str(doc["entity_type"]),
                "photoUrl": doc.get("photo_url"),
                "categoryLabel": labels.get(str(gcid)) if gcid else None,
                "location": location or None,
                "rating": _num(doc.get("rating")),
                "reviewCount": _num(doc.get("review_count")),
                "rankScore": _num(doc.get("rank_score")),
                "score": _num(score_row.get("score")),
                "band": score_row.get("band"),
                "components": _components(score_row.get("components") or {}),
                "specialties": _values_by_type(nodes, entity_id, "specialty")[:8],
                "languages": _values_by_type(nodes, entity_id, "language")[:6],
                "credentials": _dedupe(
                    [*table_creds, *_values_by_type(nodes, entity_id, "credential")]
                )[:6],
                "actions": actions.get(entity_id) or _empty_action(),
            }
        )
    return out


@router.post("/getCompareEntities")
def get_compare_entities(call: FnCall) -> list[dict]:
    """Side-by-side facts for 2–3 selected profiles, all graph/table sourced."""
    doc_ids = [str(i) for i in _id_list(call.data, "docIds", 3)]
    if not doc_ids:
        return []
    docs = safe_rows(
        ROLE,
        "select id, entity_id, entity_type, slug, gcid, name, title, city, state, zip, rating, "
        "review_count, rank_score, photo_url from search_documents where id = any(%s)",
        (doc_ids,),
    )
    if not docs:
        return []
    entity_ids = [str(d.get("entity_id")) for d in docs]
    gcids = _dedupe([str(d.get("gcid")) for d in docs if d.get("gcid")])

    def cats() -> list[dict]:
        if not gcids:
            return []
        return safe_rows(
            ROLE, "select gcid, display_name from gbp_categories where gcid = any(%s)", (gcids,)
        )

    with ThreadPoolExecutor(max_workers=5) as pool:
        scores_f = pool.submit(
            safe_rows,
            ROLE,
            "select entity_id, score, band, components from exp_profile_scores "
            "where entity_id = any(%s)",
            (entity_ids,),
        )
        nodes_f = pool.submit(
            safe_rows,
            ROLE,
            "select entity_id, node_type, title, extracted_data from graph_nodes "
            "where entity_id = any(%s) and node_type = any(%s) and is_active = true limit 600",
            (entity_ids, COMPARE_NODE_TYPES),
        )
        creds_f = pool.submit(
            safe_rows,
            ROLE,
            "select professional_id, credential_type, credential_name from credentials "
            "where professional_id = any(%s) limit 200",
            (entity_ids,),
        )
        cats_f = pool.submit(cats)
        actions_f = pool.submit(card_actions, entity_ids)
        return build_compare(
            docs,
            scores_f.result(),
            nodes_f.result(),
            creds_f.result(),
            cats_f.result(),
            actions_f.result(),
        )


# --- getRelatedSearches -----------------------------------------------------


def related_terms(rows: list[dict]) -> list[str]:
    terms = [
        trim(r.get("term_display")) or trim(r.get("term")) or ""
        for r in rows
        if r.get("use_srp") is not False or r.get("use_search") is not False
    ]
    return _dedupe([t for t in terms if t])[:10]


@router.post("/getRelatedSearches")
def get_related_searches(call: FnCall) -> dict:
    """"People also searched" — real taxonomy terms for the category in view."""
    data = call.data if isinstance(call.data, dict) else {}
    gcid = data.get("gcid") or ""
    if not gcid:
        return {"terms": []}
    rows = safe_rows(
        ROLE,
        "select term_display, term, search_volume_monthly, use_srp, use_search, is_active, level "
        "from exp_taxonomy where gcid = %s and is_active = true "
        "order by search_volume_monthly desc nulls last limit 40",
        (str(gcid),),
    )
    return {"terms": related_terms(rows)}
