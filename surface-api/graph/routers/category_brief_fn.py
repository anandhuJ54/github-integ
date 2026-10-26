"""Category brief loader (port of `lib/category-brief.functions.ts`).

Reads a category's rows as the calling user (RLS applies) and hands them to the pure compiler
in `graph.category_brief`. gcid is used verbatim.
"""
from __future__ import annotations

from typing import Annotated, Any

from fastapi import Depends
from pydantic import BaseModel, ConfigDict, StringConstraints

from _base.auth import current_user
from _base.db.session import role_connection
from _base.server_fn import FnCall, fn_router
from graph.category_brief import compile_category_brief
from graph.sqlutil import fetch_all, parse_input, soft_fetch_all, soft_maybe_one

router = fn_router("graph")

VOCAB_LEVELS = ["product_service", "specialization", "profession_title", "alias", "industry_term"]

NODE_COLUMNS = (
    "id, node_slug, node_name, ring, entity_scope, node_class, connection_method, schema_type, "
    "schema_property, required_for_score, score_points, priority, counts_toward_m, owns_lane, "
    "requires_verification"
)

# (result key, table, columns) for the per-category single-row reads. Names from the TS only.
_ONE: list[tuple[str, str, str]] = [
    ("category", "gbp_categories", "gcid, display_name, slug, entity_type, status"),
    ("shape", "exp_category_shape",
     ("gcid, shape, allowed_entity_types, required_entity_types, claimable_types, "
     "monetizable_types, teams_allowed, multi_affiliation_allowed, identity_keys, "
     "allowed_relationships")),
    ("profileConfig", "exp_category_profile_config",
     ("gcid, entity_noun, service_label, credential_label, credential_id_label, cta_label, "
     "schema_type, show_prequalify")),
    ("completeness", "exp_category_completeness", "total_node_types, core_node_types, expected_m"),
    ("compliance", "exp_category_compliance",
     ("license_label, required_disclaimers, content_restrictions, prohibited_phrases, "
     "required_disclosures, regulated_by, hipaa_applies, glba_applies, coppa_applies, "
     "ferpa_applies, age_gate_required, age_gate_minimum, review_verification_required, "
     "review_transaction_required, compliance_notes")),
    ("ear", "exp_category_ear", "ear, ear_professional, band, non_reviewable"),
    ("eaa", "exp_category_eaa", "eaa, eaa_professional, band, non_authored"),
    ("eaq", "exp_category_eaq", "eaq, eaq_professional, band, non_qa"),
    ("eav", "exp_category_eav", "eav, eav_professional, band, non_video"),
]


def load_category_brief_rows(conn: Any, gcid: str) -> dict[str, Any]:
    """All rows the brief compiler needs. Single-row reads ignore their error (as the TS did);
    the paged node / taxonomy reads raise on error."""
    out: dict[str, Any] = {"gcid": gcid}
    for key, table, cols in _ONE:
        out[key] = soft_maybe_one(conn, f"select {cols} from {table} where gcid = %s", (gcid,))
    out["schemaTypes"] = soft_fetch_all(
        conn, "select schema_type, confidence, rule from exp_category_schema_type where gcid = %s",
        (gcid,),
    )
    out["rings"] = soft_fetch_all(
        conn, "select position, ring_key, ring_name, schema_properties from exp_rings "
        "order by position",
    )
    out["nodes"] = fetch_all(
        conn,
        f"select {NODE_COLUMNS} from exp_vertical_node_registry "
        "where gcid = %s and is_active = true order by node_slug",
        (gcid,),
    )
    out["taxonomy"] = fetch_all(
        conn,
        "select level, term, term_display, entity_scope, schema_property, is_required, priority "
        "from exp_taxonomy where gcid = %s and is_active = true and level = any(%s) "
        "order by level, priority, term",
        (gcid, VOCAB_LEVELS),
    )
    return out


class _In(BaseModel):
    model_config = ConfigDict(strict=True)
    gcid: Annotated[str, StringConstraints(min_length=1)]


@router.post("/getCategoryBrief")
def get_category_brief(call: FnCall, claims: dict = Depends(current_user)) -> dict:
    data = parse_input(_In, call.data)
    with role_connection("authenticated", claims) as conn:
        rows = load_category_brief_rows(conn, data.gcid)
    return compile_category_brief(rows)
